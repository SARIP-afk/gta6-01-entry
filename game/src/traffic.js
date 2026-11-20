// Traffic and pedestrians: pools allocated once, road-followers that never leave
// the grid. Cars drive the road centrelines in lanes, one leg at a time: a leg
// runs along one road (one axis) to the next junction, then the car either
// goes straight or turns onto the cross road. The lateral offset ramps in
// over the first metres of a leg, so a turn never teleports the car — and
// because a car only ever moves along a road line, it can never cut a corner
// through a building: buildings stand at least 9 m from every centreline and
// a car never strays more than 1.8 m from one. Car-to-car contact is a
// spatial grid (16 m cells, neighbours only): a car brakes for the one ahead
// in its lane and overlapping cars are pushed apart. Everything here is
// seeded: the same seed, the same street.
import { CITY, TRAFFIC } from './config.js';
import { randomRoadPoint, snapToRoad } from './city.js';

const ROADS = [];
for (let v = CITY.gridMin; v <= CITY.gridMax; v += CITY.roadStep) ROADS.push(v);

const LANE = 1.8; // right-hand offset from the road centreline
const BRAKE_DIST = 12; // start easing off this far behind the car ahead
const STOP_DIST = 6.5; // full stop this close behind the car ahead
const SIDE_GAP = 2.2; // lateral gap that still counts as "in my lane"
const TOUCH_DIST = 4.4; // two car lengths nose to tail: closer is a touch
const PUSH_DIST = 4.6; // separation pushes bodies back out to this gap
const CELL = 16;

const CAR_COLORS = [0x7fa3b8, 0x9aa5b1, 0xc96f4a, 0x8a9a7b, 0xd8cfc0, 0x6b7f8e, 0xb5533c, 0x4f7d7a, 0xe0a83c, 0x5b6b7a];

function nearestRoad(v) {
  let best = ROADS[0];
  let bd = Infinity;
  for (const r of ROADS) {
    if (Math.abs(v - r) < bd) { bd = Math.abs(v - r); best = r; }
  }
  return best;
}

/** The next junction value ahead of `a` along the grid, in direction `dir`. */
function junctionAhead(a, dir) {
  if (dir > 0) return (Math.floor(a / CITY.roadStep) + 1) * CITY.roadStep;
  return (Math.ceil(a / CITY.roadStep) - 1) * CITY.roadStep;
}

/** Heading for a leg: axis 'x' east/west, axis 'z' south/north (world -sin). */
function legHeading(axis, dir) {
  if (axis === 'x') return dir > 0 ? 0 : Math.PI;
  return dir > 0 ? -Math.PI / 2 : Math.PI / 2;
}

/** Right-hand lane offset for a leg: opposite directions take opposite sides. */
function laneOffset(axis, dir) {
  if (axis === 'x') return dir * LANE;
  return -dir * LANE;
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
    const heading = (Math.floor(random() * 4) * Math.PI) / 2;
    const car = {
      x: 0, z: 0, heading,
      speed: TRAFFIC.carSpeedMin + random() * (TRAFFIC.carSpeedMax - TRAFFIC.carSpeedMin),
      targetSpeed: 0, kind: i % 5 === 4 ? 'van' : i % 3 === 0 ? 'taxi' : 'sedan',
      color: CAR_COLORS[Math.floor(random() * CAR_COLORS.length)],
      tx: 0, tz: 0, marked: false, decide: null, stopped: 0,
      axis: 'x', road: 0, dir: 1, lat: 0, targetLat: 0, legTarget: 0,
    };
    car.baseColor = car.color;
    car.targetSpeed = car.speed;
    // Never spawn on top of another car: re-roll the spot while crowded.
    // The clearance check runs after pickTarget, because picking a leg snaps
    // the car onto its new road line — the final spot is what must be clear.
    for (let t = 0; t < 6; t += 1) {
      const p = randomRoadPoint(random);
      placeOnRoad(car, p.x, p.z, heading);
      pickTarget(car);
      offsetAlong(car, 10 + random() * 25);
      let clear = true;
      for (let j = 0; j < i; j += 1) {
        if (Math.hypot(cars[j].x - car.x, cars[j].z - car.z) < 8) { clear = false; break; }
      }
      if (clear) break;
    }
    cars.push(car);
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

  /** Put a car on the nearest road leg, heading `heading`, at (x, z). */
  function placeOnRoad(car, x, z, heading) {
    const s = snapToRoad(x, z);
    // Which road is nearer: the vertical one (constant x) or the horizontal one?
    let bx = x;
    let bd = Infinity;
    for (const r of ROADS) {
      if (Math.abs(x - r) < bd) { bd = Math.abs(x - r); bx = r; }
    }
    let bz = z;
    let bd2 = Infinity;
    for (const r of ROADS) {
      if (Math.abs(z - r) < bd2) { bd2 = Math.abs(z - r); bz = r; }
    }
    const h = heading === undefined ? car.heading : heading;
    // Quantise the heading to the nearest cardinal direction.
    const q = Math.round(h / (Math.PI / 2)) % 4;
    const qc = ((q % 4) + 4) % 4;
    if (qc === 0) { car.axis = 'x'; car.dir = 1; }
    else if (qc === 2) { car.axis = 'x'; car.dir = -1; }
    else if (qc === 1) { car.axis = 'z'; car.dir = -1; }
    else { car.axis = 'z'; car.dir = 1; }
    if (car.axis === 'x') {
      car.road = bz;
      car.x = s.x;
      car.z = car.road;
    } else {
      car.road = bx;
      car.z = s.z;
      car.x = car.road;
    }
    // The causeway east of the grid is one road (z = -6): keep it on the line.
    if (car.x > CITY.gridMax) {
      car.axis = 'x';
      car.road = -6;
      car.z = -6;
    }
    car.heading = legHeading(car.axis, car.dir);
    car.lat = 0;
    car.targetLat = laneOffset(car.axis, car.dir);
    car.legTarget = junctionAhead(car.axis === 'x' ? car.x : car.z, car.dir);
    // The pier ends the causeway: a leg east never runs past the pier deck.
    if (car.axis === 'x' && car.road === -6 && car.dir > 0) car.legTarget = Math.min(car.legTarget, CITY.pier.x);
    car.tx = car.x;
    car.tz = car.z;
  }

  /** Next leg from the junction the car just reached. */
  function pickTarget(car) {
    if (car.decide) {
      const t = car.decide(car);
      const dx = t.x - car.x;
      const dz = t.z - car.z;
      const axis = Math.abs(dx) >= Math.abs(dz) ? 'x' : 'z';
      const dir = axis === 'x' ? Math.sign(dx) || 1 : Math.sign(dz) || 1;
      startLeg(car, axis, dir);
      car.tx = t.x;
      car.tz = t.z;
      return;
    }
    const along = car.axis === 'x' ? car.x : car.z;
    // Past the grid edge there is no cross road: turn around and drive back.
    if (along < CITY.gridMin || along > CITY.gridMax) {
      if (car.axis === 'x' && car.road === -6 && along < CITY.pier.x) {
        // Still on the causeway to the pier: keep going east to the deck.
        car.legTarget = Math.min(junctionAhead(along, car.dir), CITY.pier.x);
        return;
      }
      car.dir *= -1;
      car.targetLat = laneOffset(car.axis, car.dir);
      car.legTarget = junctionAhead(along, car.dir);
      return;
    }
    // Straight on is only an option while the next junction stays on the map
    // (the causeway's next junction may run to the pier deck, not past it).
    const next = junctionAhead(along, car.dir);
    const straightOk = (next >= CITY.gridMin && next <= CITY.gridMax)
      || (car.axis === 'x' && car.road === -6 && next <= CITY.pier.x);
    // Keep going straight most of the time, turn sometimes; at a dead end
    // (edge junction with nowhere straight to go) turn or turn around.
    if (straightOk && random() < 0.7) {
      car.legTarget = next;
      return;
    }
    if (!straightOk && random() < 0.5) {
      car.dir *= -1;
      car.targetLat = laneOffset(car.axis, car.dir);
      car.legTarget = junctionAhead(along, car.dir);
      return;
    }
    const axis = car.axis === 'x' ? 'z' : 'x';
    const dir = random() < 0.5 ? 1 : -1;
    startLeg(car, axis, dir);
  }

  /** Begin a leg on `axis` in direction `dir` from the car's current spot.
   * The car snaps onto the new road line at once: at a junction it is already
   * there (within half a metre), so the snap is invisible — but it must happen
   * here, never a step later, or the car drives a step off-road. */
  function startLeg(car, axis, dir) {
    const along = axis === 'x' ? car.x : car.z;
    const cross = axis === 'x' ? car.z : car.x;
    car.axis = axis;
    car.dir = dir;
    car.road = nearestRoad(cross);
    car.lat = 0;
    car.targetLat = laneOffset(axis, dir);
    if (axis === 'x') car.z = car.road;
    else car.x = car.road;
    car.legTarget = junctionAhead(along, dir);
  }

  /** Spatial grid: cell key for a point. Cells span -512..512 in both axes. */
  function cellKey(x, z) {
    const cx = Math.floor(x / CELL) + 32;
    const cz = Math.floor(z / CELL) + 32;
    return cx * 64 + cz;
  }

  function stepCar(car, dt, grid, hero) {
    // Arrived at the junction? Pick the next leg.
    const along = car.axis === 'x' ? car.x : car.z;
    if ((car.dir > 0 && along >= car.legTarget - 0.5) || (car.dir < 0 && along <= car.legTarget + 0.5)) {
      pickTarget(car);
    }
    const want = legHeading(car.axis, car.dir);
    car.heading = turnToward(car.heading, want, 3.2 * dt);
    // Crawl while the nose is still swinging onto the new leg: a car that
    // turns at full speed crabs sideways through the junction, and a U-turn
    // drives a whole second facing backwards. Slow in, straighten, then go.
    let turnDiff = want - car.heading;
    while (turnDiff > Math.PI) turnDiff -= Math.PI * 2;
    while (turnDiff < -Math.PI) turnDiff += Math.PI * 2;
    let target = car.targetSpeed;
    if (Math.abs(turnDiff) > 0.6) target = Math.min(target, 2.0);
    else if (Math.abs(turnDiff) > 0.25) target = Math.min(target, 5.0);
    // Ease the lane offset in over the first metres of the leg. While rolling
    // it ramps at 4 m/s (into the lane within ~4 m of driving). While stopped
    // it still eases in — unless a car is close by, in which case a stopped
    // car must not creep sideways into its neighbour. (Freezing the ramp
    // entirely while stopped left cars sitting on the centreline, where they
    // met oncoming cars nose-to-nose with no clearance at all.)
    const latRate = 4.0;
    let nearestDist = Infinity;
    {
      const lcx = Math.floor(car.x / CELL);
      const lcz = Math.floor(car.z / CELL);
      for (let gx = lcx - 1; gx <= lcx + 1; gx += 1) {
        for (let gz = lcz - 1; gz <= lcz + 1; gz += 1) {
          const bucket = grid.get((gx + 32) * 64 + (gz + 32));
          if (!bucket) continue;
          for (const oi of bucket) {
            const other = cars[oi];
            if (other === car) continue;
            nearestDist = Math.min(nearestDist, Math.hypot(other.x - car.x, other.z - car.z));
          }
        }
      }
      if (hero) nearestDist = Math.min(nearestDist, Math.hypot(hero.x - car.x, hero.z - car.z));
    }
    if (car.speed > 0.5 || nearestDist > 6) {
      if (car.lat < car.targetLat) car.lat = Math.min(car.targetLat, car.lat + latRate * dt);
      else if (car.lat > car.targetLat) car.lat = Math.max(car.targetLat, car.lat - latRate * dt);
    }
    // Brake for the car ahead in my lane, and for the hero car when it is one.
    // "Ahead" is geometric, not lane identity: the other car's body must
    // actually intersect the strip I am about to drive through (a 1.9 m wide
    // corridor 12 m ahead of my nose). That catches a leader turning across
    // my path — its body spans my corridor even though its lane changed —
    // while a car crossing at right angles whose body clears my strip does
    // not stop me. Cross traffic that does block me is handled here too:
    // a stopped car sitting in my corridor is a physical obstacle.
    const fx = Math.cos(car.heading);
    const fz = -Math.sin(car.heading);
    const rx = Math.sin(car.heading);
    const rz = Math.cos(car.heading);
    function bodyRect(c) {
      return { x: c.x, z: c.z, hx: 2.2, hw: 0.95, ux: Math.cos(c.heading), uz: -Math.sin(c.heading), vx: Math.sin(c.heading), vz: Math.cos(c.heading) };
    }
    function sweptRect(c, len) {
      // The strip the car is ABOUT to drive through follows its leg (the
      // road it is on), not its instantaneous heading: mid-turn the nose
      // slews 90 degrees while the car still travels along the road, and a
      // heading-based corridor points diagonally off the road and misses
      // the leader directly ahead. The hero has no leg: use its heading.
      const h = (c.axis !== undefined) ? legHeading(c.axis, c.dir) : c.heading;
      const ux = Math.cos(h); const uz = -Math.sin(h);
      return { x: c.x + ux * (len / 2), z: c.z + uz * (len / 2), hx: len / 2, hw: 0.95, ux, uz, vx: Math.sin(h), vz: Math.cos(h) };
    }
    function rectsOverlap(r1, r2) {
      const axes = [[r1.ux, r1.uz], [r1.vx, r1.vz], [r2.ux, r2.uz], [r2.vx, r2.vz]];
      const dx = r2.x - r1.x; const dz = r2.z - r1.z;
      for (const [wx, wz] of axes) {
        const pr1 = r1.hx * Math.abs(r1.ux * wx + r1.uz * wz) + r1.hw * Math.abs(r1.vx * wx + r1.vz * wz);
        const pr2 = r2.hx * Math.abs(r2.ux * wx + r2.uz * wz) + r2.hw * Math.abs(r2.vx * wx + r2.vz * wz);
        if (Math.abs(dx * wx + dz * wz) >= pr1 + pr2) return false;
      }
      return true;
    }
    function obstacleAhead(other) {
      if (!rectsOverlap(sweptRect(car, BRAKE_DIST), bodyRect(other))) return false;
      const dx = other.x - car.x;
      const dz = other.z - car.z;
      const alongO = dx * fx + dz * fz;
      if (alongO < STOP_DIST) target = Math.min(target, 0);
      else target = Math.min(target, Math.max(0, other.speed));
      return true;
    }
    function heroAhead(hx, hz, hSpeed) {
      const dx = hx - car.x;
      const dz = hz - car.z;
      const alongO = dx * fx + dz * fz;
      if (alongO <= 0 || alongO > BRAKE_DIST) return false;
      if (Math.abs(dx * rx + dz * rz) > SIDE_GAP) return false;
      if (alongO < STOP_DIST) target = Math.min(target, 0);
      else target = Math.min(target, Math.max(0, hSpeed));
      return true;
    }
    const cx = Math.floor(car.x / CELL);
    const cz = Math.floor(car.z / CELL);
    for (let gx = cx - 1; gx <= cx + 1; gx += 1) {
      for (let gz = cz - 1; gz <= cz + 1; gz += 1) {
        const bucket = grid.get((gx + 32) * 64 + (gz + 32));
        if (!bucket) continue;
        for (const oi of bucket) {
          const other = cars[oi];
          if (other === car) continue;
          obstacleAhead(other);
        }
      }
    }
    if (hero) heroAhead(hero.x, hero.z, Math.max(0, hero.speed));
    // Yield at the junction ahead: do not enter it while cross traffic will
    // get there first (or is already stopped inside it). Judged on TIME to
    // the centre, not distance: a car 20 m out at 11 m/s arrives before one
    // 8 m out at 3 m/s, and a car that only starts braking 11 m out cannot
    // stop before the box anyway (11 m/s needs ~12 m). So the zone reaches
    // 26 m out, and a car already inside the box (under 6 m from the centre)
    // never yields — it clears the box instead of stopping in it. The hero
    // car counts as cross traffic too.
    {
      const jx = car.axis === 'x' ? car.legTarget : car.road;
      const jz = car.axis === 'x' ? car.road : car.legTarget;
      const myDistJ = Math.hypot(car.x - jx, car.z - jz);
      if (myDistJ >= 6 && myDistJ < 26) {
        const jcx = Math.floor(jx / CELL);
        const jcz = Math.floor(jz / CELL);
        const tMe = car.speed < 0.5 ? Infinity : myDistJ / car.speed;
        let yieldTo = false;
        const checkOther = (other) => {
          const ox = other.x; const oz = other.z;
          const od = Math.hypot(ox - jx, oz - jz);
          if (od >= 18 || yieldTo) return;
          // Deadlock breaker: if the other car is stopped and my body sits
          // in its forward corridor, it is waiting for ME — yielding to it
          // would freeze us both. Skip it and go.
          if (other.speed !== undefined && other.speed < 0.5
            && rectsOverlap(sweptRect(other, BRAKE_DIST), bodyRect(car))) return;
          const oSpeed = other.speed === undefined ? Math.max(0, hero.speed) : other.speed;
          // A stopped car is not approaching: its time to the centre is
          // infinite (unless it is already stopped inside the box, where
          // it is an obstacle). Treating a stopped car as crawling at
          // 2 m/s made NPCs yield forever to a hero that was never moving.
          const tOther = oSpeed < 0.5 ? (od < 7 ? 0 : Infinity) : od / oSpeed;
          // A car stopped inside the box is already there: do not enter
          // behind it. Otherwise yield when it reaches the centre first
          // (or about together — within a second either way).
          if ((od < 7 && oSpeed < 0.5) || tOther < tMe + 1.0) yieldTo = true;
        };
        for (let gx = jcx - 1; gx <= jcx + 1 && !yieldTo; gx += 1) {
          for (let gz = jcz - 1; gz <= jcz + 1 && !yieldTo; gz += 1) {
            const bucket = grid.get((gx + 32) * 64 + (gz + 32));
            if (!bucket) continue;
            for (const oi of bucket) {
              const other = cars[oi];
              if (other === car) continue;
              checkOther(other);
            }
          }
        }
        if (hero) checkOther({ x: hero.x, z: hero.z, speed: undefined, heading: hero.heading });
        if (yieldTo) target = 0;
      }
    }
    // Braking bites harder than accelerating, so a follower stops with a gap
    // instead of easing into the bumper ahead.
    const rate = target < car.speed ? 5.0 : 2.5;
    car.speed += (target - car.speed) * Math.min(1, rate * dt);
    if (car.axis === 'x') {
      car.x += car.dir * car.speed * dt;
      car.z = car.road + car.lat;
    } else {
      car.z += car.dir * car.speed * dt;
      car.x = car.road + car.lat;
    }
    // Stay inside the playable area: a leg that runs past the edge restarts
    // on a road inside the grid instead of driving off the map.
    if (car.x < CITY.gridMin - 4 || car.x > CITY.pier.x + 24 || car.z < CITY.gridMin - 4 || car.z > CITY.gridMax + 4) {
      const s = snapToRoad(Math.max(CITY.gridMin, Math.min(CITY.pier.x, car.x)), Math.max(CITY.gridMin, Math.min(CITY.gridMax, car.z)));
      placeOnRoad(car, s.x, s.z, car.heading);
      pickTarget(car);
    }
  }

  /** Separating-axis test for two car bodies (4.4 m long, 1.9 m wide). A
   * centre-distance test is wrong here: two cars passing diagonally through
   * a junction can sit 4.6 m apart centre-to-centre with a metre of clear
   * air between their bumpers, while a nose-to-tail pair at the same distance
   * is genuinely touching. SAT on both cars' axes tells the two apart.
   * Returns the minimum push-out vector, or null when the bodies are clear. */
  function satOverlap(a, b) {
    const axes = [];
    for (const c of [a, b]) {
      axes.push([Math.cos(c.heading), -Math.sin(c.heading)]);
      axes.push([Math.sin(c.heading), Math.cos(c.heading)]);
    }
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    let best = null;
    for (const [wx, wz] of axes) {
      const rA = 2.2 * Math.abs(Math.cos(a.heading) * wx - Math.sin(a.heading) * wz)
        + 0.95 * Math.abs(Math.sin(a.heading) * wx + Math.cos(a.heading) * wz);
      const rB = 2.2 * Math.abs(Math.cos(b.heading) * wx - Math.sin(b.heading) * wz)
        + 0.95 * Math.abs(Math.sin(b.heading) * wx + Math.cos(b.heading) * wz);
      const dist = Math.abs(dx * wx + dz * wz);
      const overlap = rA + rB - dist;
      if (overlap <= 0) return null;
      if (!best || overlap < best.overlap) best = { overlap, wx, wz };
    }
    // Push along the smallest overlap, away from a.
    const sign = (dx * best.wx + dz * best.wz) >= 0 ? 1 : -1;
    return { x: best.wx * sign * best.overlap, z: best.wz * sign * best.overlap };
  }

  /** Push really-touching cars apart (grid neighbours only) and match their
   * speed, so a follower that catches the car ahead slows instead of
   * grinding through it. Cars that merely pass close never trigger this. */
  function separate() {
    const grid = new Map();
    for (let i = 0; i < cars.length; i += 1) {
      const k = cellKey(cars[i].x, cars[i].z);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    }
    for (let i = 0; i < cars.length; i += 1) {
      const a = cars[i];
      const cx = Math.floor(a.x / CELL);
      const cz = Math.floor(a.z / CELL);
      for (let gx = cx - 1; gx <= cx + 1; gx += 1) {
        for (let gz = cz - 1; gz <= cz + 1; gz += 1) {
          const bucket = grid.get((gx + 32) * 64 + (gz + 32));
          if (!bucket) continue;
          for (const j of bucket) {
            if (j <= i) continue;
            const b = cars[j];
            const push = satOverlap(a, b);
            if (!push) continue;
            a.x -= push.x / 2;
            a.z -= push.z / 2;
            b.x += push.x / 2;
            b.z += push.z / 2;
            // Position push only — never touch speed here. Matching speeds
            // in the push froze a moving car behind a stopped one forever:
            // the stopped car re-zeroed it every step.
          }
        }
      }
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
    const want = Math.atan2(-(ped.tz - ped.z), ped.tx - ped.x);
    ped.heading = turnToward(ped.heading, want, 3 * dt);
    ped.x += Math.cos(ped.heading) * ped.speed * dt;
    ped.z -= Math.sin(ped.heading) * ped.speed * dt;
    ped.phase += dt * ped.speed * 2.4;
  }

  /** Shift a car along its leg by `dist` metres (positive = forward), clamped
   * to stop 3 m short of the junction ahead. Spawn/respawn place a car on a
   * junction (both coordinates quantise to road lines); a mid-block spot is
   * where cars actually drive, and it keeps the clearance retry honest —
   * 30 cars on ~25 junctions can never all be 8 m apart. */
  function offsetAlong(car, dist) {
    const along = car.axis === 'x' ? car.x : car.z;
    let next = along + dist * car.dir;
    if (car.dir > 0) next = Math.min(next, car.legTarget - 3);
    else next = Math.max(next, car.legTarget + 3);
    if (car.axis === 'x') car.x = next;
    else car.z = next;
  }
  function step(dt, focus, hero) {
    const grid = new Map();
    for (let i = 0; i < cars.length; i += 1) {
      const k = cellKey(cars[i].x, cars[i].z);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    }
    for (const car of cars) {
      const d = Math.hypot(car.x - focus.x, car.z - focus.z);
      if (d > TRAFFIC.despawn && !car.marked) {
        // Respawning keeps the street alive near the player instead of far away.
        // Re-roll while the spot is crowded, so a respawn never lands on a car.
        // The spot is mid-block (offsetAlong): a junction-only spawn area has
        // too few distinct spots for 30 cars to stay 8 m apart.
        for (let t = 0; t < 6; t += 1) {
          const p = randomRoadPoint(random);
          const near = { x: focus.x + (p.x - focus.x) * 0.4, z: focus.z + (p.z - focus.z) * 0.4 };
          const s = snapToRoad(near.x, near.z);
          placeOnRoad(car, s.x, s.z, car.heading);
          pickTarget(car);
          offsetAlong(car, 10 + random() * 25);
          let clear = true;
          let nearD = Infinity;
          for (const other of cars) {
            if (other !== car) nearD = Math.min(nearD, Math.hypot(other.x - car.x, other.z - car.z));
          }
          if (nearD < 8) clear = false;
          if (clear) break;
        }
      }
      stepCar(car, dt, grid, hero);
    }
    separate();
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
    placeOnRoad(best, from.x, from.z, best.heading);
    best.tx = from.x;
    best.tz = from.z;
    return best;
  }

  function unmarkVan() {
    for (const car of cars) {
      if (car.marked) {
        car.marked = false;
        car.decide = null;
        car.color = car.baseColor;
      }
    }
  }

  function reset() {
    for (let ci = 0; ci < cars.length; ci += 1) {
      const car = cars[ci];
      const heading = (Math.floor(random() * 4) * Math.PI) / 2;
      for (let t = 0; t < 6; t += 1) {
        const p = randomRoadPoint(random);
        placeOnRoad(car, p.x, p.z, heading);
        pickTarget(car);
        offsetAlong(car, 10 + random() * 25);
        let clear = true;
        for (let j = 0; j < ci; j += 1) {
          if (Math.hypot(cars[j].x - car.x, cars[j].z - car.z) < 8) { clear = false; break; }
        }
        if (clear) break;
      }
      car.marked = false;
      car.decide = null;
      car.color = car.baseColor;
      car.speed = TRAFFIC.carSpeedMin + random() * (TRAFFIC.carSpeedMax - TRAFFIC.carSpeedMin);
      car.targetSpeed = car.speed;
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
    cars, peds, step, markVan, unmarkVan, reset, placeOnRoad,
    setCar(i, x, z, heading) {
      if (cars[i]) placeOnRoad(cars[i], x, z, heading);
    },
    van() {
      for (const car of cars) if (car.marked) return car;
      return null;
    },
  };
}
