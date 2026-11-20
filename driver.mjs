// Fresh-build shot driver (kept in the repo worktree, not in game/).
// Loads each ?shot= scene, waits for __shotReady, samples FPS, captures a
// 1280x720 PNG, collects console errors. Usage:
//   node driver.mjs <base-url> <out-dir> [shot1 shot2 ...]
// Chrome: local Playwright Chromium with --enable-unsafe-swiftshader for
// software WebGL; viewport pinned with Emulation.setDeviceMetricsOverride.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1187/chrome-linux/chrome`;
const [base, outDir, ...only] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const all = ['cover', 'start', 'play', 'end', 'market', 'nightmarket', 'beach', 'chase'];
const shots = only.length ? only : all;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9223/json/list');
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('no page target came up');
}

const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu',
  '--enable-unsafe-swiftshader', '--window-size=1280,887',
  '--remote-debugging-port=9223',
  '--user-data-dir=/tmp/fresh-chrome-profile', 'about:blank',
], { stdio: 'ignore' });

let id = 0;
const pending = new Map();
const events = [];
let ws;
try {
  const wsUrl = await getWsUrl();
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      const { resolve, reject } = pending.get(d.id);
      pending.delete(d.id);
      d.error ? reject(new Error(JSON.stringify(d.error))) : resolve(d.result);
    } else if (d.method) events.push(d);
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

  for (const name of shots) {
    const before = events.length;
    await send('Page.navigate', { url: `${base}/?shot=${name}&seed=1` });
    await sleep(6000);
    const ready = await send('Runtime.evaluate', { expression: 'window.__shotReady === true', returnByValue: true });
    const fps = await send('Runtime.evaluate', {
      expression: `new Promise((res) => { let n = 0; const t0 = performance.now(); const tick = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else res((n / (performance.now() - t0)) * 1000); }; requestAnimationFrame(tick); })`,
      awaitPromise: true, returnByValue: true,
    });
    const stats = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__stats || {})', returnByValue: true });
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${outDir}/${name}.png`, Buffer.from(shot.data, 'base64'));
    const pageEvents = events.slice(before);
    const errs = pageEvents.filter((e) =>
      (e.method === 'Runtime.exceptionThrown') ||
      (e.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(e.params?.type)) ||
      (e.method === 'Log.entryAdded' && e.params?.entry?.level === 'error'));
    console.log(JSON.stringify({
      shot: name, ready: ready.result?.value, fps: Math.round(fps.result?.value ?? 0),
      stats: stats.result?.value,
      errors: errs.map((e) => JSON.stringify(e.params).slice(0, 300)),
    }));
  }
  console.log(JSON.stringify({ ok: true }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String(e) }));
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  chrome.kill('SIGKILL');
}
