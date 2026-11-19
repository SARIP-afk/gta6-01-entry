// Traffic and pedestrians: pools allocated once, road-followers that never leave the
// grid. Cars pick a random road junction, drive to it, then pick the next; the gold
// van is one ordinary car given a destination and a flag. Peds walk the sidewalks.
// Everything here is seeded: the same seed, the same street.
import { CITY, TRAFFIC } from './config.js';
import { randomRoadPoint, snapToRoad } from './city.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const ROADS = [];
for (let v = CITY.gridMin; v <= CITY.gridMax; v += CITY.roadStep) ROADS.push(v);

function approachAngle(from, to) {
  return Math.atan2(-(to.z - from.z), to.x - from.x);
}

function turnToward(angle, target, maxStep) {
  let d = target - angle;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (d > maxStep) return angle + maxStep;
  if (d < -maxStep) return angle - maxStep;
  return target;
}

export function createTraffic(random) {
  const cars = [];
  for (let i = 0; i < TRAFFIC.cars; i += 1) {
    const p = randomRoadPoint(random);
    cars.push({
      x: p.x, z: p.z, heading: (Math.floor(random() * 4) * Math.PI) / 2,
      speed: TRAFFIC.carSpeedMin + random() * (TRAFFIC.carSpeedMax - TRAFFIC.carSpeedMin),
      targetSpeed: 0, kind: i % 5 === 4 ? 'van' : i % 3 === 0 ? 'taxi' : 'sedan',
      color: 0x9aa5b1, tx: p.x, tz: p.z, marked: false, decide: null, stopped: 0,
    });
    cars[i].targetSpeed = cars[i].speed;
  }
  const peds = [];
  for (let i = 0; i < TRAFFIC.peds; i += 1) {
    const p = randomRoadPoint(random);
    peds.push({
      x: p.x + 8, z: p.z + 8, heading: random() * Math.PI * 2,
      speed: TRAFFIC.pedSpeedMin + random() * (TRAFFIC.pedSpeedMax - TRAFFIC.pedSpeedMin),
      phase: random() * Math.PI * 2, shirt: 0xffffff, tx: p.x, tz: p.z,
    });
  }

  function pickTarget(car) {
    if (car.decide) {
      const t = car.decide(car);
      car.tx = t.x;
      car.tz = t.z;
      return;
    }
    // Next junction: keep going straight most of the time, turn sometimes.
    const ahead = 52;
    const nx = car.x + Math.cos(car.heading) * ahead;
    const nz = car.z - Math.sin(car.heading) * ahead;
    const snapped = snapToRoad(nx, nz);
    if (random() < 0.7) {
      car.tx = snapped.x;
      car.tz = snapped.z;
    } else {
      const road = ROADS[Math.floor(random() * ROADS.length)];
      if (random() < 0.5) { car.tx = road; car.tz = car.z; } else { car.tx = car.x; car.tz = road; }
    }
  }

  function stepCar(car, dt, px, pz) {
    const dx = car.tx - car.x;
    const dz = car.tz - car.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 3) {
      pickTarget(car);
      return;
    }
    const want = approachAngle(car, { x: car.tx, z: car.tz });
    car.heading = turnToward(car.heading, want, 2.4 * dt);
    // Brake for the car ahead: anything within 9 m in front slows us down.
    let slow = false;
    for (const other of cars) {
      if (other === car) continue;
      const ox = other.x - car.x;
      const oz = other.z - car.z;
      const od = Math.hypot(ox, oz);
      if (od < 9 && od > 0.01) {
        const fwd = (ox * Math.cos(car.heading) - oz * Math.sin(car.heading)) / od;
        if (fwd > 0.6) { slow = true; break; }
      }
    }
    const target = slow ? 0 : car.targetSpeed;
    car.speed += (target - car.speed) * Math.min(1, 2.5 * dt);
    car.x += Math.cos(car.heading) * car.speed * dt;
    car.z -= Math.sin(car.heading) * car.speed * dt;
    // Stay on the roads: if we drifted off-grid, snap back to the nearest road.
    if (car.x < CITY.gridMin - 4 || car.x > CITY.pier.x + 24 || car.z < CITY.gridMin - 4 || car.z > CITY.gridMax + 4) {
      const s = snapToRoad(Math.max(CITY.gridMin, Math.min(CITY.pier.x, car.x)), Math.max(CITY.gridMin, Math.min(CITY.gridMax, car.z)));
      car.x = s.x;
      car.z = s.z;
      pickTarget(car);
    }
  }

  function stepPed(ped, dt) {
    const dx = ped.tx - ped.x;
    const dz = ped.tz - ped.z;
    if (Math.hypot(dx, dz) < 2) {
      const p = randomRoadPoint(random);
      ped.tx = p.x + 8;
      ped.tz = p.z + 8;
    }
    const want = approachAngle(ped, { x: ped.tx, z: ped.tz });
    ped.heading = turnToward(ped.heading, want, 3 * dt);
    ped.x += Math.cos(ped.heading) * ped.speed * dt;
    ped.z -= Math.sin(ped.heading) * ped.speed * dt;
    ped.phase += dt * ped.speed * 2.4;
  }

  /** One fixed step. `focus` is the player, for the spawn/despawn window. */
  function step(dt, focus) {
    for (const car of cars) {
      const d = Math.hypot(car.x - focus.x, car.z - focus.z);
      if (d > TRAFFIC.despawn && !car.marked) {
        const p = randomRoadPoint(random);
        // Respawning keeps the street alive near the player instead of far away.
        const near = { x: focus.x + (p.x - focus.x) * 0.4, z: focus.z + (p.z - focus.z) * 0.4 };
        const s = snapToRoad(near.x, near.z);
        car.x = s.x;
        car.z = s.z;
        pickTarget(car);
      }
      stepCar(car, dt, focus.x, focus.z);
    }
    for (const ped of peds) {
      const d = Math.hypot(ped.x - focus.x, ped.z - focus.z);
      if (d > TRAFFIC.despawn) {
        const p = randomRoadPoint(random);
        ped.x = focus.x + (p.x - focus.x) * 0.3 + 8;
        ped.z = focus.z + (p.z - focus.z) * 0.3 + 8;
        ped.tx = ped.x + 20;
        ped.tz = ped.z;
      }
      stepPed(ped, dt);
    }
  }

  /** Mark one car as Dante's gold van and give it a route to the marina. */
  function markVan(from, to) {
    let best = null;
    let bd = Infinity;
    for (const car of cars) {
      if (car.kind !== 'van' || car.marked) continue;
      const d = Math.hypot(car.x - from.x, car.z - from.z);
      if (d < bd) { bd = d; best = car; }
    }
    if (!best) return null;
    best.marked = true;
    best.color = 0xf2c94c;
    best.decide = (c) => {
      // Greedy road drive toward the destination: head for whichever axis is further.
      const dx = to.x - c.x;
      const dz = to.z - c.z;
      if (Math.abs(dx) > Math.abs(dz)) return { x: c.x + Math.sign(dx) * 52, z: c.z };
      return { x: c.x, z: c.z + Math.sign(dz) * 52 };
    };
    best.tx = from.x;
    best.tz = from.z;
    best.x = from.x;
    best.z = from.z;
    return best;
  }

  function unmarkVan() {
    for (const car of cars) {
      if (car.marked) {
        car.marked = false;
        car.decide = null;
        car.color = 0x9aa5b1;
      }
    }
  }

  function reset() {
    for (const car of cars) {
      const p = randomRoadPoint(random);
      car.x = p.x;
      car.z = p.z;
      car.marked = false;
      car.decide = null;
      pickTarget(car);
    }
    for (const ped of peds) {
      const p = randomRoadPoint(random);
      ped.x = p.x + 8;
      ped.z = p.z + 8;
      ped.tx = ped.x + 20;
      ped.tz = ped.z;
    }
  }

  return {
    cars, peds, step, markVan, unmarkVan, reset,
    van() {
      for (const car of cars) if (car.marked) return car;
      return null;
    },
  };
}
