// Wanted + police (Phase 3): pure rules, no drawing and no browser in it. Crimes
// raise the wanted level (each kind +1 star, with a per-kind cooldown so one
// incident is one star); cruisers spawn, chase on the road grid, and ram the
// player's car. The police can LOSE the player: out of every cruiser's sight
// (range + line of sight — buildings block it) long enough and they search the
// last known position, then give up and leave; only once they are gone does the
// wanted level decay. Escaping is always possible: cruisers top out at 30 m/s
// against Rio's 34, and they never teleport or cut across blocks to reach him
// (except the short final lunge for a ram).
import { HUD, POLICE } from './config.js';
import {
  laneOffset, legFrom, pushOutOfColliders, roadPos, snapToRoad, stepRoadCar,
} from './traffic.js';

const BOUNDS = { minX: -340, maxX: 334, minZ: -340, maxZ: 340 };

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** 2D segment (ax,az)-(bx,bz) vs an axis-aligned box: true when it crosses it. */
function segmentHitsBox(ax, az, bx, bz, box) {
  const dx = bx - ax;
  const dz = bz - az;
  let tmin = 0;
  let tmax = 1;
  if (Math.abs(dx) < 1e-9) {
    if (ax < box.minX || ax > box.maxX) return false;
  } else {
    let t1 = (box.minX - ax) / dx;
    let t2 = (box.maxX - ax) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  if (Math.abs(dz) < 1e-9) {
    if (az < box.minZ || az > box.maxZ) return false;
  } else {
    let t1 = (box.minZ - az) / dz;
    let t2 = (box.maxZ - az) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}

/** True when the segment is clear of every building collider (line of sight). */
function hasLineOfSight(ax, az, bx, bz, colliders) {
  for (let i = 0; i < colliders.length; i += 1) {
    if (segmentHitsBox(ax, az, bx, bz, colliders[i])) return false;
  }
  return true;
}

export function createPolice(city) {
  const state = {
    wanted: 0,
    police: [],
    stats: { spawned: 0, gaveUp: 0, rams: 0, busts: 0, crimes: {} },
  };
  let rng = () => 0.5;
  let cleanTimer = 0;
  let lastCrimeTime = -1e9;
  let bustTimer = 0;
  const crimeCooldowns = {};

  function capFor(wanted) {
    return POLICE.capByWanted[clamp(wanted, 0, HUD.wantedMax)];
  }

  function spawnCruiser(targetX, targetZ) {
    // Pick an intersection 60-100 m from the player, on a road, facing them.
    const lines = [];
    for (let k = 0; k < 11; k += 1) lines.push(-266 + 52 * k);
    lines.push(-312, 312);
    const candidates = [];
    for (const ix of lines) {
      for (const iz of lines) {
        const d = Math.hypot(ix - targetX, iz - targetZ);
        if (d >= POLICE.spawnMinDistance && d <= POLICE.spawnMaxDistance) {
          candidates.push({ ix, iz });
        }
      }
    }
    if (candidates.length === 0) return null;
    const pick = candidates[Math.floor(rng() * candidates.length)];
    const dx = targetX - pick.ix;
    const dz = targetZ - pick.iz;
    // Face the player along the axis with the larger gap.
    const road = Math.abs(dx) >= Math.abs(dz) ? 'h' : 'v';
    const line = road === 'h' ? pick.iz : pick.ix;
    const dir = road === 'h' ? (dx >= 0 ? 1 : -1) : (dz >= 0 ? 1 : -1);
    const lane = laneOffset(road, dir);
    const cruiser = {
      road,
      line,
      dir,
      s: road === 'h' ? pick.ix : pick.iz,
      laneNow: lane,
      laneTarget: lane,
      blendLane: true,
      speed: 0,
      mode: 'pursue',
      lastSeen: { x: targetX, z: targetZ, time: 0 },
      searchUntil: 0,
      losTimer: rng() * POLICE.losCheckSeconds,
      hasLos: true,
      ramCooldown: 0,
      stuckTime: 0,
      direct: false,
      x: road === 'h' ? pick.ix : pick.ix + lane,
      z: road === 'v' ? pick.iz : pick.iz + lane,
      heading: road === 'v' ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2),
    };
    const pos = roadPos(cruiser);
    cruiser.x = pos.x;
    cruiser.z = pos.z;
    cruiser.heading = pos.heading;
    return cruiser;
  }

  function topUp(targetX, targetZ) {
    const want = capFor(state.wanted);
    while (state.police.length < want) {
      const cruiser = spawnCruiser(targetX, targetZ);
      if (!cruiser) break;
      state.police.push(cruiser);
      state.stats.spawned += 1;
    }
  }

  function reset(random) {
    rng = random;
    state.wanted = 0;
    state.police = [];
    state.stats = { spawned: 0, gaveUp: 0, rams: 0, busts: 0, crimes: {} };
    cleanTimer = 0;
    lastCrimeTime = -1e9;
    bustTimer = 0;
    for (const key of Object.keys(crimeCooldowns)) delete crimeCooldowns[key];
  }

  /**
   * A crime happened. One incident of one kind is one star: a kind that fired
   * within the cooldown does not add another. Returns true when the level rose.
   */
  function commitCrime(kind, time, targetX, targetZ) {
    const last = crimeCooldowns[kind] ?? -1e9;
    if (time - last < POLICE.crimeCooldown) return false;
    crimeCooldowns[kind] = time;
    lastCrimeTime = time;
    cleanTimer = 0;
    state.wanted = Math.min(HUD.wantedMax, state.wanted + 1);
    state.stats.crimes[kind] = (state.stats.crimes[kind] ?? 0) + 1;
    topUp(targetX, targetZ);
    return true;
  }

  function setWanted(n, time, targetX, targetZ) {
    state.wanted = clamp(n, 0, HUD.wantedMax);
    cleanTimer = 0;
    if (state.wanted === 0) {
      state.police = [];
    } else {
      topUp(targetX, targetZ);
    }
    void time;
  }

  function despawnAll() {
    state.police = [];
  }

  /** Greedy road choice: the leg whose far end is closest to the target. */
  function decideGreedy(target) {
    return (car, ix, iz, turns, canStraight) => {
      const options = [];
      if (canStraight) {
        const leg = legFrom(ix, iz, car.road, car.dir, false);
        if (leg) {
          const ex = car.road === 'v' ? ix : ix + car.dir * 20;
          const ez = car.road === 'v' ? iz + car.dir * 20 : iz;
          options.push({ choice: 'straight', dist: Math.hypot(ex - target.x, ez - target.z) });
        }
      }
      for (const turn of turns) {
        const leg = legFrom(ix, iz, turn.road, turn.dir, false);
        if (!leg) continue;
        const ex = turn.road === 'v' ? ix : ix + turn.dir * 20;
        const ez = turn.road === 'v' ? iz + turn.dir * 20 : iz;
        options.push({ choice: turn, dist: Math.hypot(ex - target.x, ez - target.z) });
      }
      if (options.length === 0) return 'uturn';
      options.sort((a, b) => a.dist - b.dist);
      return options[0].choice;
    };
  }

  function decideRandom(car, ix, iz, turns, canStraight) {
    const r = rng();
    if (r < 0.6 && canStraight) return 'straight';
    if (turns.length > 0) return turns[Math.floor(rng() * turns.length)];
    if (canStraight) return 'straight';
    return 'uturn';
  }

  /**
   * One step. ctx: { time, car, player, mode, colliders, damage, commitCrime }.
   * Returns 'bust' when the player is caught standing still, else ''.
   */
  function step(dt, ctx) {
    const target = ctx.mode === 'car'
      ? { x: ctx.car.x, z: ctx.car.z, speed: Math.abs(ctx.car.speed) }
      : { x: ctx.player.x, z: ctx.player.z, speed: ctx.player.moving ? (ctx.player.running ? 9 : 5) : 0 };
    let anyLos = false;
    let nearest = Infinity;

    for (let i = state.police.length - 1; i >= 0; i -= 1) {
      const p = state.police[i];
      p.ramCooldown = Math.max(0, p.ramCooldown - dt);
      const dx = target.x - p.x;
      const dz = target.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist < nearest) nearest = dist;

      // Line of sight, re-checked a few times a second (buildings block it).
      p.losTimer -= dt;
      if (p.losTimer <= 0) {
        p.losTimer = POLICE.losCheckSeconds;
        p.hasLos = dist < POLICE.sightRange
          && hasLineOfSight(p.x, p.z, target.x, target.z, ctx.colliders);
        if (p.hasLos) {
          p.lastSeen = { x: target.x, z: target.z, time: ctx.time };
          if (p.mode !== 'pursue') p.mode = 'pursue';
        }
      }
      if (p.hasLos) anyLos = true;

      if (p.mode === 'pursue' && !p.hasLos && ctx.time - p.lastSeen.time > POLICE.loseSeconds) {
        p.mode = 'search';
        p.searchUntil = ctx.time + POLICE.searchSeconds;
        p.direct = false;
      }
      if (p.mode === 'search' && ctx.time >= p.searchUntil) {
        // Gave up: the cruiser leaves, and only then can the wanted level decay.
        state.police.splice(i, 1);
        state.stats.gaveUp += 1;
        continue;
      }

      // Movement: close in, the cruiser leaves the road grid for the final lunge.
      const goal = p.mode === 'search' ? p.lastSeen : target;
      const goalDist = Math.hypot(goal.x - p.x, goal.z - p.z);
      if (p.mode === 'pursue' && dist < 14) {
        // Direct pursuit: steer straight at the player (roads be damned, briefly).
        if (!p.direct) { p.direct = true; p.stuckTime = 0; }
        p.heading = Math.atan2(dx, dz);
        p.speed = Math.min(POLICE.maxSpeed, p.speed + POLICE.accel * dt);
        let x = p.x + Math.sin(p.heading) * p.speed * dt;
        let z = p.z + Math.cos(p.heading) * p.speed * dt;
        x = clamp(x, BOUNDS.minX, BOUNDS.maxX);
        z = clamp(z, BOUNDS.minZ, BOUNDS.maxZ);
        const resolved = pushOutOfColliders(x, z, 1.9, ctx.colliders);
        if (resolved.hit) p.speed *= 0.5;
        p.x = resolved.x;
        p.z = resolved.z;
        if (p.speed < 1) p.stuckTime += dt;
        else p.stuckTime = 0;
        if (p.stuckTime > 3 || dist > 20) {
          // Stuck on a building, or the player pulled away: back to the roads.
          p.direct = false;
          p.stuckTime = 0;
          const snapped = snapToRoad(p.x, p.z, p.heading);
          p.road = snapped.road;
          p.line = snapped.line;
          p.dir = snapped.dir;
          p.s = snapped.s;
          p.laneNow = laneOffset(p.road, p.dir);
          p.laneTarget = p.laneNow;
        }
      } else {
        p.direct = false;
        const decide = p.mode === 'search' && goalDist < 8
          ? decideRandom
          : decideGreedy(goal);
        // Cruise a little under top speed on the grid; full speed on the lunge.
        const cruise = POLICE.maxSpeed * 0.92;
        p.speed = Math.min(cruise, p.speed + POLICE.accel * dt);
        stepRoadCar(p, dt, decide, false);
        const pos = roadPos(p);
        p.x = pos.x;
        p.z = pos.z;
        p.heading = pos.heading;
      }

      // Ram: contact with the player. The player ploughing into a cruiser at
      // speed is also a crime (hit-police); a cruiser's own ram is not.
      if (dist < POLICE.ramDistance && p.ramCooldown <= 0) {
        p.ramCooldown = POLICE.ramCooldown;
        if (ctx.mode === 'car') {
          if (Math.abs(ctx.car.speed) > 15) ctx.commitCrime('hit-police');
          ctx.car.speed *= 0.55;
        }
        ctx.damage(POLICE.ramDamage);
        p.speed *= 0.3;
        state.stats.rams += 1;
      }
    }

    // Busted: standing still with a cruiser close by.
    if (state.police.length > 0 && target.speed < 1 && nearest < POLICE.bustDistance) {
      bustTimer += dt;
      if (bustTimer >= POLICE.bustSeconds) {
        bustTimer = 0;
        state.stats.busts += 1;
        return 'bust';
      }
    } else {
      bustTimer = 0;
    }

    // Decay: only once every cruiser is gone (gave up) and no crime lately.
    // A fresh crime while they search brings them straight back to the chase.
    if (state.wanted > 0 && state.police.length === 0 && ctx.time - lastCrimeTime > POLICE.crimeCooldown) {
      cleanTimer += dt;
      if (cleanTimer >= POLICE.decaySeconds) {
        cleanTimer = 0;
        state.wanted -= 1;
      }
    } else if (state.wanted > 0 && anyLos) {
      cleanTimer = 0;
    }
    return '';
  }

  return { state, reset, step, commitCrime, setWanted, despawnAll };
}
