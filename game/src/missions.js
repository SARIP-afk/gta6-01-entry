// Phase 4 — story missions: the chain Rio runs to pay off his debt to DANTE.
// Pure rules, no browser, no THREE, no drawing: the data for all four named
// missions plus a small state machine that watches the world state and fires
// stage/mission events. Only the game clock (state.time) drives it — never
// Math.random() or Date.now() — so the same seed replays the same missions.
//
// P4-1: only M1 FIRST DROP is playable. M2–M4 are data (names, story, stages,
// rewards, par times) so the chain reads whole in the dossier; their stage
// triggers are wired in their own steps (P4-2 M2, P4-3 M4, P4-4 M3). The
// state machine already knows the generic stage kinds: 'point' (reach a spot),
// 'lose-wanted' (wanted back to 0) and timed stages (timeLimit); the 'tail'
// kind (follow a moving van) is data-only until P4-4 builds the marked van.
import { HUD } from './config.js';

// Highest mission index playable in this step. P4-1: M1 only (index 0).
// P4-2 raises this as each mission's wiring lands.
const MAX_PLAYABLE_INDEX = 0;

// Par times are seconds from mission start to mission complete. M1's par is
// measured from the waypoint driver that proves the mission (see
// P4-1-VERIFY.md): the driver finishes in 68.8 s, so par 75 s is a fair gold
// for a player who drives the route cleanly. Silver is par x 1.5.
export const MISSIONS = [
  {
    id: 'M1',
    name: 'FIRST DROP',
    reward: 500,
    parSeconds: 75,
    briefing: 'DANTE: "One package. Pier. Don\'t keep me waiting."',
    completeDialog: 'DANTE: "Clean drop, Rio. Five hundred — and there is more where that came from."',
    stages: [
      {
        name: 'PICK UP',
        text: 'PICK UP THE PACKAGE',
        kind: 'point',
        x: -58,
        z: -162,
        radius: 10,
        mode: 'any',
        timeLimit: null,
        dialog: 'DANTE: "Package is downtown, corner of 58th. Grab it."',
      },
      {
        name: 'DELIVER',
        text: 'DELIVER TO THE PIER',
        kind: 'point',
        x: 400,
        z: -6,
        radius: HUD.completeRadiusMetres,
        mode: 'any',
        timeLimit: null,
        dialog: 'DANTE: "Good. Now bring it home to the pier."',
      },
    ],
  },
  {
    id: 'M2',
    name: 'THE HANDOFF',
    reward: 800,
    parSeconds: 150,
    briefing: 'DANTE: "Sana waits at the stadium. On foot — she does not trust cars."',
    completeDialog: 'DANTE: "Eight hundred. Sana says you walk like you mean it."',
    stages: [
      {
        name: 'MEET SANA',
        text: 'MEET SANA AT THE STADIUM',
        kind: 'point',
        x: -162,
        z: 150,
        radius: 8,
        mode: 'foot',
        timeLimit: null,
        dialog: 'SANA: "You came on foot. Good. Take it — and do not open it."',
      },
      {
        name: 'DROP AT THE MARINA',
        text: 'DROP AT THE MARINA',
        kind: 'point',
        x: 254,
        z: 98,
        radius: 10,
        mode: 'any',
        timeLimit: null,
        dialog: 'DANTE: "Marina drop. Quiet streets, Rio."',
      },
    ],
  },
  {
    id: 'M3',
    name: 'TAIL THE VAN',
    reward: 1200,
    parSeconds: 240,
    briefing: 'DANTE: "Follow my van to the marina. Do not lose it."',
    completeDialog: 'DANTE: "You have patience, Rio. Twelve hundred — well tailed."',
    stages: [
      {
        name: 'FIND THE VAN',
        text: "FIND DANTE'S VAN",
        kind: 'tail',
        x: -58,
        z: -162,
        radius: 40,
        mode: 'any',
        timeLimit: null,
        dialog: 'DANTE: "The gold van. Stay close, stay quiet."',
      },
      {
        name: 'STAY ON IT',
        text: 'STAY ON THE VAN',
        kind: 'tail',
        x: 254,
        z: 98,
        radius: 15,
        mode: 'any',
        failDistance: 80,
        failSeconds: 5,
        timeLimit: null,
        dialog: 'DANTE: "Eyes on the van. Lose it and we are done."',
      },
    ],
  },
  {
    id: 'M4',
    name: 'LOSE THE HEAT',
    reward: 2000,
    parSeconds: 240,
    briefing: 'DANTE: "It\'s a trap. Lose them — then bring it home."',
    completeDialog: 'DANTE: "WHEELMAN. The debt is paid, Rio — the city is yours now."',
    stages: [
      {
        name: 'LOSE THEM',
        text: 'LOSE THE COPS',
        kind: 'lose-wanted',
        x: null,
        z: null,
        radius: 0,
        mode: 'any',
        startWanted: 3,
        timeLimit: null,
        dialog: 'DANTE: "Three stars and closing. Vanish, Rio."',
      },
      {
        name: 'RUN TO THE PIER',
        text: 'RUN TO THE PIER',
        kind: 'point',
        x: 400,
        z: -6,
        radius: HUD.completeRadiusMetres,
        mode: 'any',
        timeLimit: 120,
        dialog: 'DANTE: "Two minutes. The pier — go!"',
      },
    ],
  },
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function distTo(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
}

function rateFor(elapsed, parSeconds) {
  if (elapsed <= parSeconds) return 'GOLD';
  if (elapsed <= parSeconds * 1.5) return 'SILVER';
  return 'BRONZE';
}

export function createMissions() {
  const state = {
    unlocked: 1,
    completed: 0,
    current: 0,
    stage: 0,
    status: 'active',
    missionStartTime: 0,
    stageStartTime: 0,
    stageStartDist: 0,
    stageTime: 0,
    failTimer: 0,
    eventSeq: 0,
    event: null,
    rating: null,
    title: null,
    // Display fields the HUD reads directly (kept in step with the machine).
    missionId: 'M1',
    missionName: 'FIRST DROP',
    stageCount: 2,
    stageName: 'PICK UP',
    stageText: 'PICK UP THE PACKAGE',
    targetX: -58,
    targetZ: -162,
    targetRadius: 10,
    timeLimit: null,
    timeLeft: null,
  };

  function mission() {
    return MISSIONS[state.current];
  }

  function stageDef() {
    return mission().stages[state.stage];
  }

  function emit(kind, fields) {
    state.eventSeq += 1;
    state.event = { seq: state.eventSeq, kind, time: state.stageTime, ...fields };
  }

  function syncDisplay() {
    const m = mission();
    const s = stageDef();
    state.missionId = m.id;
    state.missionName = m.name;
    state.stageCount = m.stages.length;
    state.stageName = s.name;
    state.stageText = s.text;
    state.targetX = s.x;
    state.targetZ = s.z;
    state.targetRadius = s.radius;
    state.timeLimit = s.timeLimit;
  }

  function enterStage(time, pos, api) {
    const s = stageDef();
    state.stageStartTime = time;
    state.stageTime = 0;
    state.failTimer = 0;
    state.timeLeft = s.timeLimit;
    if (s.x !== null && s.z !== null && pos) {
      state.stageStartDist = distTo(pos.x, pos.z, s.x, s.z);
    } else {
      state.stageStartDist = 0;
    }
    if (typeof s.startWanted === 'number') api.setWanted(s.startWanted);
    if (s.x !== null && s.z !== null) api.setObjective(s.text, s.x, s.z);
    syncDisplay();
  }

  function restartFromStageOne(time, pos, api, kind, text) {
    state.stage = 0;
    state.status = 'active';
    state.missionStartTime = time;
    enterStage(time, pos, api);
    emit(kind, { text, dialog: 'DANTE: "Again. Same package, same pier."', reward: 0, rating: null });
  }

  function advance(time, pos, api) {
    const m = mission();
    const s = stageDef();
    if (state.stage + 1 < m.stages.length) {
      state.stage += 1;
      enterStage(time, pos, api);
      const next = stageDef();
      emit('stage', {
        text: 'STAGE COMPLETE',
        dialog: next.dialog,
        reward: 0,
        rating: null,
        stageName: s.name,
        nextStage: next.text,
      });
      return;
    }
    // Last stage: the mission is done. Reward, unlock the next, rate the run.
    const elapsed = time - state.missionStartTime;
    const rating = rateFor(elapsed, m.parSeconds);
    state.rating = rating;
    state.status = 'complete';
    state.completed += 1;
    if (m.id === 'M4') state.title = 'WHEELMAN';
    state.unlocked = clamp(Math.max(state.unlocked, state.current + 2), 1, MISSIONS.length);
    api.grantReward(m.reward);
    api.saveProgress(state.unlocked, state.completed, state.title);
    emit('complete', {
      text: 'MISSION COMPLETE',
      dialog: m.completeDialog,
      reward: m.reward,
      rating,
      elapsed: Math.round(elapsed * 10) / 10,
    });
  }

  function reset(progress, time, pos, api) {
    const p = progress ?? { unlocked: 1, completed: 0, title: null };
    state.unlocked = clamp(p.unlocked ?? 1, 1, MISSIONS.length);
    state.completed = clamp(p.completed ?? 0, 0, MISSIONS.length);
    state.title = typeof p.title === 'string' ? p.title : null;
    // P4-1: only M1 is playable, so a reset always starts M1 even when M2
    // is already unlocked in storage. P4-2 lifts the cap to the highest
    // unlocked mission once M2's wiring lands.
    state.current = Math.min(state.unlocked - 1, MAX_PLAYABLE_INDEX);
    state.stage = 0;
    state.status = 'active';
    state.missionStartTime = time;
    state.rating = null;
    state.eventSeq = 0;
    state.event = null;
    enterStage(time, pos, api);
    emit('briefing', {
      text: 'MISSION BRIEFING',
      dialog: mission().briefing,
      reward: 0,
      rating: null,
    });
  }

  function onBust(time, pos, api) {
    if (state.status === 'complete') return;
    // Busted: the mission restarts from stage 1. Progress already banked
    // (the next mission staying unlocked) survives; cash follows doBust,
    // which zeroes it — the reward money is lost with the rest.
    restartFromStageOne(time, pos, api, 'failed', 'BUSTED — MISSION RESTARTED');
  }

  function step(dt, s, api) {
    state.stageTime = s.time - state.stageStartTime;
    if (state.status !== 'active') return;
    const m = mission();
    const st = stageDef();
    // Timed stage: the clock running out fails the mission back to stage 1.
    if (st.timeLimit !== null) {
      state.timeLeft = Math.max(0, st.timeLimit - state.stageTime);
      if (state.stageTime > st.timeLimit) {
        restartFromStageOne(s.time, activePos(s), api, 'failed', 'OUT OF TIME — MISSION RESTARTED');
        return;
      }
    } else {
      state.timeLeft = null;
    }
    // Stage completion, by kind.
    let done = false;
    if (st.kind === 'lose-wanted') {
      done = s.wanted === 0;
    } else if (st.kind === 'tail') {
      // P4-4: the marked van does not exist yet, so a tail stage can never
      // complete here. M3 is data-only in P4-1 and never becomes current.
      done = false;
    } else {
      // 'point': reach the spot. A foot-only stage does not complete
      // from the car — the player must get out and walk.
      const pos = activePos(s);
      if (st.mode !== 'foot' || s.mode === 'foot') {
        done = distTo(pos.x, pos.z, st.x, st.z) <= st.radius;
      }
    }
    if (done) advance(s.time, activePos(s), api);
    void m;
    void dt;
  }

  function activePos(s) {
    return s.mode === 'foot' ? s.player : s.car;
  }

  return { state, reset, step, onBust, mission, stageDef };
}
