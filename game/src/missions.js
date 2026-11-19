// The story: Rio owes the fixer DANTE four jobs, M1 to M4, each two stages. A mission
// is data in config plus this state machine: stage triggers, timers, fail rules,
// par times and gold/silver/bronze ratings. It never touches THREE or the DOM — it
// reads the world through the `api` object and reports through events.
import { MISSIONS } from './config.js';

export function createMissions() {
  const state = {
    active: 0, // index into MISSIONS, or -1 when the chain is done and free
    stage: 0,
    stageTime: 0,
    missionTime: 0,
    loseTimer: 0,
    started: false,
    unlocked: 1, // how many missions are open (1 = M1)
    ratings: {}, // mission id -> 'GOLD' | 'SILVER' | 'BRONZE'
    completed: [],
    title: '',
    dialog: null, // { speaker, line } — the line the HUD shows right now
    dialogTimer: 0,
  };

  function current() {
    return state.active >= 0 ? MISSIONS[state.active] : null;
  }

  function currentStage() {
    const m = current();
    return m ? m.stages[state.stage] : null;
  }

  function say(speaker, line) {
    state.dialog = { speaker, line };
    state.dialogTimer = 6;
  }

  function startMission(index, api) {
    state.active = index;
    state.stage = 0;
    state.stageTime = 0;
    state.missionTime = 0;
    state.loseTimer = 0;
    state.started = true;
    const m = MISSIONS[index];
    say('DANTE', m.brief.replace(/^DANTE: "/, '').replace(/"$/, ''));
    api.events.push({ type: 'mission-start', id: m.id, name: m.name });
    if (m.id === 'M3') {
      api.markVan();
      say('DANTE', 'Gold van, downtown. Find it and stay on it.');
    }
    if (m.id === 'M4') {
      api.setWanted(3);
      api.spawnEnemies();
      say('DANTE', 'It\'s a trap. Lose them — then bring it home.');
    }
  }

  function failMission(api, reason) {
    const m = current();
    if (!m) return;
    api.events.push({ type: 'mission-fail', id: m.id, reason });
    say('DANTE', reason === 'busted' ? 'Picked up? Start it over, Rio.' : 'You lost it. Again, from the top.');
    startMission(state.active, api);
  }

  function completeStage(api) {
    const m = current();
    if (!m) return;
    state.stage += 1;
    state.stageTime = 0;
    state.loseTimer = 0;
    if (state.stage < m.stages.length) {
      api.events.push({ type: 'stage-complete', id: m.id, stage: state.stage });
      say('SANA', m.id === 'M2' && state.stage === 1 ? 'Package is yours. Marina, quick.' : 'Stage done. Next.');
      if (m.id === 'M4' && state.stage === 1) say('DANTE', 'Clean. Now run — two minutes to the pier.');
    } else {
      completeMission(api);
    }
  }

  function completeMission(api) {
    const m = current();
    const time = state.missionTime;
    const rating = time <= m.par ? 'GOLD' : time <= m.par * 1.4 ? 'SILVER' : 'BRONZE';
    state.ratings[m.id] = rating;
    state.completed.push(m.id);
    api.addCash(m.reward);
    if (m.title) state.title = m.title;
    state.unlocked = Math.max(state.unlocked, Math.min(MISSIONS.length, state.active + 2));
    api.events.push({ type: 'mission-complete', id: m.id, name: m.name, reward: m.reward, rating, time });
    say('DANTE', m.id === 'M4' ? 'Debt paid, Wheelman. Solmarina is yours tonight.' : 'Good. Next job when you\'re ready.');
    if (m.id === 'M3') api.unmarkVan();
    const next = state.active + 1;
    if (next < MISSIONS.length && next < state.unlocked) startMission(next, api);
    else {
      state.active = -1;
      state.started = false;
      api.events.push({ type: 'chain-complete' });
    }
  }

  /** One fixed step. `api` is the world: positions, wanted, van, cash, events. */
  function step(dt, api) {
    if (state.dialogTimer > 0) {
      state.dialogTimer -= dt;
      if (state.dialogTimer <= 0) state.dialog = null;
    }
    const m = current();
    if (!m) return;
    const stage = currentStage();
    state.stageTime += dt;
    state.missionTime += dt;

    const px = api.playerX();
    const pz = api.playerZ();
    const mode = api.playerMode();

    if (stage.wantedZero) {
      if (api.wanted() === 0) completeStage(api);
      return;
    }
    if (stage.vanDist !== undefined) {
      const van = api.van();
      if (!van) { failMission(api, 'lost'); return; }
      const d = Math.hypot(van.x - px, van.z - pz);
      if (state.stage === 0) {
        if (d < stage.vanDist) completeStage(api);
      } else {
        const arrived = Math.hypot(van.x - 254, van.z - 98) < 15;
        if (arrived) { completeStage(api); return; }
        if (d > stage.vanDist) {
          state.loseTimer += dt;
          if (state.loseTimer > (stage.loseSeconds || 5)) { failMission(api, 'lost'); return; }
        } else {
          state.loseTimer = 0;
        }
      }
      return;
    }
    if (stage.timeLimit !== undefined && state.stageTime > stage.timeLimit) {
      failMission(api, 'timeout');
      return;
    }
    if (stage.footOnly && mode !== 'foot') {
      // The stage cannot complete from the car — the HUD hints the player to walk.
      return;
    }
    const d = Math.hypot(stage.x - px, stage.z - pz);
    if (d < stage.radius) completeStage(api);
  }

  /** Distance and label for the HUD banner and the minimap diamond. */
  function objective(api) {
    const m = current();
    if (!m) return { text: 'FREE ROAM — Solmarina is yours', x: 400, z: -6, dist: 0 };
    const stage = currentStage();
    const px = api.playerX();
    const pz = api.playerZ();
    if (stage.vanDist !== undefined) {
      const van = api.van();
      const d = van ? Math.hypot(van.x - px, van.z - pz) : 0;
      return { text: stage.text, x: van ? van.x : 0, z: van ? van.z : 0, dist: d, van: true };
    }
    if (stage.wantedZero) {
      return { text: stage.text, x: px, z: pz, dist: 0, wanted: api.wanted() };
    }
    return { text: stage.text, x: stage.x, z: stage.z, dist: Math.hypot(stage.x - px, stage.z - pz) };
  }

  function reset() {
    state.active = 0;
    state.stage = 0;
    state.stageTime = 0;
    state.missionTime = 0;
    state.loseTimer = 0;
    state.started = false;
    state.unlocked = 1;
    state.ratings = {};
    state.completed = [];
    state.title = '';
    state.dialog = null;
    state.dialogTimer = 0;
  }

  return {
    state, current, currentStage, startMission, failMission, step, objective, reset,
    start(api) {
      if (!state.started) startMission(0, api);
    },
  };
}
