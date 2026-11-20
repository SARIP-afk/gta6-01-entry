// Wanted and the police who answer it. Wanted runs 0–5 with a named tier per level;
// cruisers spawn on the roads near the player, pursue, ram, lose the trail, search,
// give up, and the wanted level decays — the loop a chase is made of. A bust costs a
// quarter of the cash and sends Rio back to the safehouse. The safehouse itself is
// off-limits: no cruiser enters its radius, and wanted clears while Rio stands in it.
import { CITY, PLAYER, WANTED_MAX, WANTED_TIERS, WANTED_DECAY_SECONDS, BUST_CASH_LOSS } from './config.js';
import { snapToRoad } from './city.js';

let unitCounter = 0;

export function createPolice(random) {
  const units = [];
  const state = {
    wanted: 0,
    heat: 0,
    loseTimer: 0,
    searchTimer: 0,
    decayTimer: 0,
    bustTimer: 0,
    busted: false,
    // What the dispatch panel shows: the nearest units, their job and their distance.
    dispatch: [],
  };

  function spawnUnit(x, z) {
    unitCounter += 1;
    const id = `SOL-${String(10 + (unitCounter % 89))}`;
    const p = snapToRoad(x + (random() - 0.5) * 120, z + (random() - 0.5) * 120);
    units.push({
      id, x: p.x, z: p.z, heading: random() * Math.PI * 2, speed: 0,
      role: 'PURSUIT', mode: 'pursue', searchX: 0, searchZ: 0, searchT: 0,
    });
    return units[units.length - 1];
  }

  function wantCruisers() {
    return WANTED_TIERS[Math.min(state.wanted, WANTED_MAX)].cruisers;
  }

  /** Raise wanted by `levels` for `cause`; returns the new level. */
  function addWanted(levels, cause, events) {
    if (state.wanted >= WANTED_MAX) return state.wanted;
    state.wanted = Math.min(WANTED_MAX, state.wanted + levels);
    state.heat = state.wanted;
    state.decayTimer = WANTED_DECAY_SECONDS;
    if (events) events.push({ type: 'crime', cause, wanted: state.wanted });
    return state.wanted;
  }

  function setWanted(level, events) {
    state.wanted = Math.max(0, Math.min(WANTED_MAX, level));
    state.heat = state.wanted;
    state.decayTimer = WANTED_DECAY_SECONDS;
    state.loseTimer = 0;
    state.searchTimer = 0;
    if (events && level > 0) events.push({ type: 'crime', cause: 'wanted set', wanted: state.wanted });
  }

  function clearWanted() {
    state.wanted = 0;
    state.heat = 0;
    state.loseTimer = 0;
    state.searchTimer = 0;
    for (const u of units) u.mode = 'giveup';
  }

  function stepUnit(u, dt, player, heroCar) {
    const px = player.mode === 'car' ? heroCar.x : player.x;
    const pz = player.mode === 'car' ? heroCar.z : player.z;
    const dx = px - u.x;
    const dz = pz - u.z;
    const dist = Math.hypot(dx, dz);
    const inSafehouse = Math.hypot(px - CITY.safehouse.x, pz - CITY.safehouse.z) < CITY.safehouse.radius;

    if (inSafehouse) {
      // The safehouse is sacred ground: units hold at its edge and the trail goes cold.
      if (dist < CITY.safehouse.radius + 12) {
        u.mode = 'hold';
        u.role = 'HOLDING';
        u.speed = Math.max(0, u.speed - 20 * dt);
        return dist;
      }
    }
    if (u.mode === 'hold' && !inSafehouse) u.mode = 'pursue';

    if (u.mode === 'pursue') {
      u.role = dist < 12 ? 'RAMMING' : dist < 40 ? 'PURSUIT' : 'RESPONDING';
      const want = Math.atan2(-dz, dx);
      let d = want - u.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      // Slow right down when close, or the cruiser just orbits the player forever.
      const turnRate = dist < 12 ? 4.5 : 2.6;
      u.heading += Math.max(-turnRate * dt, Math.min(turnRate * dt, d));
      const top = dist > 25 ? 30 : dist > 12 ? 18 : 7;
      u.speed += ((dist > 25 ? top : top * 0.7) - u.speed) * Math.min(1, 1.8 * dt);
      u.x += Math.cos(u.heading) * u.speed * dt;
      u.z -= Math.sin(u.heading) * u.speed * dt;
    } else if (u.mode === 'search') {
      u.role = 'SEARCHING';
      u.searchT -= dt;
      const want = Math.atan2(-(u.searchZ - u.z), u.searchX - u.x);
      let d = want - u.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      u.heading += Math.max(-2 * dt, Math.min(2 * dt, d));
      u.speed += (10 - u.speed) * Math.min(1, 1.5 * dt);
      u.x += Math.cos(u.heading) * u.speed * dt;
      u.z -= Math.sin(u.heading) * u.speed * dt;
      if (u.searchT <= 0 || Math.hypot(u.searchX - u.x, u.searchZ - u.z) < 6) {
        u.searchX = px + (random() - 0.5) * 120;
        u.searchZ = pz + (random() - 0.5) * 120;
        u.searchT = 6;
      }
    } else {
      // giveup: drive off along the road and fade out.
      u.role = 'STANDING DOWN';
      u.speed = Math.max(0, u.speed - 8 * dt);
      u.x += Math.cos(u.heading) * u.speed * dt;
      u.z -= Math.sin(u.heading) * u.speed * dt;
    }
    return dist;
  }

  /** One fixed step. Returns true when a bust just happened. */
  function step(dt, player, heroCar, events) {
    state.busted = false;
    const px = player.mode === 'car' ? heroCar.x : player.x;
    const pz = player.mode === 'car' ? heroCar.z : player.z;
    const inSafehouse = Math.hypot(px - CITY.safehouse.x, pz - CITY.safehouse.z) < CITY.safehouse.radius;

    // Wanted clears by itself inside the safehouse.
    if (inSafehouse && state.wanted > 0) {
      state.decayTimer -= dt * 3;
      if (state.decayTimer <= 0) {
        state.wanted = Math.max(0, state.wanted - 1);
        state.heat = state.wanted;
        state.decayTimer = WANTED_DECAY_SECONDS;
        if (events) events.push({ type: 'crime', cause: 'laying low at the safehouse', wanted: state.wanted });
      }
    }

    const need = wantCruisers();
    while (units.length < need) spawnUnit(px, pz);
    while (units.length > need) units.pop();

    let nearest = Infinity;
    for (const u of units) {
      const d = stepUnit(u, dt, player, heroCar);
      if (d < nearest) nearest = d;
    }

    // Lose the trail: far away for long enough and the chase cools to a search.
    if (state.wanted > 0) {
      if (nearest > 90) {
        state.loseTimer += dt;
        if (state.loseTimer > WANTED_TIERS[state.wanted].loseTime) {
          for (const u of units) {
            if (u.mode === 'pursue' || u.mode === 'hold') {
              u.mode = 'search';
              u.searchX = px;
              u.searchZ = pz;
              u.searchT = 6;
            }
          }
          state.searchTimer = WANTED_TIERS[state.wanted].searchTime;
          state.loseTimer = 0;
        }
      } else {
        state.loseTimer = 0;
        for (const u of units) if (u.mode === 'search') u.mode = 'pursue';
        state.searchTimer = 0;
      }
      if (state.searchTimer > 0) {
        state.searchTimer -= dt;
        if (state.searchTimer <= 0) {
          state.wanted = Math.max(0, state.wanted - 1);
          state.heat = state.wanted;
          state.decayTimer = WANTED_DECAY_SECONDS;
          for (const u of units) u.mode = 'giveup';
          if (events) events.push({ type: 'crime', cause: 'they lost the trail', wanted: state.wanted });
        }
      } else if (nearest > 120) {
        // No search running and nobody close: slow decay.
        state.decayTimer -= dt;
        if (state.decayTimer <= 0) {
          state.wanted = Math.max(0, state.wanted - 1);
          state.heat = state.wanted;
          state.decayTimer = WANTED_DECAY_SECONDS;
          if (events) events.push({ type: 'crime', cause: 'heat cooling off', wanted: state.wanted });
        }
      }
    }

    // Bust: caught on foot at walking pace, or boxed in while driving.
    if (state.wanted > 0 && units.length > 0) {
      const playerSpeed = player.mode === 'car' ? Math.abs(heroCar.speed) : Math.hypot(player.vx || 0, player.vz || 0);
      const close = units.filter((u) => Math.hypot(u.x - px, u.z - pz) < (player.mode === 'car' ? 8 : 5)).length;
      const needClose = player.mode === 'car' ? 2 : 1;
      if (playerSpeed < 0.6 && close >= needClose) {
        state.bustTimer += dt;
        if (state.bustTimer > (player.mode === 'car' ? 4 : 2.5)) {
          state.busted = true;
          state.bustTimer = 0;
        }
      } else {
        state.bustTimer = 0;
      }
    }

    // Dispatch panel: nearest three units, name + role + live distance.
    const sorted = units.slice().sort((a, b) => {
      const da = Math.hypot(a.x - px, a.z - pz);
      const db = Math.hypot(b.x - px, b.z - pz);
      return da - db;
    });
    state.dispatch = sorted.slice(0, 3).map((u) => ({
      id: u.id,
      role: u.role,
      dist: Math.round(Math.hypot(u.x - px, u.z - pz)),
    }));
    return state.busted;
  }

  function doBust(player, heroCar, cash) {
    const lost = Math.floor(cash * BUST_CASH_LOSS);
    player.x = CITY.safehouse.x;
    player.z = CITY.safehouse.z;
    player.heading = 0;
    player.mode = 'foot';
    player.health = PLAYER.health;
    heroCar.x = CITY.spawn.x;
    heroCar.z = CITY.spawn.z;
    heroCar.heading = 0;
    heroCar.speed = 0;
    heroCar.damage = 0;
    clearWanted();
    units.length = 0;
    return lost;
  }

  function reset() {
    state.wanted = 0;
    state.heat = 0;
    state.loseTimer = 0;
    state.searchTimer = 0;
    state.decayTimer = 0;
    state.bustTimer = 0;
    state.busted = false;
    state.dispatch = [];
    units.length = 0;
  }

  return { state, units, step, addWanted, setWanted, clearWanted, doBust, reset };
}
