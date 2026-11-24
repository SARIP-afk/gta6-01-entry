// Polish-14 verification driver — based on repo driver-2k.mjs, with fixes:
// - polls window.__shotReady up to 90 s instead of a fixed 12 s sleep
//   (cold SwiftShader boot can exceed 12 s under load)
// - defensive buffer/stats reads (never throws on a slow boot)
// - captures play + chase + cover + beach-hero at 2560x1440 native,
//   quality 'med' (pixelRatio scale 1.0, backing store == viewport)
// Usage: node verify-shots-polish14/driver-polish14.mjs <base-url> <out-dir> [shot...]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1187/chrome-linux/chrome`;
// Builder B isolation: own CDP port + profile so a parallel Builder A
// driver/probe can never share this tab. A used 9226 (driver) and 9227
// (probe, /tmp/fresh-2k-probe) — B takes 9231.
const CDP_PORT = 9231;
const PROFILE = '/tmp/fresh-2k-profile-d';
const [base, outDir, ...only] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const all = ['play', 'chase', 'cover', 'beach-hero'];
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
  '--remote-debugging-port=9231',
  '--user-data-dir=/tmp/fresh-2k-profile-d', 'about:blank',
], { stdio: 'ignore' });

let id = 0;
const pending = new Map();
const events = [];
let ws;
try {
  const wsUrl = await getWsUrl(CDP_PORT);
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    // watchdog: a lost CDP response (renderer crash / tab stolen by
    // another driver) must never hang the run forever
    const to = setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); reject(new Error(`CDP timeout 60s: ${method}`)); } }, 60000);
    pending.set(mid, { resolve: (v) => { clearTimeout(to); resolve(v); }, reject: (e) => { clearTimeout(to); reject(e); } });
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
  await send('Page.navigate', { url: `${base}/` });
  await sleep(4000);
  await ev(`localStorage.setItem('solmarina-quality','med'); 'ok'`);

  for (const name of shots) {
    const before = events.length;
    await send('Page.navigate', { url: `${base}/?shot=${name}&seed=1` });
    let ready = false, urlOk = false;
    for (let i = 0; i < 45; i++) {
      await sleep(2000);
      // guard: the tab must still be OUR shot URL — if another driver
      // stole the tab, do not screenshot a foreign page as this shot
      const st = await ev(`JSON.stringify({ href: location.href, ready: window.__shotReady === true })`).catch(() => null);
      if (st) {
        const o = JSON.parse(st);
        urlOk = o.href.includes(`shot=${name}`);
        ready = o.ready && urlOk;
        if (ready) break;
      }
    }
    if (!urlOk) { console.log(JSON.stringify({ shot: name, skipped: 'tab URL mismatch (stolen tab?)' })); continue; }
    // let a few frames settle so instanced pools + HUD are drawn
    await sleep(3000);
    const buf = await ev(`(() => { try { const c = document.getElementById('game'); const s = window.__solmarina; const r = s && s.renderer && s.renderer.renderer; return JSON.stringify({ canvas: c ? c.width + 'x' + c.height : 'no-canvas', dpr: window.devicePixelRatio, pixelRatio: r ? r.getPixelRatio() : null, inner: window.innerWidth + 'x' + window.innerHeight, booted: !!s }); } catch (e) { return JSON.stringify({ error: String(e) }); } })()`).catch((e) => JSON.stringify({ error: String(e) }));
    const stats = await ev('JSON.stringify(window.__stats || {})').catch(() => '{}');
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
