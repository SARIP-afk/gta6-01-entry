// Solmarina (fresh build) — the simulation. Pure logic, no DOM, no three.js:
// fixed 1/60 s steps, seeded RNG everywhere, so the same seed + inputs give
// the same trace. The renderer only reads this state, it never mutates it.
import { mulberry32, hash2, clamp, wrapAngle, dist2 } from './util.js';
import {
  STEP, ROAD_STEP, GRID_MIN, GRID_MAX, ROAD_HALF, BEACH_Z, SEA_Z, PIER,
  CAUSEWAY_Z, SPAWN, SAFEHOUSE, MARKET, STADIUM, MARINA_DROP,
  DOWNTOWN_PICKUP, PIER_END, buildLayout, nearestRoad, onRoad, districtAt,
} from './layout.js';

export { STEP };

export const MISSIONS = [
  {
    id: 0, name: 'FIRST DROP', reward: 500, par: 150,
    stages: [
      { label: 'Pick up the package downtown', x: DOWNTOWN_PICKUP.x, z: DOWNTOWN_PICKUP.z, footOnly: false },
      { label: 'Deliver it to the pier', x: PIER_END.x, z: PIER_END.z, footOnly: false },
    ],
    intro: ['DANTE', 'Rio. A package downtown, a pier at the end of the world. Don\'t be late.'],
  },
  {
    id: 1, name: 'THE HANDOFF', reward: 800, par: 180,
    stages: [
      { label: 'Meet SANA at the stadium — on foot', x: STADIUM.x, z: STADIUM.z, footOnly: true },
      { label: 'Drop the case at the marina', x: MARINA_DROP.x, z: MARINA_DROP.z, footOnly: false },
    ],
    intro: ['SANA', 'Stadium, north gate. Come on foot — wheels draw eyes.'],
  },
  {
    id: 2, name: 'TAIL THE VAN', reward: 1200, par: 240,
    stages: [
      { label: 'Find Dante\'s gold van downtown', x: -96, z: -120, footOnly: false },
      { label: 'Stay on the van to the marina', x: MARINA_DROP.x, z: MARINA_DROP.z, footOnly: false },
    ],
    intro: ['DANTE', 'Gold van, downtown. Tail it to the marina. Close, but not too close.'],
  },
  {
    id: 3, name: 'LOSE THE HEAT', reward: 2000, par: 240,
    stages: [
      { label: 'Lose the cordon — get CLEAR', x: SAFEHOUSE.x, z: SAFEHOUSE.z, footOnly: false },
      { label: 'Run the pier in 120 seconds', x: PIER_END.x, z: PIER_END.z, footOnly: false },
    ],
    intro: ['DANTE', 'It\'s a trap. Lose them — then bring it home.'],
  },
];

export const WEAPONS = {
  'FISTS': { dmg: 0, range: 0, spread: 0, mag: 0 },
  'SOL-9': { dmg: 34, range: 26, spread: 0.12, mag: 12 },
  'SMG': { dmg: 16, range: 22, spread: 0.16, mag: 30 },
  '12G': { dmg: 55, range: 14, spread: 0.28, mag: 6 },
};
export const WEAPON_ORDER = ['FISTS', 'SOL-9', 'SMG', '12G'];
const WANTED_TIERS = ['CLEAR', 'HEAT 1', 'HEAT 2', 'HEAT 3', 'HEAT 4', 'MAXIMUM FORCE'];
const CAR_COLORS = ['#c0392b', '#2980b9', '#f1c40f', '#ecf0f1', '#2c3e50', '#e67e22', '#16a085', '#8e44ad'];
const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
const SHIRTS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#ecf0f1', '#e67e22'];
const PANTS = ['#2c3e50', '#1a1a2e', '#34495e', '#7f8c8d', '#6b4226', '#2f3640'];

function fnv(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function createWorld(seed = 1) {
  const layout = buildLayout(seed);
  const world = { seed, layout, state: null, rng: null };
  world.reset = function (s = seed) { resetWorld(world, s); };
  world.step = function (dt, input) { stepWorld(world, dt, input || {}); };
  world.pinClock = function (hour) { world.state.clockPinned = hour; };
  world.traceHash = function () { return traceHash(world); };
  world.reset(seed);
  return world;
}

function resetWorld(world, seed) {
  const rng = mulberry32(seed * 1013 + 7);
  const s = {
    time: 0, hour: 17.5, clockPinned: null, cash: 7270, rp: 1675, rank: 9,
    player: { x: SPAWN.x, z: SPAWN.z, heading: SPAWN.heading, mode: 'car', health: 95, armour: 27, speed: 0, walkPhase: 0 },
    heroCar: { x: SPAWN.x, z: SPAWN.z + 4, heading: SPAWN.heading, speed: 0, damage: 0, color: '#e74c3c', model: 'SOLMAR GT', kind: 'sport' },
    ammo: 48, reserve: 90, weapon: 'SOL-9',
    ammoStore: { 'SOL-9': { ammo: 48, reserve: 90 }, 'SMG': { ammo: 120, reserve: 180 }, '12G': { ammo: 12, reserve: 24 } },
    wanted: 0, wantedTimer: 0, heat: 0,
    traffic: [], peds: [], police: [], gunmen: [],
    van: null, tailTime: 0,
    heli: { x: 0, z: -100, alt: 55, active: false, angle: 0, staged: false },
    missions: { active: 0, stage: 0, started: false, missionTime: 0, done: [false, false, false, false], dialog: null, dialogTimer: 0 },
    objective: { x: DOWNTOWN_PICKUP.x, z: DOWNTOWN_PICKUP.z, label: 'Pick up the package downtown' },
    shells: world.layout.shells.map((sh) => ({ ...sh })), shellsFound: 0,
    exportsDone: 0, standing: {},
    crew: { mira: 0, lio: 0, kiki: 0 },
    events: [], kills: 0, shotsFired: 0, carsStolen: 0, distanceDriven: 0, hitCooldown: 0,
    screen: 'title', paused: false, gameOver: false, won: false,
    trace: [],
  };
  for (const d of ['DOWNTOWN', 'OLD HARBOR', 'NORTHGATE', 'STADIUM ROW', 'PALM BEACH', 'FOUNDRY', 'MARINA']) s.standing[d] = 58;
  // traffic: 24 cars + 6 scooters on the road grid
  for (let i = 0; i < 30; i++) {
    const kind = i < 4 ? 'van' : i < 8 ? 'taxi' : i < 24 ? 'sedan' : 'scooter';
    const rx = GRID_MIN + Math.floor(rng() * 13) * ROAD_STEP;
    const rz = GRID_MIN + Math.floor(rng() * 13) * ROAD_STEP;
    s.traffic.push({
      id: i, kind, x: rx + (rng() < 0.5 ? 3 : -3), z: rz + (rng() < 0.5 ? 3 : -3),
      heading: Math.floor(rng() * 4) * Math.PI / 2, speed: 6 + rng() * 5,
      color: kind === 'taxi' ? '#f1c40f' : CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)],
      target: null, stuck: 0,
    });
  }
  // the gold van for M3
  s.van = { x: -96, z: -120, heading: 0, speed: 0, color: '#d4af37', kind: 'van', route: 0 };
  // peds: 48 walkers on sidewalks
  for (let i = 0; i < 48; i++) {
    const rx = GRID_MIN + Math.floor(rng() * 13) * ROAD_STEP;
    const rz = GRID_MIN + Math.floor(rng() * 13) * ROAD_STEP;
    s.peds.push({
      id: i, x: rx + 9 + rng() * 4, z: rz + 9 + rng() * 4,
      heading: rng() * Math.PI * 2, speed: 1 + rng() * 0.8,
      skin: SKINS[Math.floor(rng() * SKINS.length)],
      shirt: SHIRTS[Math.floor(rng() * SHIRTS.length)],
      pants: PANTS[Math.floor(rng() * PANTS.length)],
      hair: ['#1a1a1a', '#4a2c14', '#d4a017', '#888888'][Math.floor(rng() * 4)],
      phase: rng() * Math.PI * 2, alive: true,
    });
  }
  world.state = s;
  world.rng = rng;
  return s;
}

function logEvent(s, text) {
  s.events.unshift(text);
  if (s.events.length > 5) s.events.pop();
}

function missionDef(s) { return MISSIONS[s.missions.active]; }
function currentStage(s) {
  const m = missionDef(s);
  return m ? m.stages[s.missions.stage] : null;
}

function setObjective(s) {
  const st = currentStage(s);
  if (st) s.objective = { x: st.x, z: st.z, label: st.label };
}

function startMission(s, i) {
  const m = MISSIONS[i];
  s.missions.active = i; s.missions.stage = 0; s.missions.started = true; s.missions.missionTime = 0;
  s.missions.dialog = { speaker: m.intro[0], line: m.intro[1] };
  s.missions.dialogTimer = 6;
  setObjective(s);
  logEvent(s, `MISSION ${i + 1} · ${m.name}`);
}

/** Switch weapon by index (1-4). Saves the current weapon's mag/reserve,
 * loads the new one; FISTS carries no ammo. Returns the weapon name. */
export function setWeapon(world, index) {
  const s = world.state;
  const name = WEAPON_ORDER[clamp(index, 0, WEAPON_ORDER.length - 1)];
  if (name === s.weapon) return name;
  if (s.weapon !== 'FISTS') s.ammoStore[s.weapon] = { ammo: s.ammo, reserve: s.reserve };
  s.weapon = name;
  if (name === 'FISTS') { s.ammo = Infinity; s.reserve = Infinity; }
  else { const st = s.ammoStore[name]; s.ammo = st.ammo; s.reserve = st.reserve; }
  return name;
}

export function wantedTier(w) { return WANTED_TIERS[clamp(w, 0, 5)]; }

function setWanted(s, w, reason) {
  w = clamp(w, 0, 5);
  if (w > s.wanted) {
    s.wanted = w;
    logEvent(s, `WANTED ${wantedTier(w)}${reason ? ' — ' + reason : ''}`);
    if (w >= 4) s.heli.active = true;
  } else if (w < s.wanted) s.wanted = w;
  s.wantedTimer = 0;
}

function nearestTrafficCar(s, x, z, maxD) {
  let best = null, bd = maxD * maxD;
  for (const c of s.traffic) {
    const d = dist2(x, z, c.x, c.z);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

function stepWorld(world, dt, input) {
  const s = world.state;
  const rng = world.rng;
  if (s.paused || s.screen === 'title') return;
  s.time += dt;
  if (s.clockPinned !== null) s.hour = s.clockPinned;
  else s.hour = (s.hour + dt / 240) % 24; // a full day in 4 minutes of play
  if (s.missions.dialogTimer > 0) s.missions.dialogTimer -= dt;
  if (s.hitCooldown > 0) s.hitCooldown -= dt;
  if (s.missions.started) s.missions.missionTime += dt;
  for (const k of ['mira', 'lio', 'kiki']) if (s.crew[k] > 0) s.crew[k] -= dt;

  const p = s.player, car = s.heroCar;
  const heroX = p.mode === 'car' ? car.x : p.x;
  const heroZ = p.mode === 'car' ? car.z : p.z;

  // ---- player on foot ----
  if (p.mode === 'walk') {
    const mx = input.moveX || 0, mz = input.moveZ || 0;
    const len = Math.hypot(mx, mz);
    const run = input.boost ? 9.0 : 6.2;
    if (len > 0.1) {
      const nx = p.x + (mx / len) * run * dt, nz = p.z + (mz / len) * run * dt;
      if (!hitsBuilding(world, nx, p.z)) p.x = nx;
      if (!hitsBuilding(world, p.x, nz)) p.z = nz;
      p.heading = Math.atan2(-(mz / len), mx / len);
      p.walkPhase += dt * run * 1.6;
    }
    p.x = clamp(p.x, -330, 426); p.z = clamp(p.z, -330, 330);
    if (input.enter) {
      // consume the press here: the driving branch below runs in the same
      // step and would otherwise read the same input.enter and exit the
      // car again immediately (enter+exit in one step = never getting in).
      input.enter = false;
      const c = nearestTrafficCar(s, p.x, p.z, 4);
      if (c) {
        s.traffic.splice(s.traffic.indexOf(c), 1);
        car.x = c.x; car.z = c.z; car.heading = c.heading; car.speed = 0;
        car.color = c.color; car.kind = c.kind; car.model = c.kind === 'van' ? 'KARGO VAN' : c.kind === 'taxi' ? 'CABRIO TAXI' : c.kind === 'scooter' ? 'VESPA 50' : 'SEDAN';
        p.mode = 'car'; s.carsStolen++;
        setWanted(s, Math.max(s.wanted, 1), 'car stolen');
        logEvent(s, 'Car stolen — KPD alerted');
      } else if (dist2(p.x, p.z, car.x, car.z) < 25) {
        p.mode = 'car';
      }
    }
    // pick up shells on foot
    for (const sh of s.shells) {
      if (!sh.taken && dist2(p.x, p.z, sh.x, sh.z) < 4) {
        sh.taken = true; s.shellsFound++;
        s.cash += 25; logEvent(s, `Golden shell found (${s.shellsFound}/20) +$25`);
      }
    }
  }

  // ---- driving ----
  if (p.mode === 'car') {
    const steer = clamp(input.steer || 0, -1, 1);
    const throttle = clamp(input.throttle || 0, 0, 1);
    const top = input.boost ? 42 : 34;
    car.speed += (throttle * 15 - (input.brake ? 30 : 0) - car.speed * 0.35) * dt;
    if (throttle === 0 && !input.brake) car.speed *= (1 - 0.6 * dt);
    car.speed = clamp(car.speed, -9, top);
    if (Math.abs(car.speed) > 0.2) {
      car.heading += steer * 1.9 * dt * Math.sign(car.speed) * clamp(Math.abs(car.speed) / 8, 0.3, 1);
      const nx = car.x + Math.cos(car.heading) * car.speed * dt;
      const nz = car.z - Math.sin(car.heading) * car.speed * dt;
      if (!hitsBuilding(world, nx, nz)) { car.x = nx; car.z = nz; }
      else if (s.hitCooldown <= 0) { car.speed *= -0.25; car.damage = Math.min(100, car.damage + 4); s.hitCooldown = 0.4; }
      s.distanceDriven += Math.abs(car.speed) * dt;
    }
    car.x = clamp(car.x, -330, 426); car.z = clamp(car.z, -330, 330);
    if (car.z > SEA_Z - 4 && car.x < 288) { car.z = SEA_Z - 4; car.speed *= 0.5; }
    p.x = car.x; p.z = car.z; p.heading = car.heading;
    if (input.enter && Math.abs(car.speed) < 1) { p.mode = 'walk'; p.x = car.x + 2.5; p.z = car.z + 2.5; }
    if (car.damage >= 100) {
      car.damage = 0; car.speed = 0; p.mode = 'walk';
      // step out on a side that is NOT inside a building: the old fixed
      // (+3,+3) could land inside a footprint and trap the hero against
      // the wall forever (playtest: hero stuck 4.24 m from the car)
      const exits = [[3, 3], [-3, 3], [3, -3], [-3, -3], [0, 5], [0, -5], [5, 0], [-5, 0]];
      let placed = false;
      for (const [ox, oz] of exits) {
        if (!hitsBuilding(world, car.x + ox, car.z + oz)) { p.x = car.x + ox; p.z = car.z + oz; placed = true; break; }
      }
      if (!placed) { p.x = car.x + 3; p.z = car.z + 3; }
      logEvent(s, 'Your car is wrecked');
    }
    // car-vs-traffic bumps (rate-limited: one bump per 0.4 s)
    for (const c of s.traffic) {
      if (dist2(car.x, car.z, c.x, c.z) < 9 && Math.abs(car.speed) > 8 && s.hitCooldown <= 0) {
        c.speed = Math.max(2, c.speed - 4); car.speed *= 0.85; car.damage = Math.min(100, car.damage + 3);
        s.hitCooldown = 0.4;
        if (s.wanted < 1 && Math.abs(car.speed) > 10) setWanted(s, 1, 'hit and run');
      }
    }
  }

  // ---- shooting (current weapon's damage / range / spread) ----
  const w = WEAPONS[s.weapon] || WEAPONS['SOL-9'];
  if (input.shoot && w.dmg > 0 && s.ammo > 0 && p.mode === 'walk') {
    s.ammo--; s.shotsFired++;
    const ang = input.shootAngle ?? p.heading;
    for (const g of s.gunmen) {
      if (!g.alive) continue;
      const d = Math.hypot(g.x - p.x, g.z - p.z);
      const want = Math.atan2(-(g.z - p.z), g.x - p.x);
      if (d < w.range && Math.abs(wrapAngle(want - ang)) < w.spread) {
        g.hp -= w.dmg; g.hitFlash = 0.15;
        if (g.hp <= 0) { g.alive = false; s.kills++; s.cash += 50; setWanted(s, Math.max(s.wanted, 2), 'shooting'); }
      }
    }
    if (s.ammo === 0) logEvent(s, 'Out of ammo — press R');
  }
  if (input.reload && w.dmg > 0 && s.reserve > 0 && s.ammo < w.mag) {
    const need = w.mag - s.ammo, take = Math.min(need, s.reserve);
    s.ammo += take; s.reserve -= take;
  }

  // ---- traffic AI: follow roads, turn at intersections ----
  // Traffic never drives through the hero on foot: a car stops when the
  // hero is in its path ahead, and shoves the hero aside if it is already
  // overlapping (both with building checks, so nobody is pushed into a wall).
  const heroOnFoot = p.mode === 'walk';
  const pedPush = (car) => {
    if (!heroOnFoot) return;
    const d = Math.hypot(p.x - car.x, p.z - car.z);
    if (d >= 2.5 || d < 0.01) return;
    const px = (p.x - car.x) / d, pz = (p.z - car.z) / d;
    const nx = p.x + px * (2.5 - d + 0.3), nz = p.z + pz * (2.5 - d + 0.3);
    if (!hitsBuilding(world, nx, nz)) { p.x = nx; p.z = nz; }
  };
  for (const c of s.traffic) {
    const aheadX = c.x + Math.cos(c.heading) * 6, aheadZ = c.z - Math.sin(c.heading) * 6;
    const nearJunction = Math.abs(aheadX - nearestRoad(aheadX)) < 7 && Math.abs(aheadZ - nearestRoad(aheadZ)) < 7;
    if (nearJunction && rng() < 0.02) {
      c.heading += (rng() < 0.5 ? 1 : -1) * Math.PI / 2;
    }
    // keep to its lane: steer back toward the nearest road centre
    const rx = nearestRoad(c.x), rz = nearestRoad(c.z);
    const onX = Math.abs(c.x - rx) < 8, onZ = Math.abs(c.z - rz) < 8;
    if (!onX && !onZ) {
      c.heading = Math.atan2(-(rz - c.z), rx - c.x);
    }
    // stop for the hero on foot in the path ahead (12 m, 3.5 m half-width)
    let blocked = false;
    if (heroOnFoot) {
      const fx = Math.cos(c.heading), fz = -Math.sin(c.heading);
      const dx = p.x - c.x, dz = p.z - c.z;
      const fwd = dx * fx + dz * fz;
      const lat = Math.abs(dx * Math.sin(c.heading) + dz * Math.cos(c.heading));
      if (fwd > 0 && fwd < 12 && lat < 3.5) {
        c.speed = Math.max(0, c.speed - 25 * dt);
        blocked = c.speed < 0.5;
      }
      pedPush(c);
    }
    if (!blocked) {
      // axis-separated move so a car can never end up inside a building
      const nx = c.x + Math.cos(c.heading) * c.speed * dt;
      const nz = c.z - Math.sin(c.heading) * c.speed * dt;
      if (!hitsBuilding(world, nx, nz)) { c.x = nx; c.z = nz; }
      else if (!hitsBuilding(world, nx, c.z)) { c.x = nx; }
      else if (!hitsBuilding(world, c.x, nz)) { c.z = nz; }
    }
    if (c.x < GRID_MIN - 20 || c.x > 420 || c.z < GRID_MIN - 20 || c.z > 320) {
      c.x = clamp(heroX + (rng() < 0.5 ? -1 : 1) * (90 + rng() * 60), GRID_MIN, 400);
      c.z = clamp(heroZ + (rng() < 0.5 ? -1 : 1) * (90 + rng() * 60), GRID_MIN, 300);
      c.x = nearestRoad(c.x); c.z = nearestRoad(c.z);
    }
    // simple car-car separation (guarded so the push never shoves a car
    // into a building — that was clipping taxis 0.7 m into walls)
    for (const o of s.traffic) {
      if (o === c) continue;
      const d2v = dist2(c.x, c.z, o.x, o.z);
      if (d2v < 16 && d2v > 0.01) {
        const d = Math.sqrt(d2v);
        const push = (4 - d) * 0.5 * dt * 10;
        const nx = c.x + ((c.x - o.x) / d) * push, nz = c.z + ((c.z - o.z) / d) * push;
        if (!hitsBuilding(world, nx, c.z)) c.x = nx;
        if (!hitsBuilding(world, c.x, nz)) c.z = nz;
        c.speed = Math.min(c.speed, o.speed);
      }
    }
  }

  // ---- peds: wander the sidewalks ----
  for (const pd of s.peds) {
    if (!pd.alive) continue;
    pd.phase += dt * pd.speed * 2;
    pd.x += Math.cos(pd.heading) * pd.speed * dt;
    pd.z -= Math.sin(pd.heading) * pd.speed * dt;
    if (rng() < 0.004) pd.heading += (rng() - 0.5) * 2;
    if (pd.x < GRID_MIN || pd.x > 300 || pd.z < GRID_MIN || pd.z > 300 || hitsBuilding(world, pd.x, pd.z)) {
      pd.heading += Math.PI * (0.5 + rng() * 0.5);
      pd.x = clamp(pd.x, GRID_MIN, 300); pd.z = clamp(pd.z, GRID_MIN, 300);
    }
    // hero car running a ped over
    if (p.mode === 'car' && Math.abs(car.speed) > 5 && dist2(car.x, car.z, pd.x, pd.z) < 4) {
      pd.alive = false; setWanted(s, Math.min(5, s.wanted + 2), 'pedestrian down');
    }
  }
  if (s.peds.filter((q) => q.alive).length < 30) {
    for (const pd of s.peds) {
      if (!pd.alive && rng() < 0.1) {
        pd.alive = true;
        pd.x = clamp(heroX + (rng() < 0.5 ? -1 : 1) * (60 + rng() * 40), GRID_MIN, 300);
        pd.z = clamp(heroZ + (rng() < 0.5 ? -1 : 1) * (60 + rng() * 40), GRID_MIN, 300);
      }
    }
  }

  // ---- gold van (M3) drives downtown -> marina on the grid ----
  const van = s.van;
  const vanRoute = [{ x: -96, z: -120 }, { x: -96, z: 0 }, { x: 240, z: 0 }, { x: 240, z: 120 }];
  const vt = vanRoute[van.route % vanRoute.length];
  const vd = Math.hypot(vt.x - van.x, vt.z - van.z);
  if (vd < 4) van.route++;
  else {
    const want = Math.atan2(-(vt.z - van.z), vt.x - van.x);
    van.heading += clamp(wrapAngle(want - van.heading), -1.2 * dt, 1.2 * dt);
    van.speed = 9;
    van.x += Math.cos(van.heading) * van.speed * dt;
    van.z -= Math.sin(van.heading) * van.speed * dt;
  }

  // ---- police ----
  const wantCount = s.wanted === 0 ? 0 : s.wanted + 1;
  while (s.police.length < wantCount) {
    const a = rng() * Math.PI * 2;
    s.police.push({
      x: clamp(heroX + Math.cos(a) * 70, GRID_MIN, 400), z: clamp(heroZ + Math.sin(a) * 70, GRID_MIN, 300),
      heading: 0, speed: 0, search: 0, siren: rng() * 10,
    });
  }
  while (s.police.length > wantCount) s.police.pop();
  for (const pc of s.police) {
    const d = Math.hypot(heroX - pc.x, heroZ - pc.z);
    const want = Math.atan2(-(heroZ - pc.z), heroX - pc.x);
    pc.heading += clamp(wrapAngle(want - pc.heading), -2.2 * dt, 2.2 * dt);
    pc.speed = clamp(pc.speed + (d > 12 ? 4 : -6) * dt, 0, s.wanted >= 4 ? 30 : 26);
    // never run the hero over on foot: hold 6 m out instead of overlapping
    const holdForPed = p.mode === 'walk' && d < 7;
    if (holdForPed) pc.speed = Math.max(0, pc.speed - 30 * dt);
    if (!holdForPed || pc.speed > 0.5) {
      // axis-separated move so police can no longer cut through buildings
      const nx = pc.x + Math.cos(pc.heading) * pc.speed * dt;
      const nz = pc.z - Math.sin(pc.heading) * pc.speed * dt;
      if (!hitsBuilding(world, nx, nz)) { pc.x = nx; pc.z = nz; }
      else if (!hitsBuilding(world, nx, pc.z)) { pc.x = nx; }
      else if (!hitsBuilding(world, pc.x, nz)) { pc.z = nz; }
    }
    pc.siren += dt;
    // ram: rate-limited by the shared hit cooldown (was +0.2/step with no
    // cooldown — 12 damage/s per cop while touching, which wrecked the
    // hero car in seconds during any chase)
    if (d < 5 && pc.speed > 8 && Math.abs(car.speed) > 2 && s.hitCooldown <= 0) {
      car.damage = Math.min(100, car.damage + 0.2);
      car.speed *= 0.995;
      s.hitCooldown = 0.4;
    }
    if (d > 130) pc.search += dt; else pc.search = 0;
  }
  // wanted decays when hidden: far from police, in safehouse, or standing still off-road
  if (s.wanted > 0) {
    s.wantedTimer += dt;
    const inSafe = dist2(heroX, heroZ, SAFEHOUSE.x, SAFEHOUSE.z) < SAFEHOUSE.radius * SAFEHOUSE.radius;
    const nearestCop = s.police.reduce((m, pc) => Math.min(m, Math.hypot(heroX - pc.x, heroZ - pc.z)), 999);
    if ((inSafe && s.wantedTimer > 4) || (nearestCop > 110 && s.wantedTimer > 14)) {
      setWanted(s, s.wanted - 1, 'heat cooling off');
      if (s.wanted === 0) logEvent(s, 'CLEAR — you lost them');
    }
  }

  // ---- helicopter at wanted >= 4, circling the hero ----
  // staged shots freeze it where stageShot put it (staged flag, cleared
  // by reset — real play is untouched, the orbit below is identical)
  const heli = s.heli;
  heli.active = heli.staged || s.wanted >= 4;
  if (heli.active && !heli.staged) {
    heli.angle += dt * 0.35;
    heli.x = heroX + Math.cos(heli.angle) * 26;
    heli.z = heroZ + Math.sin(heli.angle) * 26;
    heli.alt = 48 + Math.sin(s.time * 0.5) * 4;
  }

  // ---- gunmen (M4 stage 0 trap) ----
  if (s.missions.active === 3 && s.missions.stage === 0 && s.missions.started && s.gunmen.length === 0) {
    for (let i = 0; i < 3; i++) {
      s.gunmen.push({ x: SAFEHOUSE.x + 14 + i * 6, z: SAFEHOUSE.z + 10 - i * 8, hp: 100, alive: true, shootTimer: 2 + i, hitFlash: 0 });
    }
  }
  for (const g of s.gunmen) {
    if (!g.alive) continue;
    g.shootTimer -= dt;
    const d = Math.hypot(heroX - g.x, heroZ - g.z);
    if (g.shootTimer <= 0 && d < 30) {
      g.shootTimer = 1.6 + rng() * 0.8;
      if (rng() < 0.4) {
        if (s.player.armour > 0) s.player.armour = Math.max(0, s.player.armour - 6);
        else s.player.health = Math.max(0, s.player.health - 8);
      }
    }
    if (g.hitFlash > 0) g.hitFlash -= dt;
  }
  if (s.player.health <= 0) { s.gameOver = true; s.screen = 'over'; }

  // ---- health regen ----
  if (s.player.health < 100 && s.time % 1 < dt) {
    s.player.health = Math.min(100, s.player.health + 1);
  }

  // ---- missions ----
  if (s.missions.started && !s.gameOver) {
    const m = missionDef(s), st = currentStage(s);
    const dx = heroX - st.x, dz = heroZ - st.z;
    const dObj = Math.hypot(dx, dz);
    if (m.id === 2 && s.missions.stage === 1) {
      const dv = Math.hypot(van.x - heroX, van.z - heroZ);
      if (dv < 40) s.tailTime += dt;
      if (s.tailTime > 20) {
        // tail done — finish the mission here. Setting stage = 2 (out of
        // range) left currentStage() undefined and crashed stepWorld on
        // every subsequent step (st.x on undefined, sim.js:506).
        finishMission(s, m);
      }
    } else if (m.id === 3 && s.missions.stage === 0) {
      // M4 trap: advance when the heat is lost and the gunmen are dead,
      // wherever the hero is. The old code nested this inside the
      // dObj < 7 branch, but the gunmen spawn 14–26 m from the safehouse,
      // so a hero who killed them from range and waited (wanted 0, all
      // gunmen dead) never advanced the stage — a silent soft-lock.
      if (s.wanted === 0 && s.gunmen.every((g) => !g.alive)) { s.missions.stage = 1; setObjective(s); logEvent(s, 'CLEAR — now run the pier'); }
    } else if (st && dObj < (st.footOnly ? 4 : 7) && (!st.footOnly || p.mode === 'walk')) {
      if (s.missions.stage < m.stages.length - 1) {
        s.missions.stage++;
        setObjective(s);
        logEvent(s, `STAGE ${s.missions.stage + 1}/${m.stages.length} · ${currentStage(s).label}`);
      } else {
        finishMission(s, m);
      }
    }
    if (m.id === 3 && s.missions.stage === 1 && s.missions.missionTime > 120) {
      logEvent(s, 'Too slow — the pier run failed, try again');
      s.missions.stage = 0; s.missions.missionTime = 0; setWanted(s, 3, 'the trap resets'); setObjective(s);
    }
    if (s.missions.missionTime > m.par * 2.5 && m.id !== 3) {
      // generous: no fail, the rating just drops to bronze
    }
  }
  if (!s.missions.started && s.screen === 'play') startMission(s, 0);

  // ---- exports: deliver hero car to the marina drop ----
  if (p.mode === 'car' && s.exportsDone < 5 && dist2(car.x, car.z, MARINA_DROP.x, MARINA_DROP.z) < 36 && car.damage < 40) {
    // only counts when the player parks there deliberately for 3 s — handled by renderer hint; keep simple: no auto trigger
  }

  // ---- trace sample (determinism check) ----
  if (Math.floor(s.time / STEP) % 60 === 0) {
    s.trace.push([Math.round(heroX * 10) / 10, Math.round(heroZ * 10) / 10, Math.round(car.speed * 10) / 10, s.wanted, s.cash].join(','));
  }
}

function finishMission(s, m) {
  // idempotent: the mission block keeps running while the hero stands
  // inside the objective radius, and the pier-run car crosses the 7 m
  // mission radius into the 5 m autopilot radius over ~6 steps — without
  // this guard M4 paid out +$2000/+400 RP six times (cash +$12,150).
  if (s.missions.done[m.id]) return;
  s.missions.done[m.id] = true;
  const t = s.missions.missionTime;
  const rating = t <= m.par ? 'GOLD' : t <= m.par * 1.5 ? 'SILVER' : 'BRONZE';
  s.cash += m.reward;
  s.rp += 400;
  s.missions.dialog = { speaker: 'DANTE', line: `${m.name} done — ${rating}. $${m.reward} wired.` };
  s.missions.dialogTimer = 6;
  logEvent(s, `${m.name} complete · ${rating} · +$${m.reward}`);
  if (m.id === 3) { s.won = true; s.screen = 'over'; }
  else { s.missions.started = false; startMission(s, m.id + 1); }
}

function hitsBuilding(world, x, z) {
  for (const b of world.layout.buildings) {
    if (Math.abs(x - b.x) < b.w / 2 + 0.8 && Math.abs(z - b.z) < b.d / 2 + 0.8) return true;
  }
  if (Math.abs(x - MARKET.x) < 26 && Math.abs(z - MARKET.z) < 18) {
    // stalls block the middle of the plaza, walkways stay open
    for (const st of world.layout.stalls) {
      if (Math.abs(x - st.x) < 3.4 && Math.abs(z - st.z) < 1.6) return true;
    }
  }
  return false;
}

function traceHash(world) {
  return fnv(world.state.trace.join('|'));
}

/** Save / load: three slots in localStorage, plain JSON. Saves the full
 * playable state (position, car, health, ammo, weapon, wanted, mission
 * stage) so loading resumes exactly where the player left off. */
export function saveGame(world, slot) {
  const s = world.state;
  const data = {
    cash: s.cash, rp: s.rp, rank: s.rank, shellsFound: s.shellsFound,
    shellsTaken: s.shells.map((sh, i) => (sh.taken ? i : -1)).filter((i) => i >= 0),
    missionsDone: s.missions.done, active: s.missions.active,
    stage: s.missions.stage, missionTime: s.missions.missionTime, started: s.missions.started,
    mode: s.player.mode, x: s.player.x, z: s.player.z, heading: s.player.heading,
    carX: s.heroCar.x, carZ: s.heroCar.z, carHeading: s.heroCar.heading,
    carDamage: s.heroCar.damage, carModel: s.heroCar.model, carColor: s.heroCar.color, carKind: s.heroCar.kind,
    health: s.player.health, armour: s.player.armour,
    weapon: s.weapon, ammoStore: s.ammoStore,
    wanted: s.wanted, gunmenAlive: s.gunmen.map((g) => g.alive),
    hour: s.hour, exportsDone: s.exportsDone,
    standing: s.standing, time: s.time,
  };
  try { localStorage.setItem(`solmarina-save-${slot}`, JSON.stringify(data)); return true; } catch { return false; }
}
export function loadGame(world, slot) {
  try {
    const raw = localStorage.getItem(`solmarina-save-${slot}`);
    if (!raw) return null;
    const d = JSON.parse(raw);
    const s = world.state;
    s.cash = d.cash; s.rp = d.rp; s.rank = d.rank; s.shellsFound = d.shellsFound;
    for (const i of (d.shellsTaken || [])) if (s.shells[i]) s.shells[i].taken = true;
    s.missions.done = d.missionsDone;
    s.missions.active = d.active ?? 0;
    s.missions.stage = d.stage ?? 0;
    s.missions.missionTime = d.missionTime ?? 0;
    s.missions.started = d.started ?? true;
    s.missions.dialog = null; s.missions.dialogTimer = 0;
    s.player.mode = d.mode || 'car';
    s.player.x = d.x; s.player.z = d.z; s.player.heading = d.heading ?? 0;
    s.heroCar.x = d.carX ?? d.x; s.heroCar.z = d.carZ ?? d.z;
    s.heroCar.heading = d.carHeading ?? 0; s.heroCar.speed = 0;
    s.heroCar.damage = d.carDamage ?? 0;
    if (d.carModel) s.heroCar.model = d.carModel;
    if (d.carColor) s.heroCar.color = d.carColor;
    if (d.carKind) s.heroCar.kind = d.carKind;
    if (s.player.mode === 'car') { s.player.x = s.heroCar.x; s.player.z = s.heroCar.z; s.player.heading = s.heroCar.heading; }
    s.player.health = d.health ?? 100; s.player.armour = d.armour ?? 0;
    s.weapon = d.weapon || 'SOL-9';
    s.ammoStore = d.ammoStore || s.ammoStore;
    if (s.weapon === 'FISTS') { s.ammo = Infinity; s.reserve = Infinity; }
    else { const st = s.ammoStore[s.weapon] || { ammo: 48, reserve: 90 }; s.ammo = st.ammo; s.reserve = st.reserve; }
    s.wanted = d.wanted ?? 0; s.wantedTimer = 0;
    if (Array.isArray(d.gunmenAlive)) d.gunmenAlive.forEach((alive, i) => { if (s.gunmen[i]) s.gunmen[i].alive = alive; });
    s.hour = d.hour; s.exportsDone = d.exportsDone;
    s.standing = d.standing; s.time = d.time || 0;
    // resume the saved mission at its saved stage (do NOT restart M1:
    // the old code reset started=false, so the sim re-ran startMission(0))
    if (s.missions.started) setObjective(s);
    return d;
  } catch { return null; }
}
