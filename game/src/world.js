// Solmarina's sim: one fixed step advances Rio, his car, traffic, pedestrians, the
// police, the mission chain, combat, collectibles and the city's standing — and
// nothing else. No THREE, no DOM, no Math.random: the only randomness is the seeded
// generator passed in, so the same seed and the same inputs always give the same
// trace. The renderer and the HUD only read `state`.
import { CITY, DISTRICTS, PLAYER, CAR, STEP, TRACE, CAR_MODELS, EXPORT_MODELS, BUST_CASH_LOSS } from './config.js';
import { buildCity, districtAt, distToRoad } from './city.js';
import { createTraffic } from './traffic.js';
import { createPolice } from './police.js';
import { createMissions } from './missions.js';
import { createCombat } from './combat.js';
import { CREW, createCrew, resetCrew, stepCrew, useAbility } from './crew.js';
import { RANKS, XP_ENEMY_DOWN, XP_EXPORT, XP_MISSION, XP_SHELL, addXp, cooldownMult, createRank, exportMult, missionMult, resetRank } from './rank.js';
import { createHeli, resetHeli, stepHeli } from './heli.js';
import { WEAPONS } from './weapons.js';
import { START_HOUR, hoursAt } from './daynight.js';

export const EVENT_BUST = 1;
export const EVENT_MISSION = 2;

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function circleVsBuildings(x, z, radius, buildings) {
  for (const b of buildings) {
    const cx = Math.max(b.x - b.w / 2, Math.min(x, b.x + b.w / 2));
    const cz = Math.max(b.z - b.d / 2, Math.min(z, b.z + b.d / 2));
    const dx = x - cx;
    const dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      const d = Math.sqrt(d2) || 0.01;
      return { x: cx + (dx / d) * radius, z: cz + (dz / d) * radius, hit: true };
    }
  }
  return { x, z, hit: false };
}

export function createWorld(random) {
  const city = buildCity(random);
  const traffic = createTraffic(random);
  const police = createPolice(random);
  const missions = createMissions();
  const combat = createCombat(random);
  const crew = createCrew();
  const rank = createRank();
  const heli = createHeli(random);

  const player = {
    x: city.spawn.x, z: city.spawn.z, heading: city.spawn.heading,
    mode: 'foot', health: PLAYER.health, vx: 0, vz: 0, speed: 0,
    lastHurt: -99, down: false,
  };
  const heroCar = {
    x: city.spawn.x, z: city.spawn.z, heading: city.spawn.heading,
    speed: 0, damage: 0, model: 0, color: CAR_MODELS[0].color, stolen: false,
  };
  const state = {
    time: 0, cash: 0, seed: 0,
    // In-game clock: game hours 0..24, a pure function of the step count
    // (see daynight.js) — never the wall clock. clockPin freezes it: the
    // cover staging pins the clock to sunset so the staged frame keeps the
    // v4.3 light exactly; null means the clock runs free.
    gameHour: START_HOUR, clockPin: null,
    player, heroCar, city, traffic, police, missions, combat, crew, rank, heli,
    standing: DISTRICTS.map(() => 50),
    shellsTaken: 0,
    exportsDone: [],
    stats: { distance: 0, carsStolen: 0, copsEscaped: 0, shots: 0, hits: 0, missionsDone: 0, timePlayed: 0 },
    objective: { text: '', x: 0, z: 0, dist: 0 },
    events: [],
    traceSamples: [],
    stepCount: 0,
    wantedWas: 0,
    crimeCooldown: 0,
    hitCooldown: 0,
  };

  function missionApi() {
    return {
      events: state.events,
      playerX: () => (player.mode === 'car' ? heroCar.x : player.x),
      playerZ: () => (player.mode === 'car' ? heroCar.z : player.z),
      playerMode: () => player.mode,
      wanted: () => police.state.wanted,
      van: () => traffic.van(),
      addCash: (n) => { state.cash += Math.round(n * missionMult(rank)); },
      setWanted: (n) => police.setWanted(n, state.events),
      markVan: () => traffic.markVan(CITY.downtownPickup, CITY.marinaDrop),
      unmarkVan: () => traffic.unmarkVan(),
      spawnEnemies: () => combat.spawnEnemies({ x: 300, z: 40 }),
    };
  }

  /** The crew's world: what an ability needs to touch, nothing more. */
  function crewApi() {
    return {
      inCar: () => player.mode === 'car',
      clearWanted: () => police.clearWanted(),
      fixCar: () => { heroCar.damage = 0; },
    };
  }

  /** Feed XP to rank; a climb opens its unlocks and announces itself. */
  function awardXp(amount) {
    if (!amount) return;
    const climbed = addXp(rank, amount);
    for (const c of climbed) {
      const opened = combat.unlockForRank(c.level);
      state.events.push({ type: 'rank-up', level: c.level, name: c.name, unlock: c.unlock, opened });
    }
  }

  function reset(seed) {
    state.seed = seed;
    state.time = 0;
    state.clockPin = null;
    state.gameHour = START_HOUR;
    state.cash = 0;
    state.standing = DISTRICTS.map(() => 50);
    state.shellsTaken = 0;
    state.exportsDone = [];
    state.stats = { distance: 0, carsStolen: 0, copsEscaped: 0, shots: 0, hits: 0, missionsDone: 0, timePlayed: 0 };
    state.events = [];
    state.traceSamples = [];
    state.stepCount = 0;
    state.wantedWas = 0;
    player.x = city.spawn.x;
    player.z = city.spawn.z;
    player.heading = city.spawn.heading;
    player.mode = 'foot';
    player.health = PLAYER.health;
    heroCar.x = city.spawn.x;
    heroCar.z = city.spawn.z;
    heroCar.heading = city.spawn.heading;
    heroCar.speed = 0;
    heroCar.damage = 0;
    heroCar.model = 0;
    heroCar.color = CAR_MODELS[0].color;
    heroCar.stolen = false;
    traffic.reset();
    police.reset();
    missions.reset();
    combat.reset();
    resetCrew(crew);
    resetRank(rank);
    resetHeli(heli);
    for (const s of city.shells) s.taken = false;
    missions.start(missionApi());
    updateObjective();
  }

  function updateObjective() {
    state.objective = missions.objective(missionApi());
  }

  function stepFoot(dt, input) {
    const mx = input.moveX || 0;
    const mz = input.moveZ || 0;
    const len = Math.hypot(mx, mz);
    const speed = input.run ? PLAYER.runSpeed : PLAYER.walkSpeed;
    if (len > 0.01) {
      const nx = mx / len;
      const nz = mz / len;
      const want = Math.atan2(-nz, nx);
      let d = want - player.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      player.heading += Math.max(-PLAYER.turnRate * dt, Math.min(PLAYER.turnRate * dt, d));
      const vx = Math.cos(player.heading) * speed;
      const vz = -Math.sin(player.heading) * speed;
      const nx2 = player.x + vx * dt;
      const nz2 = player.z + vz * dt;
      const hit = circleVsBuildings(nx2, nz2, PLAYER.radius, city.buildings);
      const moved = Math.hypot(hit.x - player.x, hit.z - player.z);
      state.stats.distance += moved;
      player.x = hit.x;
      player.z = hit.z;
      player.vx = vx;
      player.vz = vz;
      player.speed = speed;
    } else {
      player.vx = 0;
      player.vz = 0;
      player.speed = 0;
    }
  }

  function stepCar(dt, input) {
    const steer = input.steer || 0;
    const throttle = input.throttle || 0;
    const top = input.boost ? CAR.boostTop : CAR.topSpeed;
    if (throttle > 0) heroCar.speed += CAR.accel * throttle * dt;
    else if (throttle < 0) heroCar.speed += CAR.accel * throttle * dt * 0.7;
    else heroCar.speed *= Math.pow(0.4, dt);
    if (input.brake) heroCar.speed -= Math.sign(heroCar.speed) * CAR.brake * dt;
    heroCar.speed = Math.max(-CAR.reverseMax, Math.min(top, heroCar.speed));
    if (Math.abs(heroCar.speed) < 0.05) heroCar.speed = 0;
    const rate = CAR.steerRate * Math.min(1, Math.abs(heroCar.speed) / 8);
    heroCar.heading += steer * rate * dt * Math.sign(heroCar.speed || 1);
    // Don't rear-end the car ahead: ease off when traffic is close in front.
    const fx = Math.cos(heroCar.heading);
    const fz = -Math.sin(heroCar.heading);
    for (const c of traffic.cars) {
      const dx = c.x - heroCar.x;
      const dz = c.z - heroCar.z;
      const along = dx * fx + dz * fz;
      const side = Math.abs(dx * fz - dz * fx);
      if (along > 0 && along < 10 && side < 2.5) {
        heroCar.speed = Math.min(heroCar.speed, Math.max(0, c.speed));
        break;
      }
    }
    const vx = Math.cos(heroCar.heading) * heroCar.speed;
    const vz = -Math.sin(heroCar.heading) * heroCar.speed;
    const nx = heroCar.x + vx * dt;
    const nz = heroCar.z + vz * dt;
    const hit = circleVsBuildings(nx, nz, CAR.radius, city.buildings);
    if (hit.hit && Math.abs(heroCar.speed) > 4) {
      heroCar.damage = Math.min(100, heroCar.damage + CAR.damagePerHit);
      heroCar.speed *= 0.4;
    }
    const moved = Math.hypot(hit.x - heroCar.x, hit.z - heroCar.z);
    state.stats.distance += moved;
    heroCar.x = hit.x;
    heroCar.z = hit.z;
    // Drag back inside the playable area.
    heroCar.x = Math.max(CITY.gridMin - 10, Math.min(CITY.pier.x + 24, heroCar.x));
    heroCar.z = Math.max(CITY.gridMin - 10, Math.min(CITY.gridMax + 10, heroCar.z));
  }

  function hitTest(ox, oz, angle, range) {
    // Enemies first, then pedestrians, then the city itself.
    let best = null;
    for (const e of combat.state.enemies) {
      if (!e.alive) continue;
      const dx = e.x - ox;
      const dz = e.z - oz;
      const along = dx * Math.cos(angle) - dz * Math.sin(angle);
      if (along < 1 || along > range) continue;
      const perp = Math.abs(dx * Math.sin(angle) + dz * Math.cos(angle));
      if (perp < 1.4 && (!best || along < best.dist)) best = { kind: 'enemy', dist: along, enemy: e };
    }
    for (const p of traffic.peds) {
      if (p.down) continue;
      const dx = p.x - ox;
      const dz = p.z - oz;
      const along = dx * Math.cos(angle) - dz * Math.sin(angle);
      if (along < 1 || along > range) continue;
      const perp = Math.abs(dx * Math.sin(angle) + dz * Math.cos(angle));
      if (perp < 1.0 && (!best || along < best.dist)) best = { kind: 'ped', dist: along };
    }
    // Buildings: march along the ray; the first sample inside a wall ends the shot.
    for (let d = 2; d < range; d += 2) {
      const x = ox + Math.cos(angle) * d;
      const z = oz - Math.sin(angle) * d;
      for (const b of city.buildings) {
        if (x > b.x - b.w / 2 && x < b.x + b.w / 2 && z > b.z - b.d / 2 && z < b.z + b.d / 2) {
          if (!best || d < best.dist) return { kind: 'wall', dist: d };
          break;
        }
      }
    }
    return best;
  }

  function tryEnterExit() {
    if (player.mode === 'foot') {
      const dCar = Math.hypot(heroCar.x - player.x, heroCar.z - player.z);
      if (dCar < 4) {
        player.mode = 'car';
        return;
      }
      // Steal a parked traffic car: it becomes the hero car, the old one stays put.
      let best = null;
      let bd = 4;
      for (const c of traffic.cars) {
        const d = Math.hypot(c.x - player.x, c.z - player.z);
        if (d < bd && Math.abs(c.speed) < 1) { bd = d; best = c; }
      }
      if (best) {
        const ox = heroCar.x;
        const oz = heroCar.z;
        const oh = heroCar.heading;
        heroCar.x = best.x;
        heroCar.z = best.z;
        heroCar.heading = best.heading;
        heroCar.speed = 0;
        heroCar.damage = 0;
        heroCar.model = ((Math.floor(Math.abs(best.x * 7 + best.z * 3)) % CAR_MODELS.length) + CAR_MODELS.length) % CAR_MODELS.length;
        heroCar.color = best.color;
        heroCar.stolen = true;
        best.x = ox;
        best.z = oz;
        best.heading = oh;
        best.speed = 0;
        player.mode = 'car';
        state.stats.carsStolen += 1;
        police.addWanted(1, 'stolen car', state.events);
        checkExport();
      }
    } else {
      player.mode = 'foot';
      player.x = heroCar.x + Math.cos(heroCar.heading + Math.PI / 2) * 3;
      player.z = heroCar.z - Math.sin(heroCar.heading + Math.PI / 2) * 3;
      player.heading = heroCar.heading;
      const hit = circleVsBuildings(player.x, player.z, PLAYER.radius, city.buildings);
      player.x = hit.x;
      player.z = hit.z;
    }
  }

  function checkExport() {
    const modelName = CAR_MODELS[heroCar.model].name;
    if (!EXPORT_MODELS.includes(modelName) || state.exportsDone.includes(modelName)) return;
    const d = Math.hypot(heroCar.x - CITY.marinaDrop.x, heroCar.z - CITY.marinaDrop.z);
    if (d < 12) {
      state.exportsDone.push(modelName);
      state.cash += 300 * exportMult(rank);
      awardXp(XP_EXPORT);
      state.events.push({ type: 'export', model: modelName, reward: 300 * exportMult(rank) });
    }
  }

  function carTrafficCollisions(dt) {
    if (player.mode !== 'car') return;
    if (state.hitCooldown > 0) state.hitCooldown -= dt;
    for (const c of traffic.cars) {
      const d = Math.hypot(c.x - heroCar.x, c.z - heroCar.z);
      if (d < 4.4 && d > 0.01) {
        const push = (4.4 - d) / 2;
        const nx = (heroCar.x - c.x) / d;
        const nz = (heroCar.z - c.z) / d;
        heroCar.x += nx * push;
        heroCar.z += nz * push;
        if (Math.abs(heroCar.speed) > 6 && state.hitCooldown <= 0) {
          state.hitCooldown = 1;
          heroCar.damage = Math.min(100, heroCar.damage + CAR.damagePerHit);
          heroCar.speed *= 0.55;
          police.addWanted(1, 'traffic collision', state.events);
        }
      }
    }
    // Police rams: a cruiser bumper-to-bumper slows the hero car and dents it.
    for (const u of police.units) {
      const d = Math.hypot(u.x - heroCar.x, u.z - heroCar.z);
      if (d < 4.6 && d > 0.01) {
        const nx = (heroCar.x - u.x) / d;
        const nz = (heroCar.z - u.z) / d;
        heroCar.x += nx * 0.6;
        heroCar.z += nz * 0.6;
        heroCar.speed *= 0.985;
        if (Math.abs(heroCar.speed) > 10 && state.hitCooldown <= 0) {
          state.hitCooldown = 1;
          heroCar.damage = Math.min(100, heroCar.damage + 4);
        }
      }
    }
    // Pedestrians in the way of a moving car: a crime, and the ped goes down.
    for (const p of traffic.peds) {
      if (p.down) continue;
      const d = Math.hypot(p.x - heroCar.x, p.z - heroCar.z);
      if (d < 2.4 && Math.abs(heroCar.speed) > 3) {
        p.down = true;
        p.downTimer = 4;
        police.addWanted(1, 'pedestrian hit', state.events);
      }
    }
  }

  function stepPedsDown(dt) {
    for (const p of traffic.peds) {
      if (!p.down) continue;
      p.downTimer -= dt;
      if (p.downTimer <= 0) {
        p.down = false;
        p.x += 10;
        p.z += 10;
      }
    }
  }

  /** Freeze the in-game clock at an hour (cover staging); null frees it. */
  function pinClock(hour) {
    state.clockPin = hour;
    state.gameHour = hour;
  }

  function step(dt, input) {
    state.stepCount += 1;
    state.time += dt;
    // The clock follows the sim step count only — pinned, it stays put.
    state.gameHour = state.clockPin !== null ? state.clockPin : hoursAt(state.stepCount);
    state.stats.timePlayed += dt;
    if (state.crimeCooldown > 0) state.crimeCooldown -= dt;
    // Only events raised during THIS step get their effects applied below; the
    // HUD drains the queue itself, so older entries must not pay out twice.
    const eventMark = state.events.length;

    if (input.enter) tryEnterExit();
    // One-shot picks, consumed here so a press between substeps fires once:
    // a weapon switch, and a crew ability on its key.
    if (input.weaponSelect !== undefined && input.weaponSelect !== null && input.weaponSelect >= 0) {
      const picked = input.weaponSelect;
      input.weaponSelect = -1;
      const switched = combat.selectWeapon(picked, rank.state.level);
      if (switched === 'locked') {
        state.events.push({ type: 'weapon-locked', name: WEAPONS[picked].name, rank: RANKS[WEAPONS[picked].unlockRank].name });
      }
    }
    if (input.crewUse !== undefined && input.crewUse !== null && input.crewUse >= 0) {
      const picked = input.crewUse;
      input.crewUse = -1;
      const used = useAbility(crew, picked, crewApi(), state.events, cooldownMult(rank));
      if (used === 'cooling') {
        state.events.push({ type: 'crew-cooling', ability: CREW[picked].ability, seconds: Math.ceil(crew.state.cooldowns[picked]) });
      } else if (used === 'need-car') {
        state.events.push({ type: 'crew-need-car', ability: CREW[picked].ability });
      }
    }
    if (player.mode === 'car') stepCar(dt, input);
    else stepFoot(dt, input);

    traffic.step(dt, player.mode === 'car' ? heroCar : player);
    stepPedsDown(dt);
    carTrafficCollisions(dt);

    // Shooting: the aim angle comes from the mouse, converted by main.js.
    if (input.shootAngle !== null && input.shootAngle !== undefined && player.mode === 'foot') {
      const ox = player.x + Math.cos(player.heading) * 1.2;
      const oz = player.z - Math.sin(player.heading) * 1.2;
      if (combat.shoot(ox, oz, input.shootAngle, hitTest, state.events)) {
        state.stats.shots += 1;
        if (state.crimeCooldown <= 0) {
          state.crimeCooldown = 2;
          police.addWanted(1, 'shots fired', state.events);
        }
      }
    }
    if (input.reload) combat.reload();

    const busted = police.step(dt, player, heroCar, state.events);
    // Air support answers the wanted level after the cruisers do; the dispatch
    // panel names it like any other unit.
    const pxNow = player.mode === 'car' ? heroCar.x : player.x;
    const pzNow = player.mode === 'car' ? heroCar.z : player.z;
    stepHeli(heli, dt, pxNow, pzNow, police.state.wanted, state.events);
    if (heli.state.active) {
      state.police.state.dispatch.push({
        id: 'AIR-1',
        role: 'AIR SUPPORT',
        dist: Math.round(Math.hypot(heli.state.x - pxNow, heli.state.z - pzNow)),
      });
    }
    stepCrew(crew, dt);
    if (busted) {
      const lost = police.doBust(player, heroCar, state.cash);
      state.cash = Math.max(0, state.cash - lost);
      state.events.push({ type: 'bust', lost });
      missions.failMission(missionApi(), 'busted');
      combat.clearEnemies();
    }

    // Mission chain runs after the police: a bust this step restarts the mission.
    missions.step(dt, missionApi());
    combat.step(dt, player, state.events);

    // Drain the combat event queue into the world: cash, health, standing.
    // Only this step's events (from eventMark on) — see the note at step start.
    for (const ev of state.events.slice(eventMark)) {
      if (ev.type === 'mission-complete') {
        state.stats.missionsDone += 1;
        const d = districtAt(player.x, player.z);
        state.standing[d] = Math.min(100, state.standing[d] + 8);
        awardXp(XP_MISSION[ev.id] || 0);
      } else if (ev.type === 'enemy-down') {
        state.cash += ev.reward;
        state.stats.hits += 1;
        awardXp(XP_ENEMY_DOWN);
      } else if (ev.type === 'player-hit') {
        player.health -= ev.damage;
        player.lastHurt = state.time;
        if (player.health <= 0) {
          player.health = PLAYER.health;
          const lost = police.doBust(player, heroCar, state.cash);
          state.cash = Math.max(0, state.cash - lost);
          state.events.push({ type: 'bust', lost });
          missions.failMission(missionApi(), 'busted');
        }
      }
    }

    // Health regen after five quiet seconds.
    if (state.time - player.lastHurt > PLAYER.regenDelay && player.health < PLAYER.health) {
      player.health = Math.min(PLAYER.health, player.health + PLAYER.regenRate * dt);
    }

    // Shells: walk or drive over one and it is yours.
    const px = player.mode === 'car' ? heroCar.x : player.x;
    const pz = player.mode === 'car' ? heroCar.z : player.z;
    for (const s of city.shells) {
      if (!s.taken && Math.hypot(s.x - px, s.z - pz) < 2.5) {
        s.taken = true;
        state.shellsTaken += 1;
        state.cash += 25;
        awardXp(XP_SHELL);
        state.events.push({ type: 'shell', total: state.shellsTaken });
      }
    }
    if (player.mode === 'car') checkExport();

    // Friendly districts hide you: wanted decays twice as fast there.
    const di = districtAt(px, pz);
    if (state.standing[di] >= 60 && police.state.wanted > 0) {
      police.state.decayTimer -= dt;
    }
    if (state.wantedWas >= 3 && police.state.wanted === 0) state.stats.copsEscaped += 1;
    state.wantedWas = police.state.wanted;

    updateObjective();

    if (state.stepCount % TRACE.sampleEvery === 0) {
      const sample = [
        state.stepCount,
        Math.round(px * 100), Math.round(pz * 100),
        Math.round(player.heading * 1000),
        Math.round(heroCar.x * 100), Math.round(heroCar.z * 100),
        police.state.wanted,
        missions.state.active, missions.state.stage,
        state.cash,
        Math.round(traffic.cars[0].x * 100), Math.round(traffic.cars[0].z * 100),
        Math.round(traffic.peds[0].x * 100),
      ].join(',');
      state.traceSamples.push(fnv1a(sample));
    }
  }

  /** Completion across missions, shells, exports and friendly districts. */
  function completion() {
    const m = (missions.state.completed.length / 4) * 50;
    const s = (state.shellsTaken / 20) * 20;
    const e = (state.exportsDone.length / EXPORT_MODELS.length) * 15;
    const friendly = state.standing.filter((v) => v >= 60).length;
    const d = (friendly / DISTRICTS.length) * 15;
    return Math.round(m + s + e + d);
  }

  function traceHash() {
    return fnv1a(state.traceSamples.join('|'));
  }

  function snapshot() {
    return {
      cash: state.cash,
      missionUnlocked: missions.state.unlocked,
      ratings: missions.state.ratings,
      title: missions.state.title,
      shells: state.shellsTaken,
      exports: state.exportsDone,
      standing: state.standing,
      x: player.x, z: player.z, heading: player.heading, mode: player.mode,
      health: player.health,
      carX: heroCar.x, carZ: heroCar.z, carHeading: heroCar.heading,
      time: state.time,
      stepCount: state.stepCount,
      district: DISTRICTS[districtAt(player.x, player.z)].name,
      completion: completion(),
      rankXp: rank.state.xp,
      rankLevel: rank.state.level,
      loadout: combat.loadoutSnapshot(),
      crewCooldowns: crew.state.cooldowns.slice(),
      crewEyesOut: crew.state.eyesOut,
      crewUsed: crew.state.used,
    };
  }

  function applySnapshot(s) {
    state.cash = s.cash || 0;
    missions.state.unlocked = s.missionUnlocked || 1;
    missions.state.ratings = s.ratings || {};
    missions.state.title = s.title || '';
    state.shellsTaken = s.shells || 0;
    state.exportsDone = s.exports || [];
    state.standing = s.standing || DISTRICTS.map(() => 50);
    player.x = s.x;
    player.z = s.z;
    player.heading = s.heading;
    player.mode = s.mode || 'foot';
    player.health = s.health || PLAYER.health;
    heroCar.x = s.carX ?? city.spawn.x;
    heroCar.z = s.carZ ?? city.spawn.z;
    heroCar.heading = s.carHeading ?? 0;
    // Restore the clock from the saved step count, so loading a save keeps
    // the time of day instead of resetting to sunset.
    state.time = s.time || 0;
    state.stepCount = s.stepCount || 0;
    state.gameHour = hoursAt(state.stepCount);
    rank.state.xp = s.rankXp || 0;
    rank.state.level = s.rankLevel || 0;
    combat.loadoutApply(s.loadout);
    if (Array.isArray(s.crewCooldowns)) crew.state.cooldowns = s.crewCooldowns.slice(0, 3);
    crew.state.eyesOut = s.crewEyesOut || 0;
    crew.state.used = s.crewUsed || 0;
    for (let i = 0; i < state.shellsTaken && i < city.shells.length; i += 1) city.shells[i].taken = true;
    missions.start(missionApi());
  }

  reset(1);
  return {
    state, reset, step, pinClock, completion, traceHash, snapshot, applySnapshot,
    districtAt,
  };
}
