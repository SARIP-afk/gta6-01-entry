// Boot and the one loop: input is read every frame, the world advances in fixed
// 1/60 s steps, the renderer paints what is there, the HUD reads the same state.
// Screens: title, play, paused. ?seed=N fixes the city; ?shot=cover|start|play|end
// (with &seed=N) stages that scene instead of running the loop, paints it twice
// and sets window.__shotReady for a screenshot.
import { BEST_KEY, DISTRICTS, MISSIONS, STEP } from './config.js';
import { createRandom } from './random.js';
import { createWorld } from './world.js';
import { districtAt } from './city.js';
import { ACTION_CONFIRM, ACTION_CREW_1, ACTION_CREW_2, ACTION_CREW_3, ACTION_ENTER, ACTION_MAP, ACTION_PAUSE, ACTION_RADIO, ACTION_RELOAD, ACTION_WEAPON_1, ACTION_WEAPON_2, ACTION_WEAPON_3, ACTION_WEAPON_4, createInput } from './input.js';
import { createRenderer, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { createHud } from './hud.js';
import { createRadio } from './radio.js';
import { listSlots, loadSlot, saveSlot } from './save.js';
import { stageShot } from './shots.js';

const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 1;

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(createRandom(seed));
window.__world = world;
const renderer = createRenderer(canvas, world.state.city);
window.__renderer = renderer;
const radio = createRadio();

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off: the best cash then lasts this visit only.
  }
}

function missionsList() {
  const st = world.state.missions.state;
  return MISSIONS.map((m, i) => {
    let status = 'LOCKED';
    if (st.ratings[m.id]) status = `${st.ratings[m.id]} · $${m.reward}`;
    else if (i < st.unlocked) status = i === st.active ? 'ACTIVE' : 'OPEN';
    return { id: m.id, name: m.name, status };
  });
}

function enrichState() {
  const s = world.state;
  const px = s.player.mode === 'car' ? s.heroCar.x : s.player.x;
  const pz = s.player.mode === 'car' ? s.heroCar.z : s.player.z;
  s.completionPct = world.completion();
  s.districtIndex = districtAt(px, pz);
  s.missionsList = missionsList();
  return s;
}

function runShot(name) {
  const scene = stageShot(name, world);
  enrichState();
  // The cover pulls the camera back and low behind the hero on the avenue:
  // towers flank the road, the pier and the sea sit at the end of it, and the
  // hero car reads big in the middle of the road, the way the first build
  // framed it — the camera stays on the road centreline (side 0): any lateral
  // offset puts it inside the roadside towers. The camera sits far enough
  // back and low that the whole hero car — roof to wheels — lands above the
  // weapon panel at the bottom right, so no pixel of the hero is ever hidden
  // behind the HUD.
  if (name === 'cover') renderer.setFollow(10.5, 2.8);
  // The HUD is DOM, so a shot without it would show a bare city: build it too.
  const shotHud = createHud({ onStart() {}, onSlot() {}, onSave() {}, onResume() {}, onRestart() {} });
  if (name === 'start') {
    shotHud.fillTitle(listSlots(), readBest());
    shotHud.showScreen('title');
  } else {
    shotHud.showScreen('play');
    // Radio is on in the play shots: the bottom bar names the station, it never
    // sits on RADIO OFF while the city is alive.
    document.getElementById('radio').textContent = '♪ SOL 98.1 — COAST FM';
  }
  let painted = 0;
  let ledger = null;
  const t0 = performance.now();
  function paint() {
    ledger = renderer.draw(world.state, scene.screen, world.state.time);
    shotHud.update(world.state, scene.screen, ledger, renderer.project, world.state.time);
    painted += 1;
    // Keep painting: the follow camera needs frames to settle behind the car.
    // Ready after exactly 120 frames — no wall-clock cutoff, so a slow software
    // renderer settles to the same frame as a fast one (deterministic shots).
    if (painted < 120 && performance.now() - t0 < 30000) requestAnimationFrame(paint);
    else {
      window.__shotReady = true;
      window.__ledger = ledger;
      window.__traceHash = world.traceHash();
    }
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  const hud = createHud({
    onStart: () => startGame(null),
    onSlot: (i, slot) => startGame(slot ? loadSlot(i) : null),
    onSave: (i) => {
      saveSlot(i, world.snapshot());
      hud.fillPause(pauseState(), listSlots());
      hud.pushFeed(`SAVED TO SLOT ${i + 1}`);
    },
    onResume: () => {
      screen = SCREEN_PLAY;
      hud.showScreen('play');
    },
    onRestart: () => startGame(null),
  });
  let screen = SCREEN_TITLE;
  let best = readBest();
  let accumulator = 0;
  let last = performance.now();
  let ledger = null;

  function pauseState() {
    const s = world.state;
    return {
      completion: world.completion(),
      missionsDone: s.missions.state.completed.length,
      shells: s.shellsTaken,
      exports: s.exportsDone.length,
      distance: s.stats.distance,
      carsStolen: s.stats.carsStolen,
      copsEscaped: s.stats.copsEscaped,
      shots: s.stats.shots,
      cash: s.cash,
      missionsList: missionsList(),
      ratings: s.missions.state.ratings,
      standing: s.standing,
      districtNames: DISTRICTS.map((d) => d.name),
      rank: { xp: s.rank.state.xp, level: s.rank.state.level },
      crewUsed: s.crew.state.used,
      crewCooldowns: s.crew.state.cooldowns.slice(),
    };
  }

  function announce(message) {
    status.textContent = message;
  }

  function startGame(slot) {
    world.reset(seed);
    if (slot) world.applySnapshot(slot);
    accumulator = 0;
    screen = SCREEN_PLAY;
    hud.showScreen('play');
    announce('Playing. Follow the gold diamond — M1 First Drop.');
  }

  function openPause(tab) {
    screen = SCREEN_PAUSED;
    hud.fillPause(pauseState(), listSlots());
    hud.setPauseTab(tab);
    hud.showScreen('paused');
    announce('Paused.');
  }

  function buildInput() {
    const ax = input.axis();
    const yaw = renderer.cameraHeading();
    const f = ax.forward;
    const r = ax.right;
    const moveX = f * Math.cos(yaw) + r * Math.sin(yaw);
    const moveZ = -f * Math.sin(yaw) + r * Math.cos(yaw);
    let shootAngle = null;
    if (input.mouse.down && world.state.player.mode === 'foot') {
      const g = renderer.screenToGround(input.mouse.x, input.mouse.y);
      if (g) {
        const p = world.state.player;
        shootAngle = Math.atan2(-(g.z - p.z), g.x - p.x);
      }
    }
    return {
      moveX, moveZ,
      steer: -r,
      throttle: f,
      brake: input.brake(),
      boost: input.boost(),
      run: input.run(),
      enter: false,
      reload: false,
      shootAngle,
    };
  }

  function step(inputState) {
    world.step(STEP, inputState);
    if (world.state.cash > best) {
      best = world.state.cash;
      saveBest(best);
    }
    hud.drainEvents(world.state.events);
    window.__traceHash = world.traceHash();
    window.__ledger = ledger;
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    const actions = input.takeActions();
    if (screen === SCREEN_TITLE && (actions & ACTION_CONFIRM)) startGame(null);
    else if (screen === SCREEN_PLAY && (actions & ACTION_PAUSE)) openPause('map');
    else if (screen === SCREEN_PLAY && (actions & ACTION_MAP)) openPause('map');
    else if (screen === SCREEN_PAUSED && (actions & (ACTION_PAUSE | ACTION_CONFIRM))) {
      screen = SCREEN_PLAY;
      hud.showScreen('play');
    }
    if (actions & ACTION_RADIO) {
      const st = radio.next();
      document.getElementById('radio').textContent = st ? `♪ ${st.name}` : 'RADIO OFF';
    }
    if (screen === SCREEN_PLAY) {
      const inputState = buildInput();
      if (actions & ACTION_ENTER) inputState.enter = true;
      if (actions & ACTION_RELOAD) inputState.reload = true;
      if (actions & ACTION_WEAPON_1) inputState.weaponSelect = 0;
      else if (actions & ACTION_WEAPON_2) inputState.weaponSelect = 1;
      else if (actions & ACTION_WEAPON_3) inputState.weaponSelect = 2;
      else if (actions & ACTION_WEAPON_4) inputState.weaponSelect = 3;
      if (actions & ACTION_CREW_1) inputState.crewUse = 0;
      else if (actions & ACTION_CREW_2) inputState.crewUse = 1;
      else if (actions & ACTION_CREW_3) inputState.crewUse = 2;
      while (accumulator >= STEP) {
        step(inputState);
        accumulator -= STEP;
        inputState.enter = false;
        inputState.reload = false;
      }
    } else {
      accumulator = 0;
    }
    enrichState();
    ledger = renderer.draw(world.state, screen, world.state.time);
    hud.update(world.state, screen, ledger, renderer.project, world.state.time);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) openPause('map');
  });

  hud.fillTitle(listSlots(), best);
  hud.showScreen('title');
  announce('Solmarina. Press Space or click a save slot to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
