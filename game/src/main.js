// Boot and the one loop: input is read every frame, the world advances in fixed
// 1/60 s steps, the renderer paints what is there, the HUD reads the same state.
// Screens: title, play, paused. ?seed=N fixes the city; ?shot=cover|start|play|end|stats|chase
// (with &seed=N) stages that scene instead of running the loop, paints it twice
// and sets window.__shotReady for a screenshot.
import { BEST_KEY, DISTRICTS, MISSIONS, STEP } from './config.js';
import { createRandom } from './random.js';
import { createWorld } from './world.js';
import { districtDisplayAt } from './city.js';
import { ACTION_CONFIRM, ACTION_CREW_1, ACTION_CREW_2, ACTION_CREW_3, ACTION_ENTER, ACTION_HOLSTER, ACTION_MAP, ACTION_PAUSE, ACTION_RADIO, ACTION_RELOAD, ACTION_WEAPON_1, ACTION_WEAPON_2, ACTION_WEAPON_3, ACTION_WEAPON_4, createInput } from './input.js';
import { createRenderer, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { createHud } from './hud.js';
import { createRadio } from './radio.js';
import { loadSettings, saveSettings } from './settings.js';
import { listSlots, loadSlot, saveSlot } from './save.js';
import { stageShot } from './shots.js';

const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 1;
// Test hook only: ?paint=N caps the staged-shot paint loop at N frames
// (default 120). Same fixed count every run, so a shot stays deterministic;
// it only shortens the settle wait on slow software renderers.
const paintParam = Number.parseInt(params.get('paint') ?? '', 10);
const PAINT_FRAMES = Number.isInteger(paintParam) && paintParam >= 1 && paintParam <= 120 ? paintParam : 120;

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(createRandom(seed));
window.__world = world;
const renderer = createRenderer(canvas, world.state.city);
window.__renderer = renderer;
const radio = createRadio();
const settings = loadSettings();
radio.setVolume(settings.volume);
renderer.setQuality(settings.quality);
// Session-only override: ?quality=low|med|high|auto applies for this load
// without being saved — the verify drivers pin a tier with it.
const qualityParam = params.get('quality');
if (qualityParam && ['auto', 'low', 'med', 'high'].includes(qualityParam)) {
  renderer.setQuality(qualityParam);
}

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

function enrichState() {
  const s = world.state;
  const px = s.player.mode === 'car' ? s.heroCar.x : s.player.x;
  const pz = s.player.mode === 'car' ? s.heroCar.z : s.player.z;
  s.completionPct = world.completion();
  // Display district: MARINA wins its overlap with FOUNDRY in the HUD label
  // (see districtDisplayAt) — the sim's own district stays districtAt.
  s.districtIndex = districtDisplayAt(px, pz);
  s.missionsList = missionsList();
  return s;
}

function runShot(name) {
  const scene = stageShot(name, world);
  enrichState();
  // The cover pulls the camera back and low behind the hero on the coastal
  // road: towers flank the road to the west, the beach is in the foreground,
  // and the marina, the pier and the sun sit up the road to the north, the
  // way the v3.1 staging framed it — the camera stays on the road centreline
  // (side 0): any lateral offset puts it inside the roadside towers. The
  // close v4.3 follow (10.5 m, not v3.1's 44 m) is kept on purpose: at 44 m
  // the hero shrank to a speck and the DANTE dialog covered him, the exact
  // defects syarif flagged on the v3.1 cover. The camera sits far enough
  // back and low that the whole hero car — roof to wheels — lands above the
  // weapon panel at the bottom right, so no pixel of the hero is ever hidden
  // behind the HUD.
  if (name === 'cover') renderer.setFollow(10.5, 2.8);
  // The chase shot pulls the camera in close behind the hero and pitches it
  // up at the sky, so the hero fills the frame and the helicopter body lands
  // big in it too — the v4.7 pull-back (36 m) shrank both to specks.
  if (name === 'chase') renderer.setFollow(13, 3.0, 2.0, 8.0);
  // The HUD is DOM, so a shot without it would show a bare city: build it too.
  const shotHud = createHud({
    onStart() {}, onSlot() {}, onSave() {}, onResume() {}, onRestart() {},
    onContinue() {}, onVolume() {}, onQuality() {},
  });
  if (name === 'start') {
    shotHud.fillTitle(listSlots(), readBest(), settings);
    shotHud.showScreen('title');
  } else if (name === 'stats') {
    shotHud.fillPause(pauseState(), listSlots(), settings);
    shotHud.setPauseTab('stats');
    shotHud.showScreen('paused');
  } else {
    shotHud.showScreen('play');
    // Radio is on in the play shots: the bottom bar names the station, it never
    // sits on RADIO OFF while the city is alive.
    document.getElementById('radio').textContent = '♪ SOL 98.1 — COAST FM';
  }
  let painted = 0;
  let ledger = null;
  const t0 = performance.now();
  const hudScreen = name === 'stats' ? SCREEN_PAUSED : scene.screen;
  function paint() {
    ledger = renderer.draw(world.state, scene.screen, world.state.time);
    shotHud.update(world.state, hudScreen, ledger, renderer.project, world.state.time);
    painted += 1;
    // Keep painting: the follow camera needs frames to settle behind the car.
    // Ready after exactly PAINT_FRAMES frames — no wall-clock cutoff, so a
    // slow software renderer settles to the same frame as a fast one
    // (deterministic shots). The 600 s bound is only a hang guard: at ~2 s
    // per SwiftShader frame, 120 frames need ~240 s, and the bound must
    // never decide how many frames a shot paints (v4.6's 30 s bound did —
    // it cut 1080p shots short and cost 3 pixels of determinism).
    if (painted < PAINT_FRAMES && performance.now() - t0 < 600000) requestAnimationFrame(paint);
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
    onContinue: (i) => startGame(loadSlot(i)),
    onVolume: (v) => {
      settings.volume = v;
      radio.setVolume(v);
      saveSettings(settings);
    },
    onQuality: (q) => {
      settings.quality = q;
      renderer.setQuality(q);
      saveSettings(settings);
    },
    onSave: (i) => {
      saveSlot(i, world.snapshot());
      hud.fillPause(pauseState(), listSlots(), settings);
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
  // One-shot presses (enter, reload, weapon, crew, holster) are latched here
  // until a fixed step actually consumes them. A press used to be dropped
  // whenever the frame's accumulator held less than one step — the reason a
  // quick E at the car sometimes did nothing at all.
  let pendingEnter = false;
  let pendingReload = false;
  let pendingHolster = false;
  let pendingWeapon = -1;
  let pendingCrew = -1;
  let prevArrowL = false;
  let prevArrowR = false;

  function announce(message) {
    status.textContent = message;
  }

  function startGame(slot) {
    world.reset(seed);
    if (slot) world.applySnapshot(slot);
    accumulator = 0;
    pendingEnter = false;
    pendingReload = false;
    pendingHolster = false;
    pendingWeapon = -1;
    pendingCrew = -1;
    screen = SCREEN_PLAY;
    hud.closeBigMap();
    hud.showScreen('play');
    announce('Playing. Follow the gold diamond — M1 First Drop.');
  }

  function openPause(tab) {
    screen = SCREEN_PAUSED;
    hud.fillPause(pauseState(), listSlots(), settings);
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
      holster: false,
      weaponSelect: -1,
      crewUse: -1,
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

  // FPS guard (AUTO mode only): if the live game sustains under 22 fps for
  // 5 straight seconds, step the effective tier down one notch (high->med->
  // low) and say so in the feed. One-way, never back up, and never silent:
  // quality must be stable, not oscillating like a dynamic-resolution
  // scaler. Manual tiers are never touched, staged shots never run this
  // loop, and the sim never sees it — only the render scale changes.
  // The stored 'auto' choice is untouched (setEffective, not setQuality).
  let fpsWindowStart = 0;
  let fpsFrames = 0;
  let fpsLowSeconds = 0;
  let fpsGuardTier = null;

  function frame(now) {
    requestAnimationFrame(frame);
    if (settings.quality === 'auto') {
      if (!fpsWindowStart) fpsWindowStart = now;
      fpsFrames += 1;
      if (now - fpsWindowStart >= 1000) {
        const fps = (fpsFrames * 1000) / (now - fpsWindowStart);
        fpsWindowStart = now;
        fpsFrames = 0;
        window.__fps = Math.round(fps * 10) / 10;
        const order = ['low', 'med', 'high'];
        const cur = fpsGuardTier || renderer.debugGL().effectiveQuality;
        if (fps < 22 && cur !== 'low') {
          fpsLowSeconds += 1;
          if (fpsLowSeconds >= 5) {
            fpsGuardTier = order[order.indexOf(cur) - 1];
            renderer.setEffective(fpsGuardTier);
            fpsLowSeconds = 0;
            hud.pushFeed(`GRAPHICS AUTO → ${fpsGuardTier.toUpperCase()} — LOW FPS`);
          }
        } else {
          fpsLowSeconds = 0;
        }
        window.__quality = { stored: settings.quality, effective: renderer.debugGL().effectiveQuality, fps: window.__fps, guardTier: fpsGuardTier };
      }
    }
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    const actions = input.takeActions();
    // Esc with the full-city map open closes the map instead of pausing.
    if (hud.bigMapOpen() && (actions & ACTION_PAUSE)) {
      hud.closeBigMap();
    } else if (screen === SCREEN_TITLE && (actions & ACTION_CONFIRM)) startGame(null);
    else if (screen === SCREEN_PLAY && (actions & ACTION_PAUSE)) openPause('map');
    else if (screen === SCREEN_PLAY && (actions & ACTION_MAP)) openPause('map');
    else if (screen === SCREEN_PAUSED && (actions & (ACTION_PAUSE | ACTION_CONFIRM))) {
      screen = SCREEN_PLAY;
      hud.showScreen('play');
    } else if (screen === SCREEN_PAUSED && (actions & ACTION_HOLSTER)) {
      hud.nextTab();
    } else if (screen === SCREEN_PAUSED && (actions & ACTION_ENTER)) {
      hud.prevTab();
    }
    if (actions & ACTION_RADIO) {
      const st = radio.next();
      document.getElementById('radio').textContent = st ? `♪ ${st.name}` : 'RADIO OFF';
    }
    if (screen === SCREEN_PAUSED) {
      // Arrow keys also flip pause tabs (edge-triggered, so holding does not spin).
      const heldL = input.held.has('ArrowLeft');
      const heldR = input.held.has('ArrowRight');
      if (heldR && !prevArrowR) hud.nextTab();
      if (heldL && !prevArrowL) hud.prevTab();
      prevArrowL = heldL;
      prevArrowR = heldR;
    }
    // Latch one-shots until a step consumes them — never drop a press.
    // Only while playing: the same keys flip pause tabs while paused.
    if (screen === SCREEN_PLAY) {
      if (actions & ACTION_ENTER) pendingEnter = true;
      if (actions & ACTION_RELOAD) pendingReload = true;
      if (actions & ACTION_HOLSTER) pendingHolster = true;
      if (actions & ACTION_WEAPON_1) pendingWeapon = 0;
      else if (actions & ACTION_WEAPON_2) pendingWeapon = 1;
      else if (actions & ACTION_WEAPON_3) pendingWeapon = 2;
      else if (actions & ACTION_WEAPON_4) pendingWeapon = 3;
      if (actions & ACTION_CREW_1) pendingCrew = 0;
      else if (actions & ACTION_CREW_2) pendingCrew = 1;
      else if (actions & ACTION_CREW_3) pendingCrew = 2;
    }
    if (screen === SCREEN_PLAY) {
      const inputState = buildInput();
      inputState.enter = pendingEnter;
      inputState.reload = pendingReload;
      inputState.holster = pendingHolster;
      inputState.weaponSelect = pendingWeapon;
      inputState.crewUse = pendingCrew;
      let first = true;
      while (accumulator >= STEP) {
        step(inputState);
        accumulator -= STEP;
        if (first) {
          first = false;
          pendingEnter = false;
          pendingReload = false;
          pendingHolster = false;
          pendingWeapon = -1;
          pendingCrew = -1;
          inputState.enter = false;
          inputState.reload = false;
          inputState.holster = false;
          inputState.weaponSelect = -1;
          inputState.crewUse = -1;
        }
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

  hud.fillTitle(listSlots(), best, settings);
  hud.showScreen('title');
  announce('Solmarina. Press Space or click a save slot to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
