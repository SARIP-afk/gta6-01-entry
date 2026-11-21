// 2K verification driver (repair round 3) — NOT part of the hand-in.
// Renders each ?shot= scene at 2560x1440 NATIVE: viewport pinned with
// Emulation.setDeviceMetricsOverride (2560x1440, scale 1),
// deviceScaleFactor 1, quality 'med' (pixelRatio scale 1.0) so the WebGL
// backing store is exactly the viewport size — no internal downscale,
// no upscale. (Tier 'high' would set pixelRatio 1.5, i.e. a 3840x2160
// backing store supersampled down to 2560x1440, which contradicts the
// "backing store = viewport" requirement, so it is deliberately not used.)
// Usage: node driver-2k.mjs <base-url> <out-dir> [shot1 shot2 ...]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1187/chrome-linux/chrome`;
const [base, outDir, ...only] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const all = ['cover', 'beach-hero', 'start', 'play', 'end', 'market', 'nightmarket', 'beach', 'chase'];
const shots = only.length ? only : all;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl(port) {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
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
  '--enable-unsafe-swiftshader', '--window-size=2560,1440',
  '--remote-debugging-port=9226',
  '--user-data-dir=/home/hatch/.cache/tmp/fresh-2k-profile-k9', 'about:blank',
], { stdio: 'ignore' });

let id = 0;
const pending = new Map();
const events = [];
let ws;
try {
  const wsUrl = await getWsUrl(9226);
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const ev = async (expr, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw new Error('evaluate failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 500));
    return r.result?.value;
  };
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
  await send('Emulation.setDeviceMetricsOverride', { width: 2560, height: 1440, deviceScaleFactor: 1, mobile: false });
  // pin quality 'med' (scale 1.0) so backing store == viewport, then
  // prove the buffer size from inside the page on every shot
  await send('Page.navigate', { url: `${base}/` });
  await sleep(4000);
  await ev(`localStorage.setItem('solmarina-quality','med'); 'ok'`);

  for (const name of shots) {
    const before = events.length;
    await send('Page.navigate', { url: `${base}/?shot=${name}&seed=1` });
    await sleep(12000);
    const ready = await ev('window.__shotReady === true');
    const buf = await ev(`(() => { const c = document.getElementById('game'); const r = window.__solmarina.renderer.renderer; return JSON.stringify({ canvas: c.width + 'x' + c.height, dpr: window.devicePixelRatio, pixelRatio: r.getPixelRatio(), inner: window.innerWidth + 'x' + window.innerHeight }); })()`);
    const stats = await ev('JSON.stringify(window.__stats || {})');
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${outDir}/${name}-2k.png`, Buffer.from(shot.data, 'base64'));
    const pageEvents = events.slice(before);
    const errs = pageEvents.filter((e) =>
      (e.method === 'Runtime.exceptionThrown') ||
      (e.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(e.params?.type)) ||
      (e.method === 'Log.entryAdded' && e.params?.entry?.level === 'error'));
    console.log(JSON.stringify({
      shot: name, ready, buffer: buf,
      stats,
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
