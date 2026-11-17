// Traffic + pedestrians (Phase 3): pure rules, no drawing and no browser in it, so
// the same code runs in the game and in a headless Node test. Cars follow the road
// grid, keep the right-hand lane, brake for the car ahead, and turn at
// intersections; pedestrians walk the sidewalks and run from danger. Nothing here
// uses Math.random or the clock: every choice comes from the seeded generator the
// world hands in at reset, so the same seed gives the same city traffic.
//
// A road car is { road: 'v'|'h', line, dir, s, speed }: on a vertical road the
// line is its x and s is its z; on a horizontal road the line is its z and s is
// its x. dir is +1 or -1 along the road. Heading follows from road+dir, and the
// lane offset from the direction of travel (right-hand side). Legs that cross
// the marina channel are blocked, except the bridge deck on the z -6 road (cars
// only — pedestrians never cross the channel).
import { CITY, TRAFFIC } from './config.js';
import { roadLines } from './city.js';

const BOUNDS = { minX: -312, maxX: 312, minZ: -312, maxZ: 312 };

/** Every road centre line, internal roads plus the perimeter ring. */
export function allLines() {
  const lines = [...roadLines(), -312, 312];
  return lines.sort((a, b) => a - b);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** The next line strictly beyond `from` in direction `dir`, or null at the edge. */
function nextLine(lines, from, dir) {
  if (dir > 0) {
    for (const line of lines) if (line > from + 0.001) return line;
  } else {
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (lines[i] < from - 0.001) return lines[i];
    }
  }
  return null;
}

/**
 * Does the axis-aligned leg from (ax,az) to (bx,bz) cross the marina channel
 * water? The bridge deck (z -12..0) lets cars across; pedestrians never cross.
 */
function channelBlocked(ax, az, bx, bz, isPed) {
  const ch = CITY.channel;
  const m = 1;
  if (ax === bx) {
    if (ax < ch.x0 - m || ax > ch.x1 + m) return false;
    const z0 = Math.min(az, bz);
    const z1 = Math.max(az, bz);
    return z0 < ch.z1 + m && z1 > ch.z0 - m;
  }
  if (az < ch.z0 - m || az > ch.z1 + m) return false;
  const x0 = Math.min(ax, bx);
  const x1 = Math.max(ax, bx);
  if (!(x0 < ch.x1 + m && x1 > ch.x0 - m)) return false;
  if (!isPed && az >= CITY.bridge.z - CITY.bridge.width / 2 && az <= CITY.bridge.z + CITY.bridge.width / 2) return false;
  return true;
}

/**
 * The leg leaving intersection (ix,iz) along `road` in direction `dir`: the far
 * intersection, or null when the leg is missing (grid edge) or blocked (channel).
 */
export function legFrom(ix, iz, road, dir, isPed) {
  const lines = allLines();
  if (road === 'v') {
    const to = nextLine(lines, iz, dir);
    if (to === null) return null;
    if (channelBlocked(ix, iz, ix, to, isPed)) return null;
    return { to, x1: ix, z1: to };
  }
  const to = nextLine(lines, ix, dir);
  if (to === null) return null;
  if (channelBlocked(ix, iz, to, iz, isPed)) return null;
  return { to, x1: to, z1: iz };
}

/** Right-hand lane offset for the direction of travel. */
export function laneOffset(road, dir) {
  if (road === 'v') return dir > 0 ? TRAFFIC.lane : -TRAFFIC.lane;
  return dir > 0 ? -TRAFFIC.lane : TRAFFIC.lane;
}

/** World position + heading of a road car (its lane offset blends after a turn). */
export function roadPos(car) {
  if (car.road === 'v') {
    return { x: car.line + car.laneNow, z: car.s, heading: car.dir > 0 ? 0 : Math.PI };
  }
  return { x: car.s, z: car.line + car.laneNow, heading: car.dir > 0 ? Math.PI / 2 : -Math.PI / 2 };
}

/**
 * Push a circle (x, z, radius) out of every collider it overlaps; returns the
 * corrected position and whether it hit anything. (Same rule as the world's
 * resolveCircle, duplicated here so this file stays dependency-free.)
 */
export function pushOutOfColliders(x, z, radius, colliders) {
  let hit = false;
  for (let i = 0; i < colliders.length; i += 1) {
    const c = colliders[i];
    const closestX = clamp(x, c.minX, c.maxX);
    const closestZ = clamp(z, c.minZ, c.maxZ);
    const dx = x - closestX;
    const dz = z - closestZ;
    const distSq = dx * dx + dz * dz;
    if (distSq >= radius * radius) continue;
    hit = true;
    if (distSq > 0.000001) {
      const dist = Math.sqrt(distSq);
      const push = (radius - dist) / dist;
      x += dx * push;
      z += dz * push;
    } else {
      const pushLeft = x - c.minX + radius;
      const pushRight = c.maxX - x + radius;
      const pushUp = z - c.minZ + radius;
      const pushDown = c.maxZ - z + radius;
      const min = Math.min(pushLeft, pushRight, pushUp, pushDown);
      if (min === pushLeft) x = c.minX - radius;
      else if (min === pushRight) x = c.maxX + radius;
      else if (min === pushUp) z = c.minZ - radius;
      else z = c.maxZ + radius;
    }
  }
  return { x, z, hit };
}

/**
 * Advance a road car one step along the grid. `decide(car, ix, iz, turns,
 * canStraight)` is called at each intersection the car reaches: `turns` lists
 * the available turn options { road, dir } (the crossing road, either way); it
 * returns 'straight', 'uturn', or one of the turn options. The car never leaves
 * the grid and never crosses the channel except on the bridge (cars) or never
 * at all (pedestrians).
 */
export function stepRoadCar(car, dt, decide, isPed) {
  let remaining = Math.abs(car.speed) * dt;
  let guard = 0;
  while (remaining > 0.0001 && guard < 4) {
    guard += 1;
    const lines = allLines();
    const ahead = nextLine(lines, car.s, car.dir);
    if (ahead === null) {
      // Grid edge: turn around.
      car.dir = -car.dir;
      car.laneTarget = laneOffset(car.road, car.dir);
      continue;
    }
    const dist = Math.abs(ahead - car.s);
    if (dist > remaining) {
      car.s += car.dir * remaining;
      remaining = 0;
      break;
    }
    // Reach the intersection (centre = road line + crossing line).
    car.s = ahead;
    remaining -= dist;
    const ix = car.road === 'v' ? car.line : ahead;
    const iz = car.road === 'v' ? ahead : car.line;
    const turns = [];
    const crossRoad = car.road === 'v' ? 'h' : 'v';
    for (const d of [1, -1]) {
      if (legFrom(ix, iz, crossRoad, d, isPed)) turns.push({ road: crossRoad, dir: d });
    }
    const canStraight = Boolean(legFrom(ix, iz, car.road, car.dir, isPed));
    const choice = decide(car, ix, iz, turns, canStraight);
    if (choice === 'uturn' || (!canStraight && choice === 'straight')) {
      car.dir = -car.dir;
      car.laneTarget = laneOffset(car.road, car.dir);
    } else if (choice && choice !== 'straight') {
      // Turn onto the crossing road: the new line is the intersection centre,
      // the new s is the position along it (the old lateral position).
      const pos = roadPos(car);
      car.road = choice.road;
      car.line = car.road === 'v' ? ix : iz;
      car.dir = choice.dir;
      car.s = car.road === 'v' ? pos.z : pos.x;
      car.laneTarget = laneOffset(car.road, car.dir);
    }
    // Straight: nothing changes; the loop continues on the remaining distance.
  }
  // Cars ease their lane offset into its target after a turn (no 3 m pop at
  // corners); pedestrians keep their sidewalk offset (blendLane false).
  if (car.blendLane !== false) {
    const laneDelta = car.laneTarget - car.laneNow;
    const laneStep = clamp(laneDelta, -6 * dt, 6 * dt);
    car.laneNow += laneStep;
  }
}

/** Snap a free position to the nearest road (used after a pedestrian flees). */
export function snapToRoad(x, z, heading) {
  const lines = allLines();
  let bestV = null;
  let bestVd = Infinity;
  let bestH = null;
  let bestHd = Infinity;
  for (const line of lines) {
    const dv = Math.abs(x - line);
    if (dv < bestVd) { bestVd = dv; bestV = line; }
    const dh = Math.abs(z - line);
    if (dh < bestHd) { bestHd = dh; bestH = line; }
  }
  // Pick the nearer road; the direction follows the heading's dominant axis.
  if (bestVd <= bestHd) {
    return { road: 'v', line: bestV, dir: Math.cos(heading) >= 0 ? 1 : -1, s: clamp(z, BOUNDS.minZ, BOUNDS.maxZ) };
  }
  return { road: 'h', line: bestH, dir: Math.sin(heading) >= 0 ? 1 : -1, s: clamp(x, BOUNDS.minX, BOUNDS.maxX) };
}

function inChannel(x, z) {
  const ch = CITY.channel;
  return x >= ch.x0 && x <= ch.x1 && z >= ch.z0 && z <= ch.z1;
}

/** A random valid road spot (not in the channel, not near the player spawn). */
function randomRoadSpot(random, isPed, nearX, nearZ) {
  const lines = allLines();
  for (let tries = 0; tries < 40; tries += 1) {
    const road = random() < 0.5 ? 'v' : 'h';
    const line = lines[Math.floor(random() * lines.length)];
    const dir = random() < 0.5 ? 1 : -1;
    const s = -280 + random() * 560;
    const lane = isPed ? 0 : laneOffset(road, dir);
    const x = road === 'v' ? line + lane : s;
    const z = road === 'v' ? s : line + lane;
    if (isPed) {
      // Pedestrians walk the sidewalk strip; the spot itself must be dry land.
      // The side is chosen here so the validity check tests the real position.
      const side = random() < 0.5 ? 1 : -1;
      const px = road === 'v' ? line + side * TRAFFIC.sidewalkOffset : s;
      const pz = road === 'v' ? s : line + side * TRAFFIC.sidewalkOffset;
      if (inChannel(px, pz)) continue;
      if (Math.hypot(px - nearX, pz - nearZ) < 25) continue;
      return { road, line, dir, s, x: px, z: pz, side };
    }
    if (inChannel(x, z)) continue;
    if (Math.hypot(x - nearX, z - nearZ) < 25) continue;
    return { road, line, dir, s, x, z };
  }
  return { road: 'h', line: -6, dir: 1, s: -200, x: -200, z: -6 };
}

export function createTraffic(city) {
  const state = {
    cars: [],
    peds: [],
    stats: { hits: 0, respawns: 0, pedHits: 0, gridlockEvents: 0 },
  };
  let rng = () => 0.5;

  function spawnCar(nearX, nearZ) {
    const spot = randomRoadSpot(rng, false, nearX, nearZ);
    const lane = laneOffset(spot.road, spot.dir);
    const kindRoll = rng();
    const car = {
      road: spot.road,
      line: spot.line,
      dir: spot.dir,
      s: spot.s,
      laneNow: lane,
      laneTarget: lane,
      blendLane: true,
      cruise: TRAFFIC.speedMin + rng() * (TRAFFIC.speedMax - TRAFFIC.speedMin),
      speed: 0,
      targetSpeed: 0,
      kind: kindRoll < 0.2 ? 'taxi' : kindRoll < 0.35 ? 'van' : 'sedan',
      colorIndex: Math.floor(rng() * 4),
      stuckTime: 0,
      stoppedUntil: 0,
      hitCooldown: 0,
      x: spot.x,
      z: spot.z,
      heading: spot.road === 'v' ? (spot.dir > 0 ? 0 : Math.PI) : (spot.dir > 0 ? Math.PI / 2 : -Math.PI / 2),
    };
    car.speed = car.cruise * 0.5;
    return car;
  }

  function spawnPed(nearX, nearZ) {
    const spot = randomRoadSpot(rng, true, nearX, nearZ);
    const side = spot.side;
    const ped = {
      road: spot.road,
      line: spot.line,
      dir: spot.dir,
      s: spot.s,
      side,
      // A pedestrian's "lane" is its sidewalk strip: fixed, never blended.
      laneNow: side * TRAFFIC.sidewalkOffset,
      laneTarget: side * TRAFFIC.sidewalkOffset,
      blendLane: false,
      cruise: TRAFFIC.pedWalkMin + rng() * (TRAFFIC.pedWalkMax - TRAFFIC.pedWalkMin),
      speed: 0,
      state: 'walk',
      timer: 0,
      shirt: Math.floor(rng() * 6),
      x: spot.x,
      z: spot.z,
      heading: spot.road === 'v' ? (spot.dir > 0 ? 0 : Math.PI) : (spot.dir > 0 ? Math.PI / 2 : -Math.PI / 2),
      fleeX: 0,
      fleeZ: 0,
    };
    ped.speed = ped.cruise;
    return ped;
  }

  function reset(random, nearX, nearZ) {
    rng = random;
    state.cars = [];
    state.peds = [];
    state.stats = { hits: 0, respawns: 0, pedHits: 0, gridlockEvents: 0 };
    for (let i = 0; i < TRAFFIC.count; i += 1) state.cars.push(spawnCar(nearX, nearZ));
    for (let i = 0; i < TRAFFIC.pedCount; i += 1) state.peds.push(spawnPed(nearX, nearZ));
  }

  /** The nearest vehicle ahead of road car `a` in its lane, or null. */
  function vehicleAhead(a, ctx) {
    let best = null;
    const consider = (bx, bz, speed) => {
      let lateral;
      let along;
      if (a.road === 'v') {
        lateral = Math.abs(bx - (a.line + a.laneNow));
        along = (bz - a.z) * a.dir;
      } else {
        lateral = Math.abs(bz - (a.line + a.laneNow));
        along = (bx - a.x) * a.dir;
      }
      if (lateral > 3.5 || along <= 0 || along > TRAFFIC.brakeDistance) return;
      if (!best || along < best.gap) best = { gap: along, speed };
    };
    for (const other of state.cars) {
      if (other === a) continue;
      consider(other.x, other.z, other.speed);
    }
    for (const p of ctx.police) consider(p.x, p.z, p.speed);
    if (ctx.mode === 'car') consider(ctx.car.x, ctx.car.z, Math.abs(ctx.car.speed));
    return best;
  }

  function decideTrafficTurn(car, ix, iz, turns, canStraight) {
    const r = rng();
    if (r < 0.55 && canStraight) return 'straight';
    if (turns.length > 0) return turns[Math.floor(rng() * turns.length)];
    if (canStraight) return 'straight';
    return 'uturn';
  }

  function stepCars(dt, ctx) {
    for (const c of state.cars) {
      c.hitCooldown = Math.max(0, c.hitCooldown - dt);
      if (ctx.time < c.stoppedUntil) {
        c.targetSpeed = 0;
      } else {
        const ahead = vehicleAhead(c, ctx);
        c.targetSpeed = ahead ? Math.min(c.cruise, ahead.speed) : c.cruise;
        if (ahead && ahead.gap < 5) c.targetSpeed = 0;
      }
      const accel = c.targetSpeed < c.speed ? 20 : 6;
      c.speed += clamp(c.targetSpeed - c.speed, -accel * dt, accel * dt);
      if (c.targetSpeed > 1 && c.speed < 0.5) {
        c.stuckTime += dt;
        if (c.stuckTime > TRAFFIC.stuckSeconds) {
          state.stats.gridlockEvents += 1;
          const fresh = spawnCar(ctx.car.x, ctx.car.z);
          Object.assign(c, fresh);
          state.stats.respawns += 1;
          continue;
        }
      } else {
        c.stuckTime = 0;
      }
      stepRoadCar(c, dt, decideTrafficTurn, false);
      const p = roadPos(c);
      c.x = p.x;
      c.z = p.z;
      c.heading = p.heading;
      // The player's car hitting a traffic car: a crime, and both cars stop short.
      if (ctx.mode === 'car' && c.hitCooldown <= 0) {
        const dx = c.x - ctx.car.x;
        const dz = c.z - ctx.car.z;
        if (dx * dx + dz * dz < 3.4 * 3.4 && Math.abs(ctx.car.speed) > 2) {
          ctx.commitCrime('hit-traffic');
          c.stoppedUntil = ctx.time + 1.5;
          c.hitCooldown = 1.5;
          ctx.car.speed *= 0.5;
          ctx.car.x -= Math.sin(ctx.car.heading) * 1;
          ctx.car.z -= Math.cos(ctx.car.heading) * 1;
          state.stats.hits += 1;
        }
      }
    }
  }

  function decidePedTurn(ped, ix, iz, turns, canStraight) {
    const r = rng();
    if (r < 0.7 && canStraight) return 'straight';
    if (turns.length > 0) return turns[Math.floor(rng() * turns.length)];
    if (canStraight) return 'straight';
    return 'uturn';
  }

  function stepPeds(dt, ctx) {
    for (const ped of state.peds) {
      if (ped.state === 'down') {
        ped.timer -= dt;
        if (ped.timer <= 0) {
          const fresh = spawnPed(ctx.car.x, ctx.car.z);
          Object.assign(ped, fresh);
        }
        continue;
      }
      // The player's car hitting a pedestrian: a crime, and the pedestrian goes
      // down. Checked for walking AND fleeing pedestrians — a ped the car is
      // about to hit is always fleeing (the car within 6 m scares it off), so
      // a check that only ran for walking peds could never fire at all.
      if (ctx.mode === 'car') {
        const dx = ped.x - ctx.car.x;
        const dz = ped.z - ctx.car.z;
        if (dx * dx + dz * dz < 2.2 * 2.2 && Math.abs(ctx.car.speed) > 3) {
          ctx.commitCrime('hit-ped');
          ped.state = 'down';
          ped.timer = 2;
          state.stats.pedHits += 1;
          continue;
        }
      }
      // Danger: a moving car close by sends the pedestrian running away from it.
      let threat = null;
      if (ctx.mode === 'car' && Math.abs(ctx.car.speed) > 1) {
        const d = Math.hypot(ped.x - ctx.car.x, ped.z - ctx.car.z);
        if (d < TRAFFIC.pedFleeDistance) threat = { x: ctx.car.x, z: ctx.car.z };
      }
      if (!threat) {
        for (const p of ctx.police) {
          const d = Math.hypot(ped.x - p.x, ped.z - p.z);
          if (d < 7) { threat = { x: p.x, z: p.z }; break; }
        }
      }
      if (threat && ped.state !== 'flee') {
        ped.state = 'flee';
        ped.timer = TRAFFIC.pedFleeSeconds;
        const dx = ped.x - threat.x;
        const dz = ped.z - threat.z;
        const len = Math.hypot(dx, dz) || 1;
        ped.fleeX = dx / len;
        ped.fleeZ = dz / len;
        ped.heading = Math.atan2(ped.fleeX, ped.fleeZ);
      }
      if (ped.state === 'flee') {
        ped.timer -= dt;
        ped.speed = TRAFFIC.pedFleeSpeed;
        let x = ped.x + ped.fleeX * ped.speed * dt;
        let z = ped.z + ped.fleeZ * ped.speed * dt;
        x = clamp(x, BOUNDS.minX, BOUNDS.maxX);
        z = clamp(z, BOUNDS.minZ, BOUNDS.maxZ);
        const resolved = pushOutOfColliders(x, z, 0.55, ctx.colliders);
        ped.x = resolved.x;
        ped.z = resolved.z;
        if (ped.timer <= 0) {
          // Back to the sidewalk: snap to the nearest road and keep walking.
          const snapped = snapToRoad(ped.x, ped.z, ped.heading);
          ped.road = snapped.road;
          ped.line = snapped.line;
          ped.dir = snapped.dir;
          ped.s = snapped.s;
          ped.side = ped.road === 'v'
            ? (ped.x >= ped.line ? 1 : -1)
            : (ped.z >= ped.line ? 1 : -1);
          ped.laneNow = ped.side * TRAFFIC.sidewalkOffset;
          ped.laneTarget = ped.laneNow;
          ped.state = 'walk';
          ped.speed = ped.cruise;
        }
        continue;
      }
      // Walking the sidewalk: same road follower as the cars, slower, and the
      // channel is closed to pedestrians entirely (no bridge crossing on foot).
      // roadPos reads the sidewalk offset from laneNow, so it is the position.
      ped.speed = ped.cruise;
      stepRoadCar(ped, dt, decidePedTurn, true);
      const p = roadPos(ped);
      ped.x = p.x;
      ped.z = p.z;
      ped.heading = p.heading;
    }
  }

  function step(dt, ctx) {
    stepCars(dt, ctx);
    stepPeds(dt, ctx);
  }

  return { state, reset, step };
}
