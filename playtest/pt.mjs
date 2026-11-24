// Playtest driver for Solmarina fresh build — CDP (own Chrome, port 9224).
// Runs the game live, injects playtest/pt-inpage.js, executes scenarios,
// captures screenshots + console errors, writes playtest/results.json.
// Usage: node playtest/pt.mjs [scenario...]
//   scenarios: boot keys collisions missions wanted combat systems hud all
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1187/chrome-linux/chrome`;
const BASE = 'http://127.0.0.1:8091';
const OUT = `${process.env.HOME}/workspace/makefun/gta6-01-fresh/playtest`;
const SHOTS = `${OUT}/shots`;
mkdirSync(SHOTS, { recursive: true });
const only = process.argv.slice(2);
const want = (name) => only.length === 0 || only.includes('all') || only.includes(name);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = { started: new Date().toISOString(), scenarios: {}, consoleErrors: [], stats: {} };
const log = (name, obj) => { results.scenarios[name] = obj; console.log(`### ${name}:`, JSON.stringify(obj).slice(0, 1200)); };

async function getWsUrl() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9224/json/list');
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
  '--remote-debugging-port=9224', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--user-data-dir=/tmp/pt-chrome-profile', 'about:blank',
], { stdio: 'ignore' });

let id = 0;
const pending = new Map();
const events = [];
let ws;
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
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(s.data, 'base64'));
  return `${name}.png`;
};
const key = async (code, k, type) => {
  await send('Input.dispatchKeyEvent', { type, code, key: k, windowsVirtualKeyCode: 0 });
};
const keyTap = async (code, k, holdMs = 120) => {
  await key(code, k, 'keyDown'); await sleep(holdMs); await key(code, k, 'keyUp');
};
const keyHold = async (code, k, holdMs) => {
  await key(code, k, 'keyDown'); await sleep(holdMs); await key(code, k, 'keyUp');
};
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};
const stats = async (label) => {
  const s = await ev('JSON.stringify(window.__stats || {})');
  results.stats[label] = JSON.parse(s);
  return results.stats[label];
};

try {
  const wsUrl = await getWsUrl();
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
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

  // ---------- always: navigate + inject harness + start ----------
  const bootBefore = events.length;
  await send('Page.navigate', { url: `${BASE}/?seed=1` });
  // wait for the game module to boot (module load can be slow under load)
  let booted = false;
  for (let i = 0; i < 15; i++) {
    await sleep(2000);
    booted = await ev('!!window.__solmarina').catch(() => false);
    if (booted) break;
  }
  if (!booted) throw new Error('game did not boot in 30 s');
  await ev(readFileSync(`${OUT}/pt-inpage.js`, 'utf8'));
  const hasPt = await ev('!!window.__pt && !!window.__solmarina');
  if (!hasPt) throw new Error('harness or game failed to load');
  const bootInfo = await ev(`JSON.stringify({
    solmarina: !!window.__solmarina,
    screen: window.__solmarina?.world.state.screen,
    titleVisible: getComputedStyle(document.getElementById('title-screen')).display,
    stats: window.__stats || {},
  })`);
  await ev(`document.getElementById('btn-start').click()`);
  await sleep(1500);
  const started = await ev(`window.__solmarina.world.state.screen`);
  if (started !== 'play') throw new Error('start click did not reach play screen: ' + started);

  // ---------- BOOT ----------
  if (want('boot')) {
    const before = bootBefore;
    log('boot', JSON.parse(bootInfo));
    await shot('00-title');
    await stats('boot');
    log('harness-injected', { hasPt });
    const afterStart = await ev(`JSON.stringify({ screen: window.__solmarina.world.state.screen, hudVisible: getComputedStyle(document.getElementById('hud')).display, station: document.getElementById('station-name').textContent })`);
    log('start-click', JSON.parse(afterStart));
    await sleep(2000);
    await shot('01-play-start');
    await stats('play-start');
    results.consoleErrors.push(...events.slice(before).filter((e) =>
      e.method === 'Runtime.exceptionThrown' ||
      (e.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(e.params?.type)) ||
      (e.method === 'Log.entryAdded' && e.params?.entry?.level === 'error'))
      .map((e) => JSON.stringify(e.params).slice(0, 400)));
  }

  // ---------- DEBUG: re-enter after wreck + pier drive trace ----------
  if (want('debug')) {
    const dbg = await ev(`JSON.stringify(window.__pt.debugReenter())`, true).catch((e) => ({ error: String(e) }));
    log('debug-reenter', typeof dbg === 'string' ? JSON.parse(dbg) : dbg);
    await ev(`window.__pt.reset(1)`);
    await ev(`JSON.stringify(window.__pt.driveTo(-72, -144, { timeout: 120, arriveR: 7 }))`, true);
    const tr = await ev(`JSON.stringify(window.__pt.traceDrive(384, 24, { timeout: 240, arriveR: 7 }))`, true).catch((e) => ({ error: String(e) }));
    log('debug-pier-trace', typeof tr === 'string' ? JSON.parse(tr) : tr);
  }

  // ---------- REAL KEYBOARD DRIVING ----------
  if (want('keys')) {
    await ev(`window.__pt.reset(1)`);
    const curve = [];
    await key('KeyW', 'w', 'keyDown');
    for (let i = 0; i < 10; i++) {
      await sleep(3000);
      const s = await ev(`JSON.stringify({ kmh: Math.round(Math.abs(window.__solmarina.world.state.heroCar.speed)*3.6), x: +window.__solmarina.world.state.heroCar.x.toFixed(1), z: +window.__solmarina.world.state.heroCar.z.toFixed(1), heading: +window.__solmarina.world.state.heroCar.heading.toFixed(2), dmg: Math.round(window.__solmarina.world.state.heroCar.damage) })`);
      curve.push(JSON.parse(s));
    }
    await key('KeyW', 'w', 'keyUp');
    // steering: W+A for 6 s
    const h0 = (await ev(`window.__solmarina.world.state.heroCar.heading`));
    await key('KeyW', 'w', 'keyDown'); await key('KeyA', 'a', 'keyDown');
    await sleep(6000);
    await key('KeyA', 'a', 'keyUp'); await key('KeyW', 'w', 'keyUp');
    const h1 = (await ev(`window.__solmarina.world.state.heroCar.heading`));
    // brake with Space
    const v0 = await ev(`Math.abs(window.__solmarina.world.state.heroCar.speed)`);
    await keyHold('Space', ' ', 3000);
    const v1 = await ev(`Math.abs(window.__solmarina.world.state.heroCar.speed)`);
    // reverse with S from low speed
    await keyHold('KeyS', 's', 4000);
    const vRev = await ev(`window.__solmarina.world.state.heroCar.speed`);
    // brake to a FULL stop first (exit requires |speed| < 1), polling speed
    await key('Space', ' ', 'keyDown');
    let stopped = false;
    for (let i = 0; i < 10; i++) {
      await sleep(2000);
      const v = await ev(`Math.abs(window.__solmarina.world.state.heroCar.speed)`);
      if (v < 1) { stopped = true; break; }
    }
    await key('Space', ' ', 'keyUp');
    // exit car with E, then re-enter (600 ms holds so the tap survives the frame)
    await keyTap('KeyE', 'e', 600); await sleep(1500);
    const modeAfterExit = await ev(`window.__solmarina.world.state.player.mode`);
    await sleep(500);
    await keyTap('KeyE', 'e', 600); await sleep(1500);
    const modeAfterEnter = await ev(`window.__solmarina.world.state.player.mode`);
    log('keys-driving', {
      speedCurveKmh: curve.map((c) => c.kmh), maxKmh: Math.max(...curve.map((c) => c.kmh)),
      steerHeadingDelta: +(h1 - h0).toFixed(2),
      brakeBefore: +v0.toFixed(1), brakeAfter: +v1.toFixed(1),
      reverseSpeedMs: +vRev.toFixed(1),
      modeAfterExit, modeAfterEnter,
      finalPos: curve[curve.length - 1],
    });
    await shot('02-keys-drive');
    await stats('keys');
  }

  // ---------- COLLISIONS ----------
  if (want('collisions')) {
    await ev(`window.__pt.reset(1)`);
    const ped = await ev(`JSON.stringify(window.__pt.probeTrafficPed(90))`, true).catch((e) => ({ error: String(e) }));
    log('collision-traffic-vs-ped', typeof ped === 'string' ? JSON.parse(ped) : ped);
    await ev(`window.__pt.reset(1)`);
    const pedStop = await ev(`JSON.stringify(window.__pt.probeTrafficPedStop())`, true).catch((e) => ({ error: String(e) }));
    log('collision-traffic-ped-stop', typeof pedStop === 'string' ? JSON.parse(pedStop) : pedStop);
    await sleep(2500); await shot('03-traffic-ped');
    await ev(`window.__pt.reset(1)`);
    const tt = await ev(`JSON.stringify(window.__pt.probeTrafficTraffic(120))`, true).catch((e) => ({ error: String(e) }));
    log('collision-traffic-vs-traffic', typeof tt === 'string' ? JSON.parse(tt) : tt);
    await ev(`window.__pt.reset(1)`);
    const cb = await ev(`JSON.stringify(window.__pt.probeCarBuildingLive(180))`, true).catch((e) => ({ error: String(e) }));
    log('collision-car-vs-building', typeof cb === 'string' ? JSON.parse(cb) : cb);
    await sleep(2000); await shot('04-city-drive');
    const wb = await ev(`JSON.stringify(window.__pt.probeWalkBuilding())`, true).catch((e) => ({ error: String(e) }));
    log('collision-walk-vs-building', typeof wb === 'string' ? JSON.parse(wb) : wb);
    await ev(`window.__pt.reset(1)`);
    const ts = await ev(`JSON.stringify(window.__pt.probeTopSpeed())`, true).catch((e) => ({ error: String(e) }));
    log('drive-top-speed-reverse', typeof ts === 'string' ? JSON.parse(ts) : ts);
    await ev(`window.__pt.reset(1)`);
    const pb = await ev(`JSON.stringify(window.__pt.probePoliceBuilding(60))`, true).catch((e) => ({ error: String(e) }));
    log('collision-police-vs-building', typeof pb === 'string' ? JSON.parse(pb) : pb);
    await stats('collisions');
  }

  // ---------- MISSIONS M1-M4 ----------
  if (want('missions')) {
    await ev(`window.__pt.reset(1)`);
    const m1 = await ev(`JSON.stringify(window.__pt.mission1())`, true).catch((e) => ({ error: String(e) }));
    log('mission-1', typeof m1 === 'string' ? JSON.parse(m1) : m1);
    await sleep(2500); await shot('05-mission1-done');
    const m2 = await ev(`JSON.stringify(window.__pt.mission2())`, true).catch((e) => ({ error: String(e) }));
    log('mission-2', typeof m2 === 'string' ? JSON.parse(m2) : m2);
    await sleep(2500); await shot('06-mission2-done');
    const m3 = await ev(`JSON.stringify(window.__pt.mission3())`, true).catch((e) => ({ error: String(e) }));
    log('mission-3', typeof m3 === 'string' ? JSON.parse(m3) : m3);
    await sleep(2500); await shot('07-mission3-done');
    let m4 = await ev(`JSON.stringify(window.__pt.mission4(1))`, true).catch((e) => ({ error: String(e) }));
    m4 = typeof m4 === 'string' ? JSON.parse(m4) : m4;
    if (!m4.ok && !m4.gameOver) {
      // retry only if the world is still alive — after a gameover a retry
      // without a reset just replays a dead world (attempt 2 failed at
      // 'drive-safehouse' with the same gameover state)
      const m4b = await ev(`JSON.stringify(window.__pt.mission4(2))`, true).catch((e) => ({ error: String(e) }));
      m4.retry = typeof m4b === 'string' ? JSON.parse(m4b) : m4b;
    }
    log('mission-4', m4);
    await sleep(2500); await shot('08-mission4-end');
    await stats('missions');
  }

  // ---------- DEBUG: combat gunman shoot reason ----------
  if (want('debug-shoot')) {
    await ev(`window.__pt.reset(1)`);
    const out = await ev(`JSON.stringify((() => {
      const W = window.__solmarina.world, s = W.state;
      s.missions.active = 3; s.missions.stage = 0; s.missions.started = true;
      window.__pt.teleport(-72, 48, 'walk');
      s.player.health = 95; s.player.armour = 27;
      W.step(1/60, window.__pt.noInput());
      window.__pt.ff(10);
      s.player.health = 100; s.player.armour = 27; s.ammo = 48;
      const g = s.gunmen[0];
      const log = [];
      for (let i = 0; i < 700; i++) {
        if (!g.alive) { log.push({ i, note: 'dead', hp: g.hp, ammo: s.ammo, shots: s.shotsFired }); break; }
        if (i % 60 === 0) log.push({ i, hp: g.hp, ammo: s.ammo, shots: s.shotsFired, mode: s.player.mode, weapon: s.weapon, flash: +g.hitFlash.toFixed(2) });
        const ang = Math.atan2(-(g.z - s.player.z), g.x - s.player.x);
        W.step(1/60, { ...window.__pt.noInput(), shoot: true, shootAngle: ang });
      }
      return { log, gunman: { hp: g.hp, alive: g.alive } };
    })())`, true).catch((e) => ({ error: String(e) }));
    log('debug-shoot', typeof out === 'string' ? JSON.parse(out) : out);
    await stats('debug-shoot');
  }

  // ---------- DEBUG: hero stuck walking west from (-61.5,48) ----------
  if (want('debug-stuck')) {
    await ev(`window.__pt.reset(1)`);
    const out = await ev(`(() => {
      const W = window.__solmarina.world, s = W.state;
      window.__pt.teleport(-61.5, 48, 'walk');
      // put the hero car where M4 leaves it, then walk at it
      s.heroCar.x = -67.5; s.heroCar.z = 48; s.heroCar.heading = 0; s.heroCar.speed = 0;
      const near = W.layout.buildings.filter((b) => Math.abs(b.x + 61.5) < 25 && Math.abs(b.z - 48) < 25).map((b) => ({ x: +b.x.toFixed(1), z: +b.z.toFixed(1), w: +b.w.toFixed(1), d: +b.d.toFixed(1) }));
      const log = [];
      for (let i = 0; i < 180; i++) {
        W.step(1 / 60, window.__pt.walkInput(-72, 48));
        if (i % 30 === 0) log.push({ t: +(i / 60).toFixed(1), px: +s.player.x.toFixed(2), pz: +s.player.z.toFixed(2), carX: +s.heroCar.x.toFixed(1), carZ: +s.heroCar.z.toFixed(1) });
      }
      // now try walkTo straight at the car (the ensureInCar path)
      const w = window.__pt.walkTo(-67.5, 48, { timeout: 10, arriveR: 3.5 });
      return JSON.stringify({ near, log, walkToCar: { ok: w.ok, reason: w.reason || null, minD: w.minD, px: +s.player.x.toFixed(2), pz: +s.player.z.toFixed(2) } });
    })()`);
    log('debug-stuck', JSON.parse(out));
    await stats('debug-stuck');
  }

  // ---------- DEBUG: minimap click ----------
  if (want('debug-minimap')) {
    await ev(`window.__pt.reset(1)`);
    await ev(`window.__pt.startPlay()`);
    const out = await ev(`JSON.stringify((() => {
      const el = document.getElementById('minimap');
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width * 0.85, cy = r.top + r.height * 0.15;
      const top = document.elementFromPoint(cx, cy);
      const cs = getComputedStyle(el);
      const before = { x: window.__solmarina.world.state.player.x, z: window.__solmarina.world.state.player.z };
      el.dispatchEvent(new MouseEvent('click', { clientX: cx, clientY: cy, bubbles: true }));
      const afterSynth = { x: window.__solmarina.world.state.player.x, z: window.__solmarina.world.state.player.z };
      return { rect: { x: r.left, y: r.top, w: r.width, h: r.height }, clickAt: { x: cx, y: cy }, topElement: top ? { tag: top.tagName, id: top.id, cls: top.className } : null, pointerEvents: cs.pointerEvents, zIndex: cs.zIndex, position: cs.position, before, afterSynth, expected: { x: Math.round(-336 + 0.85 * 768), z: Math.round(-336 + 0.15 * 720) } };
    })())`, true).catch((e) => ({ error: String(e) }));
    log('debug-minimap', typeof out === 'string' ? JSON.parse(out) : out);
    // now the real CDP click at the same point
    const mm = await ev(`JSON.stringify((() => { const r = document.getElementById('minimap').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })())`);
    const m = JSON.parse(mm);
    await ev(`window.__pt.teleport(-76, -139, 'car')`);
    await clickAt(m.x + m.w * 0.85, m.y + m.h * 0.15); await sleep(800);
    const afterReal = await ev(`JSON.stringify({ x: window.__solmarina.world.state.player.x, z: window.__solmarina.world.state.player.z })`);
    log('debug-minimap-real-click', JSON.parse(afterReal));
    await stats('debug-minimap');
  }

  // ---------- DEBUG: M4 leg0 trace (car route marina -> safehouse) ----------
  if (want('debug-m4')) {
    await ev(`window.__pt.reset(1)`);
    const d1 = await ev(`JSON.stringify(window.__pt.mission1())`, true).catch((e) => ({ error: String(e) }));
    log('debug-m4-m1', typeof d1 === 'string' ? JSON.parse(d1) : d1);
    await sleep(2500); await shot('d4-m1');
    const d2 = await ev(`JSON.stringify(window.__pt.mission2())`, true).catch((e) => ({ error: String(e) }));
    log('debug-m4-m2', typeof d2 === 'string' ? JSON.parse(d2) : d2);
    await sleep(2500); await shot('d4-m2');
    const d3 = await ev(`JSON.stringify(window.__pt.mission3())`, true).catch((e) => ({ error: String(e) }));
    log('debug-m4-m3', typeof d3 === 'string' ? JSON.parse(d3) : d3);
    await sleep(2500); await shot('d4-m3');
    const tr = await ev(`JSON.stringify(window.__pt.traceDrive(-72, 48, { timeout: 180, arriveR: 5 }))`, true).catch((e) => ({ error: String(e) }));
    log('debug-m4-leg0', typeof tr === 'string' ? JSON.parse(tr) : tr);
    await stats('debug-m4');
  }

  // ---------- WANTED / POLICE ----------
  if (want('wanted')) {
    await ev(`window.__pt.reset(1)`);
    // steal a car with the REAL E key: teleport on foot next to nearest traffic car
    const setup = await ev(`(() => {
      const s = window.__solmarina.world.state;
      let best = null, bd = Infinity;
      for (const c of s.traffic) { const d = Math.hypot(c.x - s.player.x, c.z - s.player.z); if (d < bd) { bd = d; best = c; } }
      window.__pt.teleport(best.x + 2, best.z, 'walk');
      return JSON.stringify({ carId: best.id, kind: best.kind, x: best.x, z: best.z });
    })()`);
    log('wanted-steal-setup', JSON.parse(setup));
    await keyTap('KeyE', 'e'); await sleep(2000);
    const afterSteal = await ev(`JSON.stringify({ mode: window.__solmarina.world.state.player.mode, carsStolen: window.__solmarina.world.state.carsStolen, wanted: window.__solmarina.world.state.wanted, police: window.__solmarina.world.state.police.length })`);
    log('wanted-after-steal', JSON.parse(afterSteal));
    // run over a ped: place nearest ped 8 m ahead of the car, chase its LIVE
    // position (a ped walks ~1.5 m/s and dodged the old fixed 12 m setup
    // about half the time)
    const pedRun = await ev(`JSON.stringify((() => {
      const W = window.__solmarina.world, s = W.state;
      let best = null, bd = Infinity;
      for (const pd of s.peds) { if (!pd.alive) continue; const d = Math.hypot(pd.x - s.heroCar.x, pd.z - s.heroCar.z); if (d < bd) { bd = d; best = pd; } }
      const car = s.heroCar;
      best.x = car.x + Math.cos(car.heading) * 8; best.z = car.z - Math.sin(car.heading) * 8;
      const w0 = s.wanted, alive0 = s.peds.filter(q => q.alive).length;
      window.__pt.ff(4, () => window.__pt.driveInput(best.x, best.z));
      return { wantedBefore: w0, wantedAfter: s.wanted, pedsAliveBefore: alive0, pedsAliveAfter: s.peds.filter(q => q.alive).length, police: s.police.length };
    })())`, true).catch((e) => ({ error: String(e) }));
    log('wanted-ped-runover', typeof pedRun === 'string' ? JSON.parse(pedRun) : pedRun);
    // escalate to 4+ via state (setup) then verify heli + police count, then cooldown
    await ev(`window.__pt.setWanted(4)`);
    const heli = await ev(`JSON.stringify((() => {
      const W = window.__solmarina.world, s = W.state;
      const samples = [];
      // sample IMMEDIATELY: the hero is near the safehouse, so the heat
      // decays 4 s/star and a 10 s fast-forward before the first sample
      // already drops wanted below 4 (the old test saw heli:false throughout)
      for (let i = 0; i < 5; i++) { samples.push({ wanted: s.wanted, heli: s.heli.active, alt: Math.round(s.heli.alt), hx: Math.round(s.heli.x), hz: Math.round(s.heli.z), police: s.police.length }); window.__pt.ff(1); }
      return { wanted: s.wanted, police: s.police.length, samples };
    })())`, true).catch((e) => ({ error: String(e) }));
    log('wanted-heli-4', typeof heli === 'string' ? JSON.parse(heli) : heli);
    await sleep(2000); await shot('09-wanted4-heli');
    // cooldown: set a known heat first (the heli test may already have
    // decayed it to 0), then safehouse until CLEAR
    const cool = await ev(`JSON.stringify((() => {
      const W = window.__solmarina.world, s = W.state;
      window.__pt.setWanted(3);
      window.__pt.teleport(-72, 48, s.player.mode);
      const t0 = s.time, w0 = s.wanted;
      let t = 0;
      for (let i = 0; i < 60 * 240; i++) { W.step(1/60, window.__pt.noInput()); t = s.time - t0; if (s.wanted === 0) break; }
      return { wantedBefore: w0, wantedAfter: s.wanted, secondsToClear: +t.toFixed(1), police: s.police.length };
    })())`, true).catch((e) => ({ error: String(e) }));
    log('wanted-cooldown-safehouse', typeof cool === 'string' ? JSON.parse(cool) : cool);
    await stats('wanted');
  }

  // ---------- ROADBLOCK ----------
  if (want('roadblock')) {
    const rb = await ev(`JSON.stringify(window.__pt.probeRoadblock())`, true).catch((e) => ({ error: String(e) }));
    log('roadblock', typeof rb === 'string' ? JSON.parse(rb) : rb);
    // staged screenshot: wanted 3, hero on the z=0 road, fast-forward until
    // the block is set, then a few rendered frames for the camera to settle
    await ev(`window.__pt.reset(1)`);
    await ev(`(() => { const s = window.__solmarina.world.state; s.screen = 'play'; window.__pt.teleport(-72, 0, 'car'); s.heroCar.heading = 0; s.wanted = 3; })()`);
    await ev(`window.__pt.ff(4)`);
    await sleep(2500); await shot('17-roadblock');
    await stats('roadblock');
  }

  // ---------- COMBAT / WEAPONS ----------
  if (want('combat')) {
    await ev(`window.__pt.reset(1)`);
    // weapon keys 1-5 via real key events
    const wkeys = {};
    for (const [code, k] of [['Digit1', '1'], ['Digit2', '2'], ['Digit3', '3'], ['Digit4', '4'], ['Digit5', '5']]) {
      await keyTap(code, k); await sleep(800);
      wkeys[code] = await ev(`JSON.stringify({ weapon: window.__solmarina.world.state.weapon || 'SOL-9', ammo: window.__solmarina.world.state.ammo, activeSlot: [...document.querySelectorAll('.wslot')].findIndex(el => el.classList.contains('active')) })`);
    }
    log('combat-weapon-keys', { keys: wkeys });
    // MAR-7 rifle (slot 5): select + kill a gunman at 30 m (dmg 70, range 40)
    const mar7 = await ev(`(async () => JSON.stringify(await window.__pt.probeWeapon5()))()`, true).catch((e) => ({ error: String(e) }));
    log('combat-mar7', typeof mar7 === 'string' ? JSON.parse(mar7) : mar7);
    // shooting from a car must not fire (sim-level, fast-forward)
    const carShoot = await ev(`JSON.stringify((() => {
      const W = window.__solmarina.world, s = W.state;
      s.player.mode = 'car';
      const a0 = s.ammo, sh0 = s.shotsFired;
      window.__pt.ff(2, () => ({ ...window.__pt.noInput(), shoot: true, shootAngle: 0 }));
      return { ammoBefore: a0, ammoAfter: s.ammo, shotsBefore: sh0, shotsAfter: s.shotsFired };
    })())`, true).catch((e) => ({ error: String(e) }));
    log('combat-shoot-from-car', typeof carShoot === 'string' ? JSON.parse(carShoot) : carShoot);
    // reload: drain ammo on foot, press R (direct input), verify refill
    const reload = await ev(`JSON.stringify((() => {
      const W = window.__solmarina.world, s = W.state;
      window.__pt.teleport(-72, 0, 'walk');
      s.ammo = 3; s.reserve = 90;
      W.step(1/60, { ...window.__pt.noInput(), reload: true });
      return { ammo: s.ammo, reserve: s.reserve };
    })())`, true).catch((e) => ({ error: String(e) }));
    log('combat-reload', typeof reload === 'string' ? JSON.parse(reload) : reload);
    // gunman combat (fresh M4 stage 0 setup): spawn gunmen, shoot one with real mouse path later;
    // here sim-level: aim + shoot, record hit feedback + health/armour under fire
    const gun = await ev(`JSON.stringify((() => {
      const W = window.__solmarina.world, s = W.state;
      s.missions.active = 3; s.missions.stage = 0; s.missions.started = true;
      window.__pt.teleport(-72, 48, 'walk');
      s.player.health = 95; s.player.armour = 27;
      // let the sim spawn gunmen (1 step), then stand in the open 10 s taking fire
      W.step(1/60, window.__pt.noInput());
      const gunmen = s.gunmen.length;
      const h0 = s.player.health, a0 = s.player.armour;
      window.__pt.ff(10);
      const underFire = { health: Math.round(s.player.health), armour: Math.round(s.player.armour), healthLost: +(h0 - s.player.health).toFixed(1), armourLost: +(a0 - s.player.armour).toFixed(1), gunmen };
      // now shoot the first gunman (fresh armour first: the 10 s under fire
      // left armour at 3, and the hero died mid-shoot in the old test).
      // Force SOL-9: the weapon-keys test leaves 12G selected (range 14 m)
      // and the gunman is 17 m away, so every shot missed and the ammo
      // drained to out-of-ammo.
      s.weapon = 'SOL-9'; s.ammo = 48; s.reserve = 90;
      s.player.health = 100; s.player.armour = 27;
      const g = s.gunmen.find((gg) => gg.alive);
      const r = window.__pt.shootAt(g, { timeout: 30 });
      return { underFire, shoot: { killed: r.killed, time: r.time, sawFlash: r.sawFlash, shotsFired: r.after ? r.after.shots - r.before.shots : null, cashDelta: r.after ? r.after.cash - r.before.cash : null, wantedAfter: r.after ? r.after.wanted : null } };
    })())`, true).catch((e) => ({ error: String(e) }));
    log('combat-gunmen', typeof gun === 'string' ? JSON.parse(gun) : gun);
    await sleep(2000); await shot('10-combat');
    await stats('combat');
  }

  // ---------- SOUND: horn, siren, footsteps, volume ----------
  if (want('sound')) {
    await ev(`window.__pt.reset(1)`);
    await ev(`window.__pt.startPlay()`);
    const snd = await ev(`JSON.stringify((() => {
      const snd = window.__solmarina.sound;
      const out = { ctxBefore: !!snd.ctx, volumeBefore: snd.volume };
      snd.ensure();
      out.ctxState = snd.ctx ? snd.ctx.state : null;
      out.masterGain = snd.master ? +snd.master.gain.value.toFixed(2) : null;
      snd.horn();
      snd.siren(true, 20);
      snd.footsteps(true, 0.4);
      snd.footsteps(true, 0.4);
      out.hornSirenSteps = 'no-throw';
      return out;
    })())`, true).catch((e) => ({ error: String(e) }));
    await sleep(900); // siren gain slews with a 0.2 s time constant
    // the main loop drives the siren from the live wanted level, so the
    // test's siren(true) above is overridden while wanted is 0 — measure
    // it at wanted 2 instead, which is what real play does
    await ev(`window.__pt.setWanted(2)`);
    await sleep(1500);
    const sirenAfter = await ev(`JSON.stringify({ wanted: window.__solmarina.world.state.wanted, sirenGain: window.__solmarina.sound.sirenGain ? +window.__solmarina.sound.sirenGain.gain.value.toFixed(3) : null, nearestCop: Math.round(Math.min(...window.__solmarina.world.state.police.map((pc) => Math.hypot(pc.x - window.__solmarina.world.state.player.x, pc.z - window.__solmarina.world.state.player.z)))) })`);
    const vols = await ev(`JSON.stringify((() => {
      const snd = window.__solmarina.sound;
      return [snd.cycleVolume(), snd.cycleVolume(), snd.cycleVolume(), snd.cycleVolume()];
    })())`, true).catch((e) => ({ error: String(e) }));
    log('sound', { ...(typeof snd === 'string' ? JSON.parse(snd) : snd), sirenGainAfter0_9s: JSON.parse(sirenAfter).sirenGain, volumeCycle: typeof vols === 'string' ? JSON.parse(vols) : vols });
    // real keys: H horn, V volume (station line shows the new volume)
    await keyTap('KeyH', 'h'); await sleep(500);
    await keyTap('KeyV', 'v'); await sleep(500);
    const radio = await ev(`document.getElementById('station-name').textContent`);
    log('sound-keys', { radioLineAfterV: radio });
    await stats('sound');
  }

  // ---------- SYSTEMS: save/load, pause, minimap, radio, day/night, crew ----------
  if (want('systems')) {
    await ev(`window.__pt.reset(1)`);
    // save slot 1 after reaching M1 pickup (stage advanced), then mutate, then load
    await ev(`JSON.stringify(window.__pt.driveTo(-72, -144, { timeout: 120, arriveR: 7 }))`, true);
    const preSave = await ev(`JSON.stringify(window.__pt.snap())`);
    const saved1 = await ev(`window.__pt.saveGame(1)`, true);
    await ev(`(() => { const s = window.__solmarina.world.state; s.cash = 1; s.player.x = 200; s.player.z = 200; s.heroCar.x = 200; s.heroCar.z = 200; s.missions.done = [false,false,false,false]; })()`);
    const loaded1 = await ev(`window.__pt.loadGame(1)`, true);
    const postLoad = await ev(`JSON.stringify(window.__pt.snap())`);
    // step 2 s: does the mission restart to M1 (started=false bug)?
    await ev(`window.__pt.ff(2)`);
    const afterSteps = await ev(`JSON.stringify(window.__pt.snap())`);
    log('systems-save-load-1', {
      preSave: JSON.parse(preSave), saved: saved1, loaded: loaded1,
      postLoad: JSON.parse(postLoad), after2sSteps: JSON.parse(afterSteps),
    });
    // slots 2 and 3 with distinct states; empty-slot load returns null
    await ev(`(() => { const s = window.__solmarina.world.state; s.cash = 55555; })()`);
    const saved2 = await ev(`window.__pt.saveGame(2)`, true);
    await ev(`(() => { const s = window.__solmarina.world.state; s.cash = 777; })()`);
    const saved3 = await ev(`window.__pt.saveGame(3)`, true);
    const load2 = await ev(`window.__pt.loadGame(2)`, true);
    const cashAfter2 = await ev(`window.__solmarina.world.state.cash`);
    const load3 = await ev(`window.__pt.loadGame(3)`, true);
    const cashAfter3 = await ev(`window.__solmarina.world.state.cash`);
    await ev(`localStorage.removeItem('solmarina-save-3')`);
    const loadEmpty = await ev(`window.__pt.loadGame(3)`, true);
    log('systems-save-load-23', { saved2, load2, cashAfter2, saved3, load3, cashAfter3, loadEmpty });
    // pause menu tabs (real key + real clicks)
    await keyTap('KeyP', 'p'); await sleep(1200);
    const pauseShown = await ev(`JSON.stringify({ screen: window.__solmarina.world.state.screen, pauseVisible: getComputedStyle(document.getElementById('pause-screen')).display })`);
    const tabs = {};
    for (const tab of ['story', 'stats', 'save', 'map']) {
      await ev(`document.querySelector('[data-tab="${tab}"]').click()`);
      await sleep(400);
      tabs[tab] = await ev(`JSON.stringify({ visible: document.getElementById('tab-${tab}').style.display, contentLen: (document.getElementById('tab-${tab}').textContent || '').trim().length })`);
    }
    log('systems-pause-tabs', { pauseShown: JSON.parse(pauseShown), tabs });
    await shot('11-pause-stats');
    await ev(`document.getElementById('btn-resume').click()`);
    await sleep(800);
    const resumed = await ev(`window.__solmarina.world.state.screen`);
    log('systems-pause-resume', { resumed });
    // minimap click-travel (real mouse click on the minimap canvas)
    const mm = await ev(`JSON.stringify((() => { const r = document.getElementById('minimap').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })())`);
    const m = JSON.parse(mm);
    // click at fraction (0.85, 0.15) of the minimap -> far NE of the map
    const cx = m.x + m.w * 0.85, cy = m.y + m.h * 0.15;
    const beforeMM = await ev(`JSON.stringify({ x: window.__solmarina.world.state.player.x, z: window.__solmarina.world.state.player.z })`);
    await clickAt(cx, cy); await sleep(1200);
    const afterMM = await ev(`JSON.stringify({ x: window.__solmarina.world.state.player.x, z: window.__solmarina.world.state.player.z, screen: window.__solmarina.world.state.screen })`);
    // expected map coords: x0=-336, x1=432, z0=-336, z1=384
    const expX = -336 + 0.85 * (432 - -336), expZ = -336 + 0.15 * (384 - -336);
    log('systems-minimap-travel', { before: JSON.parse(beforeMM), after: JSON.parse(afterMM), expected: { x: Math.round(expX), z: Math.round(expZ) } });
    await sleep(1500); await shot('12-minimap-travel');
    // radio: T cycles stations
    const radio = [];
    for (let i = 0; i < 4; i++) {
      await keyTap('KeyT', 't'); await sleep(500);
      radio.push(await ev(`document.getElementById('station-name').textContent`));
    }
    log('systems-radio', { stations: radio });
    // crew Z/X/C via real keys
    await ev(`window.__pt.setWanted(2)`);
    await keyTap('KeyZ', 'z'); await sleep(600);
    const crewZ = await ev(`JSON.stringify({ wanted: window.__solmarina.world.state.wanted, mira: window.__solmarina.world.state.crew.mira, dialog: window.__solmarina.world.state.missions.dialog })`);
    await keyTap('KeyZ', 'z'); await sleep(600);
    const crewZ2 = await ev(`JSON.stringify({ wanted: window.__solmarina.world.state.wanted, mira: window.__solmarina.world.state.crew.mira })`);
    await ev(`window.__pt.damageCar(50)`);
    await keyTap('KeyX', 'x'); await sleep(600);
    const crewX = await ev(`JSON.stringify({ damage: Math.round(window.__solmarina.world.state.heroCar.damage), lio: window.__solmarina.world.state.crew.lio, dialog: window.__solmarina.world.state.missions.dialog })`);
    await keyTap('KeyC', 'c'); await sleep(600);
    const crewC = await ev(`JSON.stringify({ kiki: window.__solmarina.world.state.crew.kiki, dialog: window.__solmarina.world.state.missions.dialog })`);
    log('systems-crew', { z: JSON.parse(crewZ), zAgain: JSON.parse(crewZ2), x: JSON.parse(crewX), c: JSON.parse(crewC) });
    // day/night: pin clock to 0 (night) and 12 (day), screenshots; unpinned advance
    await ev(`window.__pt.pinClock(0)`); await sleep(2500); await shot('13-night');
    await ev(`window.__pt.pinClock(12)`); await sleep(2500); await shot('14-day');
    await ev(`window.__pt.unpinClock()`);
    const h0 = await ev(`window.__solmarina.world.state.hour`);
    await ev(`window.__pt.ff(240)`);
    const h1 = await ev(`window.__solmarina.world.state.hour`);
    const clockHud = await ev(`document.getElementById('clock').textContent`);
    log('systems-day-night', { hourBefore: h0, hourAfter240s: h1, deltaHours: +(h1 - h0).toFixed(2), clockHud });
    await stats('systems');
  }

  // ---------- WAYPOINT (big map click) ----------
  if (want('waypoint')) {
    await ev(`window.__pt.reset(1)`);
    await ev(`window.__pt.startPlay()`);
    await keyTap('KeyP', 'p'); await sleep(1200);
    await ev(`document.querySelector('[data-tab="map"]').click()`);
    await sleep(600);
    const bm = await ev(`JSON.stringify((() => { const r = document.getElementById('bigmap').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })())`);
    const b = JSON.parse(bm);
    // click at fraction (0.7, 0.3) of the big map -> world (201.6, -120)
    await clickAt(b.x + b.w * 0.7, b.y + b.h * 0.3); await sleep(600);
    const wp = await ev(`JSON.stringify({ waypoint: window.__solmarina.world.state.waypoint, line: document.getElementById('waypoint-line').textContent, wpMarkerVisible: window.__solmarina.renderer.wpMarker.visible, expected: { x: Math.round(-336 + 0.7 * 768), z: Math.round(-336 + 0.3 * 720) } })`);
    log('waypoint-set', JSON.parse(wp));
    await sleep(1500); await shot('18-waypoint-map');
    // resume and drive to it: the waypoint must clear on arrival
    await ev(`document.getElementById('btn-resume').click()`);
    await sleep(800);
    const clear = await ev(`JSON.stringify((() => {
      const W = window.__solmarina.world, s = W.state;
      const wp = s.waypoint;
      const r = window.__pt.driveTo(wp.x, wp.z, { timeout: 180, arriveR: 10 });
      return { driveOk: r.ok, time: r.time, reason: r.reason || null, waypointAfter: s.waypoint, lineAfter: document.getElementById('waypoint-line').textContent };
    })())`, true).catch((e) => ({ error: String(e) }));
    log('waypoint-arrive', typeof clear === 'string' ? JSON.parse(clear) : clear);
    await stats('waypoint');
  }

  // ---------- HUD at 1280x720 and 640x360 ----------
  if (want('hud')) {
    await ev(`window.__pt.reset(1)`);
    await ev(`window.__pt.setWanted(2)`);
    await ev(`(() => { const s = window.__solmarina.world.state; s.missions.dialog = { speaker: 'DANTE', line: 'Rio. A package downtown, a pier at the end of the world. Don\\'t be late.' }; s.missions.dialogTimer = 30; })()`);
    await ev(`window.__pt.pinClock(17.5)`);
    await sleep(2500);
    await shot('15-hud-720');
    await stats('hud-720');
    await send('Emulation.setDeviceMetricsOverride', { width: 640, height: 360, deviceScaleFactor: 1, mobile: false });
    await sleep(2500);
    await shot('16-hud-360');
    await stats('hud-360');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  }

  // ---------- console error sweep ----------
  const errs = events.filter((e) =>
    e.method === 'Runtime.exceptionThrown' ||
    (e.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(e.params?.type)) ||
    (e.method === 'Log.entryAdded' && e.params?.entry?.level === 'error'));
  results.consoleErrors = errs.map((e) => JSON.stringify(e.params).slice(0, 400));
  results.finished = new Date().toISOString();
  writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ ok: true, consoleErrors: results.consoleErrors.length, scenarios: Object.keys(results.scenarios) }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String(e) }));
  try { writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2)); } catch { /* ignore */ }
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  chrome.kill('SIGKILL');
}
