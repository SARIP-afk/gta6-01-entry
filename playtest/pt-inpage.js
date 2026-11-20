// Playtest harness for Solmarina fresh build — injected into the page via
// Runtime.evaluate. Drives the REAL sim (window.__solmarina.world) with the
// same inputs a player would give (steer/throttle/brake/enter/shoot), in a
// fast-forward loop. Setup-only state edits (teleport, setWanted) are
// flagged in results as setup, never as gameplay.
// Manhattan autopilot copied from game/src/shots.js (same routing rules).
window.__pt = (() => {
  const W = window.__solmarina.world;
  const S = () => W.state;
  const STEP = 1 / 60;
  const GRID_MIN = -288, GRID_MAX = 288, ROAD_STEP = 48;
  const ROADS = [];
  for (let v = GRID_MIN; v <= GRID_MAX; v += ROAD_STEP) ROADS.push(v);
  const nearestRoad = (v) => { let best = ROADS[0], bd = Infinity; for (const r of ROADS) { const d = Math.abs(v - r); if (d < bd) { bd = d; best = r; } } return best; };
  const wrapAngle = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const d2 = (x1, z1, x2, z2) => Math.hypot(x1 - x2, z1 - z2);
  const noInput = () => ({ moveX: 0, moveZ: 0, steer: 0, throttle: 0, brake: false, boost: false, enter: false, reload: false, shoot: false, shootAngle: null });

  function nextWaypoint(x, z, tx, tz) {
    const rx = nearestRoad(x), rz = nearestRoad(z);
    const onX = Math.abs(x - rx) < 4, onZ = Math.abs(z - rz) < 4;
    const step = (d) => Math.min(ROAD_STEP, Math.abs(d));
    if (onX && onZ) {
      if (Math.abs(tx - x) > 6) wp = { x: x + Math.sign(tx - x) * step(tx - x), z };
      // aligned in x: go along z — unless already on the target line, in
      // which case go straight at the target (the old code returned the
      // hero's own position when tz === z and froze the walker/driver)
      else if (Math.abs(tz - z) > 0.5) wp = { x, z: z + Math.sign(tz - z) * step(tz - z) };
      else wp = { x: tx, z: tz };
    } else if (onX) wp = { x: rx, z: z + Math.sign(tz - z) * step(tz - z) };
    else if (onZ) {
      if (Math.abs(tx - x) > 6) wp = { x: x + Math.sign(tx - x) * step(tx - x), z: rz };
      // aligned in x with the target: move in x to the target's x, staying
      // on the current z. The old code returned the road intersection
      // (rx, rz) — but mid-block the nearest road can be 18 m away, so the
      // hero was sent EAST away from a car 1.7 m WEST of it and ping-ponged
      // forever (M4 re-enter-car: hero stuck at (-61.5,48), car at (-67.5,48))
      else wp = { x: tx, z };
    } else wp = Math.abs(x - rx) < Math.abs(z - rz) ? { x: rx, z } : { x, z: rz };
    // degenerate guard (all branches): if the waypoint IS the current
    // position (e.g. tz === z in the onX branch), the walker/driver stalls
    // in walkInput's 1.5 m dead zone — go straight at the target instead
    if (Math.hypot(wp.x - x, wp.z - z) < 0.5) return { x: tx, z: tz };
    return wp;
  }
  function driveInput(tx, tz, opts = {}) {
    const s = S(), car = s.heroCar;
    let ex = tx, ez = tz;
    if (tx > GRID_MAX && (car.x < GRID_MAX - 2 || Math.abs(car.z - 24) > 6)) { ex = GRID_MAX; ez = 24; }
    const dist = d2(tx, tz, car.x, car.z);
    let navTx = nearestRoad(ex), navTz = nearestRoad(ez);
    if (tx > GRID_MAX) { navTx = GRID_MAX; navTz = 24; }
    // East of x=288 the Manhattan router is blind: the causeway (z=24) is
    // not in roadLines, so a car 6 m off its centreline gets routed back
    // to the grid (z=48) and orbits the entrance forever. Out there, drive
    // straight at the (gated) target instead. opts.manhattan forces the
    // router even when close (tailing: a direct diagonal at the moving van
    // cuts across blocks/stalls and wrecks the car).
    const useDirect = !opts.manhattan && dist < 40;
    let wp = (useDirect || car.x > GRID_MAX) ? { x: ex, z: ez } : nextWaypoint(car.x, car.z, navTx, navTz);
    const want0 = Math.atan2(-(wp.z - car.z), wp.x - car.x);
    let diff = wrapAngle(want0 - car.heading);
    // U-turn (|diff| ~ pi): the waypoint is behind the car. The old fix
    // aimed at the FINAL target instead — correct at the causeway entrance
    // (target just past the corner) but fatal when the target is far away:
    // at the M3 tail start the car faced north with the waypoint south and
    // the van 270 m east, so the car cut diagonally across the market block
    // into the stall row at (-75,-107) and ground itself to a wreck.
    // Two-phase instead: (1) stop in a STRAIGHT line — steering while
    // braking from speed swings the car wide into buildings (the first
    // one-phase version wrecked M2's leg2 car to 99 damage); (2) creep-turn
    // at ~2 m/s, tight radius, then re-aim at the waypoint next step.
    const needUTurn = Math.abs(diff) > 2.5;
    if (needUTurn) {
      if (Math.abs(car.speed) > 1.5) {
        return { moveX: 0, moveZ: 0, steer: 0, throttle: 0, brake: true, boost: false, enter: false, reload: false, shoot: false, shootAngle: null };
      }
      return {
        moveX: 0, moveZ: 0, steer: Math.sign(diff),
        throttle: 0.1, brake: Math.abs(car.speed) > 2.5,
        boost: false, enter: false, reload: false, shoot: false, shootAngle: null,
      };
    }
    const wpDist = d2(wp.x, wp.z, car.x, car.z);
    // Brake BEFORE a sharp turn at the waypoint: compare the approach angle
    // (car -> wp) with the exit angle (wp -> final target). A waypoint dead
    // ahead gives diff ~ 0, so the old code never braked and the car blew
    // past the corner at 24 m/s, flipped the waypoint behind it and spun
    // the wrong way into Building B's face (x=280).
    const exitAngle = Math.atan2(-(tz - wp.z), tx - wp.x);
    const turnAtWp = Math.abs(wrapAngle(exitAngle - want0));
    const needSlow = turnAtWp > 0.6 && wpDist < 40;
    // traffic ahead? don't rear-end it: brake if close, overtake to the
    // free side if further out (the old autopilot plowed into traffic and
    // wrecked the car twice on the M1 pier run)
    let blocked = null;
    for (const c of s.traffic) {
      const dx = c.x - car.x, dz = c.z - car.z;
      const fwd = dx * Math.cos(car.heading) + dz * (-Math.sin(car.heading));
      const lat = dx * Math.sin(car.heading) + dz * Math.cos(car.heading);
      if (fwd > 0 && fwd < 22 && Math.abs(lat) < 4 && (!blocked || fwd < blocked.fwd)) blocked = { fwd, lat, c };
    }
    let mustBrake = blocked && blocked.fwd < 9;
    if (blocked && !mustBrake) {
      // shift the waypoint to the side opposite the car ahead — but ONLY if
      // the shifted point stays on a road (within 5 m of a road line). The
      // old blind 5 m shift pushed the car off the road into the block
      // west of the causeway entrance, where a building face (x=280)
      // blocks the z=24 line and the car ground itself to a wreck.
      const side = -Math.sign(blocked.lat || 1) * 5;
      const sx = wp.x + Math.sin(car.heading) * side;
      const sz = wp.z + Math.cos(car.heading) * side;
      const onRoad = Math.abs(sx - nearestRoad(sx)) < 5.5 || Math.abs(sz - nearestRoad(sz)) < 5.5;
      if (onRoad) { wp.x = sx; wp.z = sz; }
      else mustBrake = true; // no safe overtake: brake and wait for it to clear
    }
    if (mustBrake) {
      return { moveX: 0, moveZ: 0, steer: clamp(diff * 1.6, -1, 1), throttle: 0, brake: true, boost: false, enter: false, reload: false, shoot: false, shootAngle: null };
    }
    // sharp turns: slow down, otherwise the car orbits the waypoint
    // (turning radius at 8 m/s is ~4 m — it can circle a corner waypoint
    // forever). Brake to ~2 m/s when the turn is sharp or the waypoint near.
    const sharp = Math.abs(diff) > 0.7;
    return {
      moveX: 0, moveZ: 0, steer: clamp(diff * 1.6, -1, 1),
      throttle: blocked ? 0.35 : needSlow ? 0.25 : sharp ? 0.3 : dist < 12 ? 0.4 : 0.6,
      brake: (dist < 8 && Math.abs(car.speed) > 6) || (wpDist < 18 && Math.abs(diff) > 0.4 && Math.abs(car.speed) > 8)
        || (sharp && Math.abs(car.speed) > 7) || (wpDist < 8 && Math.abs(diff) > 0.5 && Math.abs(car.speed) > 3)
        || (needSlow && Math.abs(car.speed) > 9),
      boost: false, enter: false, reload: false, shoot: false, shootAngle: null,
    };
  }
  function walkInput(tx, tz) {
    const s = S(), p = s.player;
    const d = d2(tx, tz, p.x, p.z);
    if (d < 1.5) return noInput();
    return { moveX: (tx - p.x) / d, moveZ: (tz - p.z) / d, steer: 0, throttle: 0, brake: false, boost: true, enter: false, reload: false, shoot: false, shootAngle: null };
  }
  function step(n, fn) { for (let i = 0; i < n; i++) W.step(STEP, fn ? fn() : noInput()); }

  function snap() {
    const s = S(), p = s.player, car = s.heroCar;
    return {
      screen: s.screen, time: +s.time.toFixed(1), hour: +s.hour.toFixed(2),
      mode: p.mode, px: +p.x.toFixed(1), pz: +p.z.toFixed(1), heading: +p.heading.toFixed(2),
      carX: +car.x.toFixed(1), carZ: +car.z.toFixed(1), speed: +(Math.abs(car.speed) * 3.6).toFixed(1),
      speedMs: +car.speed.toFixed(1), damage: Math.round(car.damage),
      health: Math.round(p.health), armour: Math.round(p.armour),
      cash: s.cash, rp: s.rp, wanted: s.wanted, police: s.police.length,
      heli: s.heli.active, heliAlt: Math.round(s.heli.alt),
      ammo: s.ammo, reserve: s.reserve, weapon: s.weapon || 'SOL-9',
      mission: s.missions.active + 1, stage: s.missions.stage + 1, missionTime: +s.missions.missionTime.toFixed(1),
      done: [...s.missions.done], started: s.missions.started,
      objX: s.objective.x, objZ: s.objective.z, objLabel: s.objective.label,
      objDist: Math.round(d2(s.objective.x, s.objective.z, p.mode === 'car' ? car.x : p.x, p.mode === 'car' ? car.z : p.z)),
      dialog: s.missions.dialog ? `${s.missions.dialog.speaker}: ${s.missions.dialog.line}` : null,
      events: [...s.events], kills: s.kills, shotsFired: s.shotsFired, carsStolen: s.carsStolen,
      distDriven: Math.round(s.distanceDriven), shells: s.shellsFound,
      gunmen: s.gunmen.map((g) => ({ alive: g.alive, hp: g.hp, x: Math.round(g.x), z: Math.round(g.z) })),
      vanX: Math.round(s.van.x), vanZ: Math.round(s.van.z), tailTime: +s.tailTime.toFixed(1),
      gameOver: s.gameOver, won: s.won, crew: { ...s.crew },
      traffic: s.traffic.length, pedsAlive: s.peds.filter((q) => q.alive).length,
    };
  }

  function ensureInCar(maxSec = 20) {
    const s = S();
    if (s.player.mode === 'car') return { ok: true };
    // walk Manhattan-style to the car (routes around buildings — walking
    // straight at it can pin the hero against a wall when the car wrecked
    // against one), then press E
    const w = walkTo(s.heroCar.x, s.heroCar.z, { timeout: maxSec, arriveR: 3.5 });
    if (!w.ok) return { ok: false, reason: 'walk-to-car-failed', ...w };
    for (let i = 0; i < Math.round(3 / STEP); i++) {
      if (S().player.mode === 'car') return { ok: true };
      W.step(STEP, { ...noInput(), enter: true });
    }
    return { ok: false, reason: 'enter-failed', ...snap() };
  }

  function driveTo(tx, tz, opts = {}) {
    const timeout = opts.timeout || 120, arriveR = opts.arriveR || 8;
    const maxSteps = Math.round(timeout / STEP);
    let stuckT = 0, reversing = 0, revSteer = 0, lastSteer = 0, minD = Infinity, maxSpeed = 0;
    let bumps = 0, lastDamage = S().heroCar.damage;
    let bestD = Infinity, lastImprove = 0;
    for (let i = 0; i < maxSteps; i++) {
      const s = S();
      if (s.gameOver) return { ok: false, reason: 'gameover', time: +(i * STEP).toFixed(1), ...snap() };
      if (s.heroCar.damage > lastDamage) { bumps++; lastDamage = s.heroCar.damage; }
      maxSpeed = Math.max(maxSpeed, Math.abs(s.heroCar.speed));
      if (s.player.mode !== 'car') {
        const r = ensureInCar(20);
        if (!r.ok) return { ok: false, reason: 'cant-enter-car', time: +(i * STEP).toFixed(1), ...snap() };
        continue;
      }
      const car = s.heroCar;
      const d = d2(car.x, car.z, tx, tz);
      minD = Math.min(minD, d);
      if (d <= arriveR) return { ok: true, time: +(i * STEP).toFixed(1), minD: +minD.toFixed(1), maxSpeedKmh: +(maxSpeed * 3.6).toFixed(1), bumps, ...snap() };
      // progress watchdog: no improvement in 10 s (e.g. orbiting a waypoint)
      // -> reverse out for 1.5 s and retry
      if (d < bestD - 2) { bestD = d; lastImprove = i * STEP; }
      if (i * STEP - lastImprove > 10 && reversing <= 0) {
        reversing = 90; revSteer = -Math.sign(lastSteer || 1) * 0.8; lastImprove = i * STEP;
      }
      let inp;
      if (reversing > 0) {
        reversing--;
        inp = { ...noInput(), steer: revSteer, brake: true };
      } else {
        inp = driveInput(tx, tz);
        lastSteer = inp.steer;
        if (Math.abs(car.speed) < 0.6 && inp.throttle > 0) stuckT += STEP; else stuckT = 0;
        if (stuckT > 2.5) { reversing = 80; revSteer = -Math.sign(lastSteer || 1) * 0.8; stuckT = 0; }
      }
      W.step(STEP, inp);
    }
    return { ok: false, reason: 'timeout', time: timeout, minD: +minD.toFixed(1), maxSpeedKmh: +(maxSpeed * 3.6).toFixed(1), bumps, ...snap() };
  }

  function walkTo(tx, tz, opts = {}) {
    const timeout = opts.timeout || 120, arriveR = opts.arriveR || 2;
    const maxSteps = Math.round(timeout / STEP);
    let minD = Infinity, bestD = Infinity, lastImprove = 0, detour = null, detourTried = 0;
    const stallLog = [], walkLog = [];
    for (let i = 0; i < maxSteps; i++) {
      const s = S();
      if (s.gameOver) return { ok: false, reason: 'gameover', time: +(i * STEP).toFixed(1), ...snap() };
      if (s.player.mode !== 'walk') return { ok: false, reason: 'not-on-foot', time: +(i * STEP).toFixed(1), ...snap() };
      const d = d2(s.player.x, s.player.z, tx, tz);
      minD = Math.min(minD, d);
      if (d < bestD - 0.1) { bestD = d; lastImprove = i * STEP; }
      if (i % 30 === 0) walkLog.push({ t: +(i * STEP).toFixed(1), px: +s.player.x.toFixed(1), pz: +s.player.z.toFixed(1), d: +d.toFixed(1), mode: s.player.mode });
      if (d <= arriveR) return { ok: true, time: +(i * STEP).toFixed(1), minD: +minD.toFixed(1), walkLog, ...snap() };
      // shoot back while closing in: gunmen fire from 30 m, so a silent
      // walk across the safehouse plaza is a death sentence (~4 dmg/s)
      let shoot = {};
      if (opts.shootAt) {
        const g = opts.shootAt();
        if (g) shoot = { shoot: true, shootAngle: Math.atan2(-(g.z - s.player.z), g.x - s.player.x) };
      }
      // stalled (no progress for 3 s): something is between the hero and
      // the target (a stopped traffic car, a building face) — detour around
      // it via a point 8 m to the side of the target, then resume
      if (detour) {
        if (d2(s.player.x, s.player.z, detour.x, detour.z) <= 3) { detour = null; continue; }
        W.step(STEP, { ...walkInput(detour.x, detour.z), ...shoot });
        continue;
      }
      if (i * STEP - lastImprove > 3 && detourTried < 2) {
        detourTried++;
        const dx = tx - s.player.x, dz = tz - s.player.z, len = Math.hypot(dx, dz) || 1;
        const side = detourTried === 1 ? 1 : -1;
        detour = { x: tx + (-dz / len) * 8 * side, z: tz + (dx / len) * 8 * side };
        lastImprove = i * STEP;
        // record what is blocking the hero (nearest traffic car / ped)
        let nt = null, nd = Infinity;
        for (const c of s.traffic) { const dd = d2(s.player.x, s.player.z, c.x, c.z); if (dd < nd) { nd = dd; nt = { id: c.id, kind: c.kind, x: +c.x.toFixed(1), z: +c.z.toFixed(1), speed: +c.speed.toFixed(1), heading: +c.heading.toFixed(2) }; } }
        let np = null, npd = Infinity;
        for (const pd of s.peds) { if (!pd.alive) continue; const dd = d2(s.player.x, s.player.z, pd.x, pd.z); if (dd < npd) { npd = dd; np = { x: +pd.x.toFixed(1), z: +pd.z.toFixed(1) }; } }
        stallLog.push({ t: +(i * STEP).toFixed(1), px: +s.player.x.toFixed(1), pz: +s.player.z.toFixed(1), target: { x: tx, z: tz }, detour, nearestTraffic: nt, nearestTrafficD: +nd.toFixed(1), nearestPed: np, nearestPedD: +npd.toFixed(1) });
        continue;
      }
      const wp = nextWaypoint(s.player.x, s.player.z, tx, tz);
      const wIn = walkInput(wp.x, wp.z);
      if (wIn.moveX === 0 && wIn.moveZ === 0) {
        // within walkInput's 1.5 m dead zone of the waypoint: step toward the
        // final target instead, or the walker stalls 1.2 m short forever
        // (playtest: hero froze at (286.8, 24), 6 m from the car)
        W.step(STEP, { ...walkInput(tx, tz), ...shoot });
      } else W.step(STEP, { ...wIn, ...shoot });
    }
    return { ok: false, reason: 'timeout', time: timeout, minD: +minD.toFixed(1), stallLog, walkLog, ...snap() };
  }

  function traceDrive(tx, tz, opts = {}) {
    // drive with a per-2s position log + every damage event, to find where
    // the car leaves the road (causeway-entrance wreck diagnosis)
    const timeout = opts.timeout || 240;
    const maxSteps = Math.round(timeout / STEP);
    const log = [];
    let lastDmg = S().heroCar.damage, lastLog = -10;
    for (let i = 0; i < maxSteps; i++) {
      const s = S();
      if (s.gameOver) { log.push({ t: +(i * STEP).toFixed(1), note: 'gameover' }); break; }
      if (s.player.mode !== 'car') { log.push({ t: +(i * STEP).toFixed(1), note: 'on-foot', px: +s.player.x.toFixed(1), pz: +s.player.z.toFixed(1), cx: +s.heroCar.x.toFixed(1), cz: +s.heroCar.z.toFixed(1) }); break; }
      const car = s.heroCar;
      const d = d2(car.x, car.z, tx, tz);
      if (d <= (opts.arriveR || 8)) { log.push({ t: +(i * STEP).toFixed(1), note: 'arrived', x: +car.x.toFixed(1), z: +car.z.toFixed(1) }); break; }
      if (s.heroCar.damage !== lastDmg) {
        log.push({ t: +(i * STEP).toFixed(1), note: 'damage', dmg: s.heroCar.damage, x: +car.x.toFixed(1), z: +car.z.toFixed(1), speed: +car.speed.toFixed(1), heading: +car.heading.toFixed(2) });
        lastDmg = s.heroCar.damage;
      }
      if (i * STEP - lastLog >= 2) {
        lastLog = i * STEP;
        log.push({ t: +lastLog.toFixed(1), x: +car.x.toFixed(1), z: +car.z.toFixed(1), speed: +car.speed.toFixed(1), dmg: s.heroCar.damage, heading: +car.heading.toFixed(2) });
      }
      const inp = driveInput(tx, tz);
      if (i % 30 === 0 && (i * STEP < 6 || Math.abs(inp.steer) < 0.05)) log.push({ t: +(i * STEP).toFixed(2), note: 'input', steer: +inp.steer.toFixed(2), thr: inp.throttle, brk: inp.brake, x: +car.x.toFixed(1), z: +car.z.toFixed(1), heading: +car.heading.toFixed(2), speed: +car.speed.toFixed(1) });
      W.step(STEP, inp);
    }
    return { log, ...snap() };
  }

  function exitCar() {
    const s = S();
    if (s.player.mode === 'walk') return { ok: true, ...snap() };
    for (let i = 0; i < Math.round(10 / STEP); i++) {
      const st = S();
      if (st.player.mode === 'walk') return { ok: true, ...snap() };
      if (Math.abs(st.heroCar.speed) < 1) W.step(STEP, { ...noInput(), enter: true });
      else W.step(STEP, { ...noInput(), brake: true });
    }
    return { ok: false, reason: 'timeout-exit', ...snap() };
  }

  function shootAt(g, opts = {}) {
    const timeout = opts.timeout || 30;
    const maxSteps = Math.round(timeout / STEP);
    const before = { hp: g.hp, ammo: S().ammo, shots: S().shotsFired, kills: S().kills, cash: S().cash, wanted: S().wanted };
    let sawFlash = false;
    for (let i = 0; i < maxSteps; i++) {
      const s = S();
      if (!g.alive) return { ok: true, killed: true, time: +(i * STEP).toFixed(1), sawFlash, before, after: { hp: g.hp, ammo: s.ammo, shots: s.shotsFired, kills: s.kills, cash: s.cash, wanted: s.wanted }, ...snap() };
      if (s.gameOver) return { ok: false, reason: 'gameover', sawFlash, before, ...snap() };
      if (s.ammo <= 0) return { ok: false, reason: 'out-of-ammo', sawFlash, before, ...snap() };
      if (g.hitFlash > 0) sawFlash = true;
      const ang = Math.atan2(-(g.z - s.player.z), g.x - s.player.x);
      W.step(STEP, { ...noInput(), shoot: true, shootAngle: ang });
    }
    return { ok: false, reason: 'timeout', sawFlash, before, ...snap() };
  }

  // nearest alive gunman inside SOL-9 range (26 m) — for shoot-while-moving
  function nearestGunmanInRange() {
    const s = S();
    let best = null, bestD = 26;
    for (const g of s.gunmen) {
      if (!g.alive) continue;
      const d = d2(s.player.x, s.player.z, g.x, g.z);
      if (d < bestD) { bestD = d; best = g; }
    }
    return best;
  }

  // ---- setup-only helpers (flagged in results) ----
  function teleport(x, z, mode) {
    const s = S();
    s.heroCar.x = x; s.heroCar.z = z; s.heroCar.heading = 0; s.heroCar.speed = 0;
    s.player.x = x; s.player.z = z; s.player.heading = 0;
    if (mode) s.player.mode = mode;
    return snap();
  }
  function setWanted(n) { const s = S(); s.wanted = n; s.wantedTimer = 0; return snap(); }
  function setHealth(h, a) { const s = S(); s.player.health = h; s.player.armour = a; return snap(); }
  function damageCar(d) { const s = S(); s.heroCar.damage = d; return snap(); }
  function pinClock(h) { W.pinClock(h); return snap(); }
  function unpinClock() { const s = S(); s.clockPinned = null; return snap(); }
  function reset(seed) { W.reset(seed || 1); S().screen = 'play'; return snap(); }
  function startPlay() { S().screen = 'play'; return snap(); }
  function ff(seconds, fn) { step(Math.round(seconds / STEP), fn); return snap(); }
  function buildings() { return W.layout.buildings.map((b) => ({ x: b.x, z: b.z, w: b.w, d: b.d })); }

  // ---- probes ----
  function probeTrafficPed(seconds) {
    // SETUP: hero on foot, standing still IN THE TRAFFIC LANE — eastbound
    // lane of the z=0 road is z=+3 (cars drive at road +/- 3 m).
    teleport(-72, 3, 'walk');
    const s = S(); s.player.heading = 0;
    let minDist = Infinity, overlapFrames = 0, closestCar = null, samples = 0;
    const n = Math.round(seconds / STEP);
    for (let i = 0; i < n; i++) {
      W.step(STEP, noInput());
      const st = S();
      for (const c of st.traffic) {
        const d = d2(st.player.x, st.player.z, c.x, c.z);
        if (d < minDist) { minDist = d; closestCar = { id: c.id, kind: c.kind, x: +c.x.toFixed(1), z: +c.z.toFixed(1) }; }
        if (d < 2.5) overlapFrames++;
      }
      samples++;
    }
    return { minDist: +minDist.toFixed(2), overlapFrames, samples, closestCar, heroAlive: true, heroPos: { x: -72, z: 3 }, ...snap() };
  }
  function probeTrafficTraffic(seconds) {
    let minPair = Infinity, minPairIds = null, minPairKinds = null;
    let hardOverlapFrames = 0, closeFrames = 0, maxConsecHard = 0, consecHard = 0;
    let minBldg = Infinity, minBldgCar = null;
    const bl = W.layout.buildings;
    // signed clearance: negative = inside a footprint (penetration)
    const signedClearance = (x, z) => {
      let m = Infinity;
      for (const b of bl) {
        const dx = Math.abs(x - b.x) - b.w / 2, dz = Math.abs(z - b.z) - b.d / 2;
        const d = (dx > 0 || dz > 0) ? Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) : -Math.min(-dx, -dz);
        if (d < m) m = d;
      }
      return m;
    };
    const n = Math.round(seconds / STEP);
    for (let i = 0; i < n; i++) {
      W.step(STEP, noInput());
      const st = S();
      let hardThisStep = false, closeThisStep = false;
      for (let a = 0; a < st.traffic.length; a++) for (let b = a + 1; b < st.traffic.length; b++) {
        const d = d2(st.traffic[a].x, st.traffic[a].z, st.traffic[b].x, st.traffic[b].z);
        if (d < minPair) { minPair = d; minPairIds = [st.traffic[a].id, st.traffic[b].id]; minPairKinds = [st.traffic[a].kind, st.traffic[b].kind]; }
        if (d < 2.5) hardThisStep = true;
        if (d < 3.5) closeThisStep = true;
      }
      if (hardThisStep) { hardOverlapFrames++; consecHard++; maxConsecHard = Math.max(maxConsecHard, consecHard); } else consecHard = 0;
      if (closeThisStep) closeFrames++;
      if (i % 10 === 0) for (const c of st.traffic) {
        const cl = signedClearance(c.x, c.z);
        if (cl < minBldg) { minBldg = cl; minBldgCar = { id: c.id, kind: c.kind, x: +c.x.toFixed(1), z: +c.z.toFixed(1) }; }
      }
    }
    return { minPairDist: +minPair.toFixed(2), minPairIds, minPairKinds, hardOverlapFrames, closeFrames, maxConsecHardFrames: maxConsecHard, minTrafficBldgClearance: +minBldg.toFixed(2), minBldgCar, ...snap() };
  }
  function probeCarBuilding() {
    // drive a city loop; record hero-car building penetration (negative = inside)
    const bl = W.layout.buildings;
    const pen = (x, z) => {
      let worst = Infinity;
      for (const b of bl) {
        const inside = Math.abs(x - b.x) < b.w / 2 + 0.8 && Math.abs(z - b.z) < b.d / 2 + 0.8;
        if (inside) {
          const px = b.w / 2 + 0.8 - Math.abs(x - b.x);
          const pz = b.d / 2 + 0.8 - Math.abs(z - b.z);
          worst = Math.min(worst, -Math.min(px, pz));
        }
      }
      return worst;
    };
    let worstPen = 0, worstAt = null, dmg0 = S().heroCar.damage;
    const legs = [[240, 120], [240, -240], [-240, -240], [-240, 192], [0, 0]];
    const legResults = [];
    for (const [tx, tz] of legs) {
      const r = driveTo(tx, tz, { timeout: 150, arriveR: 10 });
      legResults.push({ to: [tx, tz], ok: r.ok, time: r.time, reason: r.reason || null });
      if (!r.ok) break;
    }
    // sample penetration along the way was inside driveTo; re-scan via a second pass is
    // impossible retroactively, so penetration is checked live below in a dedicated loop.
    return { legs: legResults, damageDelta: S().heroCar.damage - dmg0, note: 'penetration scanned in probeCarBuildingLive', ...snap() };
  }
  function probeCarBuildingLive(seconds) {
    // autopilot wanders; every step checks hero-car penetration into footprints
    const bl = W.layout.buildings;
    let worstPen = 0, worstAt = null;
    const targets = [[240, 120], [240, -240], [-240, -240], [-240, 192], [0, 0], [-72, -144]];
    let ti = 0;
    const n = Math.round(seconds / STEP);
    for (let i = 0; i < n; i++) {
      const s = S();
      if (s.gameOver) break;
      if (s.player.mode !== 'car') { const r = ensureInCar(20); if (!r.ok) break; continue; }
      const car = s.heroCar;
      for (const b of bl) {
        if (Math.abs(car.x - b.x) < b.w / 2 + 0.8 && Math.abs(car.z - b.z) < b.d / 2 + 0.8) {
          const px = b.w / 2 + 0.8 - Math.abs(car.x - b.x);
          const pz = b.d / 2 + 0.8 - Math.abs(car.z - b.z);
          const p = -Math.min(px, pz);
          if (p < worstPen) { worstPen = p; worstAt = { x: +car.x.toFixed(1), z: +car.z.toFixed(1), b: { x: b.x, z: b.z, w: b.w, d: b.d } }; }
        }
      }
      const [tx, tz] = targets[ti % targets.length];
      if (d2(car.x, car.z, tx, tz) < 10) ti++;
      W.step(STEP, driveInput(tx, tz));
    }
    return { worstPenetration: +worstPen.toFixed(2), worstAt, ...snap() };
  }
  function probeWalkBuilding() {
    // Pick a building with a face on a road; place the hero on the road
    // side of that face (verified free of EVERY building footprint), then
    // walk straight into the face and measure the closest approach.
    const bl = W.layout.buildings;
    const insideAny = (x, z, m = 0.8) => bl.some((b) => Math.abs(x - b.x) < b.w / 2 + m && Math.abs(z - b.z) < b.d / 2 + m);
    let pick = null;
    for (const b of bl) {
      if (b.h > 30) continue;
      const faces = [
        { x: b.x, z: b.z + b.d / 2 + 4, mx: 0, mz: -1 },
        { x: b.x, z: b.z - b.d / 2 - 4, mx: 0, mz: 1 },
        { x: b.x + b.w / 2 + 4, z: b.z, mx: -1, mz: 0 },
        { x: b.x - b.w / 2 - 4, z: b.z, mx: 1, mz: 0 },
      ];
      for (const f of faces) {
        if (!insideAny(f.x, f.z)) { pick = { b, ...f }; break; }
      }
      if (pick) break;
    }
    if (!pick) return { ok: false, reason: 'no-free-face-found' };
    const { b } = pick;
    teleport(pick.x, pick.z, 'walk');
    const start = snap();
    let minGap = Infinity, inside = false;
    for (let i = 0; i < Math.round(6 / STEP); i++) {
      W.step(STEP, { ...noInput(), moveX: pick.mx, moveZ: pick.mz, boost: true });
      const s = S();
      const gap = Math.max(Math.abs(s.player.x - b.x) - b.w / 2, Math.abs(s.player.z - b.z) - b.d / 2);
      minGap = Math.min(minGap, gap);
      if (insideAny(s.player.x, s.player.z, 0)) inside = true;
    }
    return { building: { x: +b.x.toFixed(1), z: +b.z.toFixed(1), w: +b.w.toFixed(1), d: +b.d.toFixed(1) }, startPos: { x: pick.x, z: pick.z }, minGapToFace: +minGap.toFixed(2), insideAnyBuilding: inside, ...snap() };
  }
  function probePoliceBuilding(seconds) {
    // SETUP: wanted 3, hero parked; police chase through the city — do they cut buildings?
    teleport(-72, 0, 'car');
    setWanted(3);
    const bl = W.layout.buildings;
    let worstPen = 0, worstAt = null;
    const n = Math.round(seconds / STEP);
    for (let i = 0; i < n; i++) {
      W.step(STEP, noInput());
      const s = S();
      for (const pc of s.police) {
        for (const b of bl) {
          if (Math.abs(pc.x - b.x) < b.w / 2 + 0.8 && Math.abs(pc.z - b.z) < b.d / 2 + 0.8) {
            const px = b.w / 2 + 0.8 - Math.abs(pc.x - b.x);
            const pz = b.d / 2 + 0.8 - Math.abs(pc.z - b.z);
            const p = -Math.min(px, pz);
            if (p < worstPen) { worstPen = p; worstAt = { x: +pc.x.toFixed(1), z: +pc.z.toFixed(1), b: { x: b.x, z: b.z, w: b.w, d: b.d } }; }
          }
        }
      }
    }
    return { worstPenetration: +worstPen.toFixed(2), worstAt, police: S().police.length, ...snap() };
  }

  function probeTrafficPedStop() {
    // DETERMINISTIC: put one traffic car 24 m west of the hero, in the same
    // lane, heading east at full speed — it must stop before the hero.
    // (Junction turns are random, so retry up to 5 fresh resets until the
    // car actually approaches; every attempt must still show no pass-through.)
    const attempts = [];
    for (let a = 0; a < 5; a++) {
      W.reset(1); S().screen = 'play';
      teleport(-72, 3, 'walk');
      const s = S();
      const c = s.traffic[0];
      c.x = -96; c.z = 3; c.heading = 0; c.speed = 11;
      let minD = Infinity, stopped = false, stoppedAt = null, approached = false;
      for (let i = 0; i < Math.round(4 / STEP); i++) {
        W.step(STEP, noInput());
        const st = S();
        const d = d2(st.player.x, st.player.z, c.x, c.z);
        minD = Math.min(minD, d);
        if (d < 12) approached = true;
        if (c.speed < 0.5 && !stopped) { stopped = true; stoppedAt = { d: +d.toFixed(1), t: +(i * STEP).toFixed(1) }; }
      }
      attempts.push({ minDist: +minD.toFixed(2), approached, stopped, stoppedAt, finalSpeed: +c.speed.toFixed(2) });
      if (approached && stopped) break;
    }
    return { attempts, passThrough: attempts.some((x) => x.minDist < 2.5), ...snap() };
  }

  function probeTopSpeed() {
    // straight road z=0 eastward from spawn; full throttle, then boost
    teleport(-240, 0, 'car');
    const s = S(); s.heroCar.heading = 0;
    let maxPlain = 0, maxBoost = 0;
    for (let i = 0; i < Math.round(12 / STEP); i++) {
      W.step(STEP, { ...noInput(), throttle: 1 });
      maxPlain = Math.max(maxPlain, Math.abs(S().heroCar.speed));
    }
    const plainKmh = +(maxPlain * 3.6).toFixed(1);
    for (let i = 0; i < Math.round(12 / STEP); i++) {
      W.step(STEP, { ...noInput(), throttle: 1, boost: true });
      maxBoost = Math.max(maxBoost, Math.abs(S().heroCar.speed));
    }
    const boostKmh = +(maxBoost * 3.6).toFixed(1);
    // brake to a stop, then reverse (S = brake) for 6 s
    for (let i = 0; i < Math.round(6 / STEP); i++) W.step(STEP, { ...noInput(), brake: true });
    const stoppedSpeed = +S().heroCar.speed.toFixed(2);
    let maxReverse = 0;
    for (let i = 0; i < Math.round(6 / STEP); i++) {
      W.step(STEP, { ...noInput(), brake: true });
      maxReverse = Math.min(maxReverse, S().heroCar.speed);
    }
    // handbrake feel: from speed, Space should cut speed fast
    teleport(-240, 0, 'car');
    S().heroCar.heading = 0;
    for (let i = 0; i < Math.round(8 / STEP); i++) W.step(STEP, { ...noInput(), throttle: 1 });
    const vBefore = +S().heroCar.speed.toFixed(1);
    for (let i = 0; i < Math.round(2 / STEP); i++) W.step(STEP, { ...noInput(), brake: true });
    const vAfter2s = +S().heroCar.speed.toFixed(1);
    return { topSpeedKmh: plainKmh, topSpeedBoostKmh: boostKmh, stoppedSpeed, maxReverseMs: +maxReverse.toFixed(1), maxReverseKmh: +(Math.abs(maxReverse) * 3.6).toFixed(1), brakeFromKmh: +(vBefore * 3.6).toFixed(1), brakeAfter2sKmh: +(vAfter2s * 3.6).toFixed(1), ...snap() };
  }

  function debugReenter() {
    // wreck the car against a wall, then trace ensureInCar step by step.
    W.reset(1); S().screen = 'play';
    teleport(-200, -144, 'car');
    S().heroCar.heading = Math.PI / 2; // north into the block face
    let wrecked = false;
    for (let i = 0; i < Math.round(30 / STEP); i++) {
      W.step(STEP, { ...noInput(), throttle: 1 });
      if (S().player.mode === 'walk') { wrecked = true; break; }
    }
    const trace = [];
    const s0 = S();
    trace.push({ t: 0, mode: s0.player.mode, d: +d2(s0.player.x, s0.player.z, s0.heroCar.x, s0.heroCar.z).toFixed(2), px: +s0.player.x.toFixed(1), pz: +s0.player.z.toFixed(1), cx: +s0.heroCar.x.toFixed(1), cz: +s0.heroCar.z.toFixed(1), dmg: Math.round(s0.heroCar.damage), wrecked });
    // manual ensureInCar with tracing
    for (let i = 0; i < Math.round(20 / STEP); i++) {
      const st = S();
      if (st.player.mode === 'car') { trace.push({ t: +(i * STEP).toFixed(1), mode: 'car', entered: true }); break; }
      const d = d2(st.player.x, st.player.z, st.heroCar.x, st.heroCar.z);
      if (i % 30 === 0) {
        let nearTraffic = Infinity;
        for (const c of st.traffic) nearTraffic = Math.min(nearTraffic, d2(st.player.x, st.player.z, c.x, c.z));
        trace.push({ t: +(i * STEP).toFixed(1), mode: st.player.mode, d: +d.toFixed(2), px: +st.player.x.toFixed(1), pz: +st.player.z.toFixed(1), cx: +st.heroCar.x.toFixed(1), cz: +st.heroCar.z.toFixed(1), nearTraffic: +nearTraffic.toFixed(1) });
      }
      if (d < 4) W.step(STEP, { ...noInput(), enter: true });
      else if (d < 12) W.step(STEP, walkInput(st.heroCar.x, st.heroCar.z));
      else {
        const wp = nextWaypoint(st.player.x, st.player.z, nearestRoad(st.heroCar.x), nearestRoad(st.heroCar.z));
        W.step(STEP, walkInput(wp.x, wp.z));
      }
    }
    const end = S();
    trace.push({ t: 'end', mode: end.player.mode, d: +d2(end.player.x, end.player.z, end.heroCar.x, end.heroCar.z).toFixed(2) });
    return { wrecked, trace };
  }

  // ---- missions ----
  function mission1() {
    const cash0 = S().cash, rp0 = S().rp, t0 = S().time;
    const leg1 = driveTo(-72, -144, { timeout: 180, arriveR: 5 });
    if (!leg1.ok) return { mission: 1, ok: false, phase: 'pickup', ...leg1 };
    const stageAfterPickup = snap();
    const leg2 = driveTo(384, 24, { timeout: 240, arriveR: 5 });
    const end = snap();
    return {
      mission: 1, ok: end.done[0] === true, phase: 'deliver', leg1: { ok: leg1.ok, time: leg1.time },
      leg2: { ok: leg2.ok, time: leg2.time, reason: leg2.reason || null },
      missionTime: end.missionTime, cashDelta: end.cash - cash0, rpDelta: end.rp - rp0,
      dialog: end.dialog, events: end.events, ...end,
    };
  }
  function mission2() {
    const cash0 = S().cash, rp0 = S().rp;
    // stage 0 is foot-only: drive NEAR the stadium, then walk in.
    const leg0 = driveTo(-192, 96, { timeout: 180, arriveR: 5 });
    if (!leg0.ok) return { mission: 2, ok: false, phase: 'drive-near-stadium', ...leg0 };
    // NEGATIVE foot-only test: drive the car right up to the stadium
    // (inside the 4 m radius) — the stage must NOT advance while in the car.
    const carTest = driveTo(-192, 143, { timeout: 60, arriveR: 3 });
    const stageInCar = S().missions.stage;
    const distInCar = Math.round(d2(S().heroCar.x, S().heroCar.z, -192, 144));
    const ex = exitCar();
    if (!ex.ok) return { mission: 2, ok: false, phase: 'exit-car', carTest, stageInCar, ...ex };
    const stageBeforeWalk = S().missions.stage;
    const walk = walkTo(-192, 144, { timeout: 120, arriveR: 3 });
    const afterWalk = snap();
    if (!walk.ok) return { mission: 2, ok: false, phase: 'walk-to-stadium', stageBeforeWalk, ...walk };
    const en = ensureInCar(20);
    if (!en.ok) return { mission: 2, ok: false, phase: 're-enter-car', ...en };
    const leg2 = driveTo(240, 120, { timeout: 240, arriveR: 5 });
    const end = snap();
    return {
      mission: 2, ok: end.done[1] === true, phase: 'marina-drop',
      leg0: { ok: leg0.ok, time: leg0.time },
      footOnlyNegative: { carTestOk: carTest.ok, carDistToStadium: distInCar, stageWhileInCar: stageInCar + 1, mustStayAtStage1: stageInCar === 0 },
      walk: { ok: walk.ok, time: walk.time },
      stageBeforeWalk, stageAfterWalk: afterWalk.stage,
      leg2: { ok: leg2.ok, time: leg2.time, reason: leg2.reason || null },
      cashDelta: end.cash - cash0, rpDelta: end.rp - rp0, dialog: end.dialog, events: end.events, ...end,
    };
  }
  function mission3() {
    const cash0 = S().cash, rp0 = S().rp;
    const leg0 = driveTo(-96, -120, { timeout: 180, arriveR: 5 });
    if (!leg0.ok) return { mission: 3, ok: false, phase: 'find-van', ...leg0 };
    // stage 1: stay within 40 m of the moving van until tailTime > 20
    const maxSteps = Math.round(300 / STEP);
    let t = 0;
    const tailLog = [];
    let lastDmg = S().heroCar.damage, lastLogT = -10;
    for (let i = 0; i < maxSteps; i++) {
      const s = S();
      if (s.missions.done[2]) break;
      if (s.gameOver) return { mission: 3, ok: false, phase: 'tail', reason: 'gameover', tailLog, ...snap() };
      if (s.player.mode !== 'car') { const r = ensureInCar(20); if (!r.ok) return { mission: 3, ok: false, phase: 'tail-reenter', tailLog, ...snap() }; continue; }
      const inp = driveInput(s.van.x, s.van.z, { manhattan: true });
      // tail gently: don't ram the van — ease off inside 25 m and match
      // its 9 m/s cruise instead of closing in
      const dv = d2(s.heroCar.x, s.heroCar.z, s.van.x, s.van.z);
      if (dv < 25) { inp.throttle = 0.2; inp.brake = s.heroCar.speed > 11; }
      W.step(STEP, inp);
      t = i * STEP;
      if (s.heroCar.damage !== lastDmg) { tailLog.push({ t: +t.toFixed(1), note: 'damage', dmg: s.heroCar.damage, x: +s.heroCar.x.toFixed(1), z: +s.heroCar.z.toFixed(1), speed: +s.heroCar.speed.toFixed(1), heading: +s.heroCar.heading.toFixed(2), vanX: +s.van.x.toFixed(0), vanZ: +s.van.z.toFixed(0) }); lastDmg = s.heroCar.damage; }
      if (t - lastLogT >= 5) { lastLogT = t; tailLog.push({ t: +t.toFixed(1), x: +s.heroCar.x.toFixed(1), z: +s.heroCar.z.toFixed(1), speed: +s.heroCar.speed.toFixed(1), dmg: s.heroCar.damage, heading: +s.heroCar.heading.toFixed(2), vanX: +s.van.x.toFixed(0), vanZ: +s.van.z.toFixed(0), dv: +dv.toFixed(0), tailTime: +s.tailTime.toFixed(1) }); }
    }
    const end = snap();
    return {
      mission: 3, ok: end.done[2] === true, phase: 'tail',
      leg0: { ok: leg0.ok, time: leg0.time }, tailSeconds: t, tailLog,
      tailTime: end.tailTime, cashDelta: end.cash - cash0, rpDelta: end.rp - rp0,
      dialog: end.dialog, events: end.events, ...end,
    };
  }
  function mission4(attempt) {
    const cash0 = S().cash, rp0 = S().rp;
    const tStart = S().missions.missionTime;
    const leg0 = driveTo(-72, 48, { timeout: 180, arriveR: 5 });
    if (!leg0.ok) return { mission: 4, ok: false, phase: 'drive-safehouse', attempt, ...leg0 };
    const ex = exitCar();
    if (!ex.ok) return { mission: 4, ok: false, phase: 'exit-car', attempt, ...ex };
    // kill the 3 gunmen (they spawn at the safehouse on M4 stage 0) —
    // shoot WHILE closing in, nearest first; a silent walk is a death
    // sentence (gunmen fire from 30 m at ~4 dmg/s combined)
    const combat = [];
    for (let round = 0; round < 3; round++) {
      if (S().gameOver) break;
      const alive = S().gunmen.filter((g) => g.alive);
      if (alive.length === 0) break;
      alive.sort((a, b) => d2(S().player.x, S().player.z, a.x, a.z) - d2(S().player.x, S().player.z, b.x, b.z));
      const g = alive[0];
      const d = d2(S().player.x, S().player.z, g.x, g.z);
      if (d > 20) {
        const w = walkTo(g.x, g.z, { timeout: 60, arriveR: 18, shootAt: nearestGunmanInRange });
        if (!w.ok) { combat.push({ gunman: 'walk-failed', ...w }); break; }
      }
      const r = shootAt(g, { timeout: 30 });
      combat.push(r);
      if (!r.ok) break;
    }
    if (S().gunmen.some((g) => g.alive)) return { mission: 4, ok: false, phase: 'combat', attempt, combat, ...snap() };
    const healthAfterCombat = snap();
    // walk back inside the safehouse (24 m radius) so the heat decays at
    // 4 s/star instead of waiting for the police to get 110 m away
    walkTo(-72, 48, { timeout: 30, arriveR: 10, shootAt: nearestGunmanInRange });
    // lose the heat: stand in the safehouse until wanted 0
    const maxSteps = Math.round(150 / STEP);
    let decayed = false;
    for (let i = 0; i < maxSteps; i++) {
      const s = S();
      if (s.missions.stage === 1) { decayed = true; break; }
      if (s.gameOver) return { mission: 4, ok: false, phase: 'decay', reason: 'gameover', attempt, combat, ...snap() };
      W.step(STEP, noInput());
    }
    if (!decayed) return { mission: 4, ok: false, phase: 'decay-timeout', attempt, combat, ...snap() };
    const stage1At = snap();
    const en = ensureInCar(20);
    if (!en.ok) return { mission: 4, ok: false, phase: 're-enter-car', attempt, combat, ...en };
    const leg2 = driveTo(384, 24, { timeout: 150, arriveR: 5 });
    const end = snap();
    return {
      mission: 4, ok: end.done[3] === true && end.won === true, phase: 'pier-run', attempt,
      leg0: { ok: leg0.ok, time: leg0.time }, combat: combat.map((c) => ({ killed: c.killed, time: c.time, sawFlash: c.sawFlash, shots: c.after ? c.after.shots - c.before.shots : null })),
      healthAfterCombat: { health: healthAfterCombat.health, armour: healthAfterCombat.armour },
      stage1AtMissionTime: stage1At.missionTime,
      leg2: { ok: leg2.ok, time: leg2.time, reason: leg2.reason || null },
      totalMissionTime: end.missionTime,
      cashDelta: end.cash - cash0, rpDelta: end.rp - rp0,
      dialog: end.dialog, events: end.events, screen: end.screen, won: end.won, ...end,
    };
  }

  return {
    snap, reset, startPlay, ff, teleport, setWanted, setHealth, damageCar, pinClock, unpinClock,
    driveTo, walkTo, exitCar, ensureInCar, shootAt,
    probeTrafficPed, probeTrafficPedStop, probeTrafficTraffic, probeCarBuildingLive, probeWalkBuilding, probePoliceBuilding, probeTopSpeed, debugReenter, traceDrive,
    mission1, mission2, mission3, mission4,
    driveInput, walkInput, noInput, step,
    saveLoad: async (slot) => {
      const m = await import('/src/sim.js');
      return { save: m.saveGame(W, slot), load: m.loadGame(W, slot) };
    },
    saveGame: async (slot) => { const m = await import('/src/sim.js'); return m.saveGame(W, slot); },
    loadGame: async (slot) => { const m = await import('/src/sim.js'); return m.loadGame(W, slot); },
  };
})();
