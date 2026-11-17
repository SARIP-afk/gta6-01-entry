// The game's rules and state, with no drawing and no browser in it: the car, the player
// on foot, arcade physics, AABB collisions, entering and leaving the car, and the
// autopilot that drives the staged screenshots. step() advances one fixed step.
// Heading is an angle; forward is (sin(heading), 0, cos(heading)) — heading 0 faces +z
// (south), PI/2 faces +x (east). Nothing here allocates after createWorld returns.
// Phase 1: steering is capped by yaw rate at speed (CAR.steerYawCap), so the car holds
// a line at 30+ m/s instead of spinning off the road.
// Phase 2: the state also carries the HUD's numbers — wanted level (display-only
// until Phase 3 builds the wanted/police systems), cash, health, the current story
// objective, and `extras`: visual-only cars (police cruisers, traffic) that the cover
// shot stages around the player. Extras never move or collide; they are scenery with
// wheels, placed by the shot stager.
// Phase 3: wanted is LIVE (police.js), and the city lives (traffic.js): traffic
// cars and pedestrians drive and walk the grid, crimes raise the wanted level,
// cruisers chase, ram and can bust the player — and can lose him, search, give up,
// and let the wanted level decay. The subsystems share one seeded generator, so
// the same seed gives the same city, traffic and police.
import { CAR, CITY, HUD, PLAYER, STEP } from './config.js';
import { createRandom } from './random.js';
import { createTraffic } from './traffic.js';
import { createPolice } from './police.js';

export const EVENT_HIT = 1;
export const EVENT_BUST = 2;

const BOUNDS = { minX: -340, maxX: 334, minZ: -340, maxZ: 340 };
const CAR_RADIUS = 1.9;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function angleDelta(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Push a circle (x, z, radius) out of every collider it overlaps; returns true on a hit. */
function resolveCircle(state, x, z, radius) {
  let hit = false;
  for (let i = 0; i < state.colliders.length; i += 1) {
    const c = state.colliders[i];
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
      // Centre inside the box: push out along the smallest penetration axis.
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

export function createWorld(city, seed) {
  const traffic = createTraffic(city);
  const police = createPolice(city);
  let random = createRandom(seed);

  const state = {
    colliders: city.colliders,
    route: city.route,
    mode: 'car',
    time: 0,
    car: { x: 0, z: 0, heading: 0, speed: 0, steer: 0, hit: false },
    player: { x: 0, z: 0, heading: 0, moving: false, running: false },
    // Phase 3: wanted is live (police.js owns it; synced here every step).
    // cash is lost on a bust; health drops when a cruiser rams the car.
    wanted: 0,
    cash: 0,
    health: HUD.healthMax,
    objective: { ...HUD.objective },
    // Visual-only cars, staged by shots.js (cover): { kind: 'police'|'traffic',
    // x, z, heading }. Never simulated, never collided with.
    extras: [],
    // Live city (Phase 3): traffic cars, pedestrians, cruisers — plain state
    // objects the renderer and the minimap read every frame.
    traffic: [],
    peds: [],
    police: [],
    busted: 0,
    crimes: {},
  };

  function reset() {
    // A fresh seeded stream every reset: the same seed replays the same city.
    random = createRandom(seed);
    traffic.reset(random, city.spawn.car.x, city.spawn.car.z);
    police.reset(random);
    state.mode = 'car';
    state.time = 0;
    state.car.x = city.spawn.car.x;
    state.car.z = city.spawn.car.z;
    state.car.heading = city.spawn.car.heading;
    state.car.speed = 0;
    state.car.steer = 0;
    state.car.hit = false;
    state.player.x = city.spawn.player.x;
    state.player.z = city.spawn.player.z;
    state.player.heading = city.spawn.car.heading;
    state.player.moving = false;
    state.player.running = false;
    state.wanted = 0;
    state.cash = 0;
    state.health = HUD.healthMax;
    state.objective = { ...HUD.objective };
    state.extras = [];
    state.traffic = traffic.state.cars;
    state.peds = traffic.state.peds;
    state.police = police.state.police;
    state.busted = 0;
    state.crimes = {};
  }

  function distanceToCar() {
    const dx = state.player.x - state.car.x;
    const dz = state.player.z - state.car.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /** Enter the car when on foot and near it; leave it when driving. */
  function toggleEnter() {
    if (state.mode === 'car') {
      state.mode = 'foot';
      state.car.speed = 0;
      // Step out on the driver's side (left of the car's forward).
      const fx = Math.sin(state.car.heading);
      const fz = Math.cos(state.car.heading);
      state.player.x = state.car.x - fz * 2.2;
      state.player.z = state.car.z + fx * 2.2;
      state.player.heading = state.car.heading;
      return true;
    }
    if (distanceToCar() < 4.5) {
      state.mode = 'car';
      return true;
    }
    return false;
  }

  /** A crime happened: the police system decides whether the level rises. */
  function commitCrime(kind) {
    if (police.commitCrime(kind, state.time, state.car.x, state.car.z)) {
      state.crimes[kind] = (state.crimes[kind] ?? 0) + 1;
    }
  }

  /** Busted (or wasted): cash is lost, Rio respawns at the start, wanted clears. */
  function doBust() {
    state.cash = 0;
    state.health = HUD.healthMax;
    state.mode = 'car';
    state.car.x = city.spawn.car.x;
    state.car.z = city.spawn.car.z;
    state.car.heading = city.spawn.car.heading;
    state.car.speed = 0;
    state.car.steer = 0;
    state.player.x = city.spawn.player.x;
    state.player.z = city.spawn.player.z;
    state.player.heading = city.spawn.car.heading;
    police.despawnAll();
    police.setWanted(0, state.time, state.car.x, state.car.z);
    state.wanted = 0;
    state.busted += 1;
  }

  function stepCar(dt, input) {
    const car = state.car;
    const throttle = input.forward ? 1 : 0;
    const braking = input.back ? 1 : 0;
    if (throttle) {
      car.speed += CAR.accel * dt;
    } else if (braking) {
      if (car.speed > 0.5) car.speed -= CAR.brake * dt;
      else car.speed -= CAR.reverseAccel * dt;
    } else {
      car.speed -= car.speed * CAR.drag * dt;
      if (Math.abs(car.speed) < 0.05) car.speed = 0;
    }
    if (input.handbrake) {
      car.speed -= Math.sign(car.speed) * CAR.handbrakeDecel * dt;
      if (Math.abs(car.speed) < 0.5) car.speed = 0;
    }
    car.speed = clamp(car.speed, -CAR.maxReverse, CAR.maxSpeed);
    const steerTarget = typeof input.steer === 'number'
      ? input.steer
      : (input.left ? -1 : 0) + (input.right ? 1 : 0);
    // Speed-sensitive steering, capped by yaw rate: yaw = steer * speed / wheelbase,
    // so the wheel angle at speed is at most yawCap * wheelbase / speed. Full lock
    // at parking speeds, a calm 1.4 rad/s at 30+ m/s. The handbrake may ask for more
    // (a drift), but never past 1.6x the full lock.
    const maxSteer = Math.min(
      CAR.steerMax,
      (CAR.steerYawCap * CAR.wheelbase) / Math.max(Math.abs(car.speed), 1),
    );
    const steerGoal = clamp(
      steerTarget * maxSteer * (input.handbrake ? 1.6 : 1),
      -CAR.steerMax * 1.6,
      CAR.steerMax * 1.6,
    );
    car.steer += (steerGoal - car.steer) * Math.min(1, dt * 10);
    car.heading += (car.steer * car.speed) / CAR.wheelbase * dt;
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    let x = car.x + fx * car.speed * dt;
    let z = car.z + fz * car.speed * dt;
    x = clamp(x, BOUNDS.minX, BOUNDS.maxX);
    z = clamp(z, BOUNDS.minZ, BOUNDS.maxZ);
    const resolved = resolveCircle(state, x, z, CAR_RADIUS);
    if (resolved.hit) {
      car.hit = true;
      car.speed *= 0.45;
    } else {
      car.hit = false;
    }
    car.x = resolved.x;
    car.z = resolved.z;
    return car.hit ? EVENT_HIT : 0;
  }

  function stepFoot(dt, input, cameraYaw) {
    const player = state.player;
    // Camera-relative movement: W walks away from the camera, A/D strafe.
    const fx = Math.sin(cameraYaw);
    const fz = Math.cos(cameraYaw);
    const rx = fz;
    const rz = -fx;
    let ix = 0;
    let iz = 0;
    if (input.forward) { ix += fx; iz += fz; }
    if (input.back) { ix -= fx; iz -= fz; }
    if (input.right) { ix += rx; iz += rz; }
    if (input.left) { ix -= rx; iz -= rz; }
    const len = Math.sqrt(ix * ix + iz * iz);
    player.moving = len > 0;
    player.running = player.moving && input.run;
    if (!player.moving) return 0;
    const speed = player.running ? PLAYER.runSpeed : PLAYER.walkSpeed;
    const targetHeading = Math.atan2(ix / len, iz / len);
    player.heading += angleDelta(targetHeading, player.heading) * Math.min(1, dt * 12);
    let x = player.x + Math.sin(player.heading) * speed * dt;
    let z = player.z + Math.cos(player.heading) * speed * dt;
    x = clamp(x, BOUNDS.minX, BOUNDS.maxX);
    z = clamp(z, BOUNDS.minZ, BOUNDS.maxZ);
    const resolved = resolveCircle(state, x, z, PLAYER.radius);
    player.x = resolved.x;
    player.z = resolved.z;
    return 0;
  }

  /**
   * One fixed step. `input` is { forward, back, left, right, handbrake, run, enter }
   * (enter is a one-shot edge, already taken by the caller). `cameraYaw` steers on-foot
   * movement. Returns event flags (EVENT_HIT when the car hits something,
   * EVENT_BUST when the police catch the player standing still).
   */
  function step(dt, input, cameraYaw) {
    state.time += dt;
    if (input.enter) toggleEnter();
    let events = 0;
    if (state.mode === 'car') events |= stepCar(dt, input);
    else events |= stepFoot(dt, input, cameraYaw);
    // The city lives around the player: traffic, pedestrians, then the police.
    traffic.step(dt, {
      time: state.time,
      car: state.car,
      player: state.player,
      mode: state.mode,
      colliders: state.colliders,
      police: police.state.police,
      commitCrime,
    });
    const policeEvent = police.step(dt, {
      time: state.time,
      car: state.car,
      player: state.player,
      mode: state.mode,
      colliders: state.colliders,
      damage: (n) => { state.health = Math.max(0, state.health - n); },
      commitCrime,
    });
    state.wanted = police.state.wanted;
    state.traffic = traffic.state.cars;
    state.peds = traffic.state.peds;
    state.police = police.state.police;
    if (policeEvent === 'bust' || state.health <= 0) {
      doBust();
      events |= EVENT_BUST;
    }
    return events;
  }

  /**
   * The autopilot: pure pursuit along the city's route, with a lookahead point a
   * fixed distance ahead of the car's projection on the route. The lookahead keeps
   * the car on the roads (the old version aimed at the next waypoint from anywhere,
   * so it cut straight across blocks from the spawn). It brakes for sharp turns:
   * the yaw cap means a 90-degree corner needs a slow car. Returns { throttle,
   * steer, brake } in the same shape as player input, so the shot stager can drive
   * the car with it. Phase 3: it also brakes for traffic and cruisers ahead, so
   * the staged shots never plough through the city's cars.
   */
  function autopilot() {
    const car = state.car;
    const route = state.route;
    const n = route.length;
    // Length of each leg, and the distance along the loop to each waypoint.
    const cum = [0];
    for (let i = 0; i < n; i += 1) {
      const a = route[i];
      const b = route[(i + 1) % n];
      cum.push(cum[i] + Math.hypot(b.x - a.x, b.z - a.z));
    }
    const total = cum[n];
    // Project the car onto the loop: the distance along it of the closest point.
    let bestS = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i += 1) {
      const a = route[i];
      const b = route[(i + 1) % n];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const lenSq = abx * abx + abz * abz;
      const t = lenSq === 0
        ? 0
        : clamp(((car.x - a.x) * abx + (car.z - a.z) * abz) / lenSq, 0, 1);
      const px = a.x + abx * t;
      const pz = a.z + abz * t;
      const d = (car.x - px) * (car.x - px) + (car.z - pz) * (car.z - pz);
      if (d < bestD) {
        bestD = d;
        bestS = cum[i] + t * Math.sqrt(lenSq);
      }
    }
    // The target: the loop point LOOKAHEAD metres ahead of the projection.
    const LOOKAHEAD = 24;
    const sTarget = (bestS + LOOKAHEAD) % total;
    let target = route[0];
    for (let i = 0; i < n; i += 1) {
      if (sTarget <= cum[i + 1]) {
        const f = cum[i + 1] === cum[i] ? 0 : (sTarget - cum[i]) / (cum[i + 1] - cum[i]);
        const a = route[i];
        const b = route[(i + 1) % n];
        target = { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
        break;
      }
    }
    const tx = target.x - car.x;
    const tz = target.z - car.z;
    const wanted = Math.atan2(tx, tz);
    const diff = angleDelta(wanted, car.heading);
    const steer = clamp(diff * 1.6, -1, 1);
    const sharp = Math.abs(diff) > 0.5;
    // Traffic ahead: a car in our lane within 16 m means lift off and brake
    // (brake only while moving — braking at a standstill would reverse us).
    let blocked = false;
    if (Math.abs(car.speed) > 2) {
      const fx = Math.sin(car.heading);
      const fz = Math.cos(car.heading);
      const check = (vx, vz) => {
        const rx = vx - car.x;
        const rz = vz - car.z;
        const along = rx * fx + rz * fz;
        const lateral = Math.abs(rx * fz - rz * fx);
        return along > 0 && along < 16 && lateral < 3.5;
      };
      for (const t of traffic.state.cars) {
        if (check(t.x, t.z)) { blocked = true; break; }
      }
      if (!blocked) {
        for (const p of police.state.police) {
          if (check(p.x, p.z)) { blocked = true; break; }
        }
      }
    }
    return {
      throttle: sharp || blocked ? 0 : 1,
      steer,
      brake: sharp || (blocked && Math.abs(car.speed) > 2),
    };
  }

  /** Test hooks: drive the systems directly (browser play tests, Node tests). */
  const debug = {
    commitCrime(kind) {
      commitCrime(kind);
    },
    setWanted(n) {
      police.setWanted(n, state.time, state.car.x, state.car.z);
      state.wanted = police.state.wanted;
    },
    teleport(x, z) {
      state.car.x = x;
      state.car.z = z;
      state.car.speed = 0;
      state.player.x = x;
      state.player.z = z + 5;
    },
    snapshot() {
      return {
        time: state.time,
        mode: state.mode,
        wanted: state.wanted,
        cash: state.cash,
        health: state.health,
        busted: state.busted,
        crimes: { ...state.crimes },
        car: { x: state.car.x, z: state.car.z, heading: state.car.heading, speed: state.car.speed },
        police: police.state.police.map((p) => ({
          x: p.x, z: p.z, heading: p.heading, speed: p.speed, mode: p.mode, hasLos: p.hasLos,
        })),
        traffic: traffic.state.cars.map((c) => ({ x: c.x, z: c.z, speed: c.speed, kind: c.kind, road: c.road, line: c.line, heading: c.heading })),
        peds: traffic.state.peds.map((p) => ({ x: p.x, z: p.z, state: p.state, road: p.road, line: p.line, heading: p.heading })),
        trafficStats: { ...traffic.state.stats },
        policeStats: { ...police.state.stats },
      };
    },
  };

  reset();
  return { state, reset, step, toggleEnter, autopilot, distanceToCar, debug };
}

// Re-export STEP so callers read the step size from one place.
export { STEP };
