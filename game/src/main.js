// Boot and the one loop: input is read every frame, the world advances in fixed 1/60 s
// steps (several in a slow frame, none in a fast one), and the renderer paints what is
// there. The game moves between three screens: title, play and paused.
//
// ?seed=N fixes the city and the staged scenes. ?shot=start|play|end|cover (with
// &seed=N) stages that scene instead of running the loop, paints it twice and sets
// window.__shotReady for a screenshot. window.__solmarina exposes the live state
// (mode, speed, position, wanted, cash, objective) for automated play tests, plus the
// scene and a few diagnostics (render info, city visibility, flat materials) used to
// hunt the headless frame-rate bottleneck in Phase 1 — the shipped game never calls them.
//
// Batch 1 (v3.7-sharp): ?aa=0 turns antialiasing off for A/B capture tests
// (default ON); ?pr=2 renders at 2x for a supersampled screenshot. After the
// renderer exists, every procedural texture in the city gets anisotropy at the
// GPU's capability (capped at 8) — the blur diagnosis proved the road texture
// collapsed to flat colour at the chase camera's grazing angle because
// anisotropy was never set.
//
// Phase 3: the world takes the same seed, so its traffic and police replay
// identically; window.__solmarina also exposes the world itself (live counts,
// police modes, test hooks) for automated play tests.
import * as THREE from 'three';
import { DEFAULT_SEED, STEP } from './config.js';
import { createRandom } from './random.js';
import { buildCity } from './city.js';
import { createWorld, EVENT_BUST, EVENT_HIT } from './world.js';
import { ACTION_CONFIRM, ACTION_ENTER, ACTION_PAUSE, createInput } from './input.js';
import { createRenderer, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { createHud, loadBest, saveBest } from './hud.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : DEFAULT_SEED;

const canvas = document.getElementById('game');
const status = document.getElementById('status');

const city = buildCity(THREE, createRandom(seed));
const world = createWorld(city, seed);
const hud = createHud(city.map);
const renderer = createRenderer(canvas, hud, { antialias: params.get('aa') !== '0' });
renderer.scene.add(city.group);
// Batch 1 (v3.7-sharp): anisotropic filtering at the GPU's capability
// (capped at 8) on every procedural texture in the city — canvasTexture()
// already defaults to 8 at creation; this sets the exact supported value
// before the first frame uploads the textures.
{
  const maxAniso = Math.min(renderer.maxAnisotropy(), 8);
  city.group.traverse((object) => {
    if (!object.isMesh) return;
    const mats = Array.isArray(object.material) ? object.material : [object.material];
    for (const mat of mats) {
      if (mat && mat.map) {
        mat.map.anisotropy = maxAniso;
        mat.map.needsUpdate = true;
      }
    }
  });
}
// Capture tests only: ?pr=2 renders at 2x for a supersampled screenshot.
if (params.get('pr') === '2') renderer.setPixelRatio(2);

// Distance driven this session (metres), for the pause screen and the best-run record.
let distanceDriven = 0;

window.__solmarina = {
  get state() {
    return {
      mode: world.state.mode,
      speed: world.state.car.speed,
      carX: world.state.car.x,
      carZ: world.state.car.z,
      carHeading: world.state.car.heading,
      playerX: world.state.player.x,
      playerZ: world.state.player.z,
      time: world.state.time,
      wanted: world.state.wanted,
      cash: world.state.cash,
      health: world.state.health,
      objective: world.state.objective.text,
      extras: world.state.extras.length,
      buildings: city.buildingCount,
      palms: city.palmCount,
      // Phase 3: the live city — counts, police modes, nearest cruiser, busts.
      trafficCount: world.state.traffic.length,
      pedCount: world.state.peds.length,
      policeCount: world.state.police.length,
      policeModes: world.state.police.map((p) => p.mode),
      nearestPolice: (() => {
        let best = null;
        for (const p of world.state.police) {
          const d = Math.hypot(p.x - world.state.car.x, p.z - world.state.car.z);
          if (!best || d < best.distance) best = { distance: d, mode: p.mode, hasLos: p.hasLos };
        }
        return best;
      })(),
      busted: world.state.busted,
      crimes: world.state.crimes,
    };
  },
  /** Distance driven and time played this session, for the pause screen and saves. */
  get stats() {
    return { distance: distanceDriven, time: world.state.time, cash: world.state.cash };
  },
  /** The live three.js scene, for automated play tests. */
  scene: renderer.scene,
  /** The world (state, step, debug hooks) for automated play tests. */
  world,
  /** Draw calls and triangles of the last rendered frame. */
  get renderInfo() {
    return renderer.info();
  },
  /** The GPU's anisotropy ceiling (Batch 1 verification). */
  get maxAnisotropy() {
    return renderer.maxAnisotropy();
  },
  /** Whether this WebGL context actually got antialiasing (Batch 1). */
  get antialias() {
    return renderer.antialias();
  },
  /** Test-only scene switches for the frame-rate investigation (Phase 1). */
  diagnostics: {
    hideCity(hidden) {
      city.group.visible = !hidden;
    },
    basicMaterials() {
      // Flat colours everywhere: drops the per-fragment lighting cost, so the
      // probe can tell lighting apart from geometry and fill rate.
      renderer.scene.traverse((object) => {
        if (object.isMesh && object.material && object.material.isMeshLambertMaterial) {
          object.material = new THREE.MeshBasicMaterial({ color: object.material.color });
        }
      });
    },
    setFog(on) {
      renderer.setFog(on);
    },
    hideClutter(hidden) {
      // The flat ground layers: roads, lane dashes, crosswalk stripes, sidewalks.
      renderer.scene.traverse((object) => {
        if (object.isMesh && ['roads', 'dashes', 'crosswalks', 'sidewalks'].includes(object.name)) {
          object.visible = !hidden;
        }
      });
    },
  },
};

function runShot(name) {
  const scene = stageShot(name, world);
  // Snap the chase camera to its framing first: the live camera only eases there
  // over many frames, and a staged shot paints two.
  renderer.snap(world.state, scene.screen);
  let painted = 0;
  function paint() {
    renderer.draw(world.state, scene.screen, 1 / 60);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let accumulator = 0;
  let last = performance.now();

  // Screen readers (and anyone watching the page's text) hear the screen changes.
  function announce(message) {
    status.textContent = message;
  }

  function startGame(fresh) {
    world.reset();
    distanceDriven = 0;
    if (!fresh) {
      // CONTINUE: Rio keeps the cash he banked in the best-run record.
      const best = loadBest();
      if (best) world.state.cash = best.cash;
    }
    accumulator = 0;
    screen = SCREEN_PLAY;
    hud.hideOverlays();
    announce('Playing. Drive with W A S D. Press E to leave the car.');
  }

  function pauseGame() {
    screen = SCREEN_PAUSED;
    hud.showPause({ cash: world.state.cash, distance: distanceDriven, time: world.state.time, wanted: world.state.wanted });
    announce('Paused.');
  }

  hud.onStart((fresh) => {
    if (screen === SCREEN_TITLE) startGame(fresh);
  });

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    const actions = input.takeActions();
    if (actions & ACTION_CONFIRM && screen === SCREEN_TITLE) startGame(true);
    else if (actions & ACTION_PAUSE && screen === SCREEN_PLAY) {
      pauseGame();
    } else if (actions & (ACTION_PAUSE | ACTION_CONFIRM) && screen === SCREEN_PAUSED) {
      screen = SCREEN_PLAY;
      hud.hideOverlays();
      announce('Playing.');
    }
    if (screen === SCREEN_PLAY) {
      accumulator += dt;
      let enterPending = Boolean(actions & ACTION_ENTER);
      while (accumulator >= STEP) {
        const held = input.read();
        // Enter/exit is a one-shot edge: it fires on the first step only.
        held.enter = enterPending;
        enterPending = false;
        const events = world.step(STEP, held, renderer.cameraYaw());
        if (world.state.mode === 'car') distanceDriven += Math.abs(world.state.car.speed) * STEP;
        if (events & EVENT_HIT) announce('Hit.');
        if (events & EVENT_BUST) announce('Busted. Cash lost.');
        accumulator -= STEP;
      }
    }
    renderer.draw(world.state, screen, dt);
  }

  // Leaving the tab pauses a running game rather than letting the car drive unseen,
  // and banks the session's cash in the best-run record.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      pauseGame();
    }
    if (document.hidden) {
      saveBest({ cash: world.state.cash, distance: distanceDriven, time: world.state.time });
    }
  });
  window.addEventListener('beforeunload', () => {
    saveBest({ cash: world.state.cash, distance: distanceDriven, time: world.state.time });
  });

  hud.showTitle(loadBest());
  announce('Solmarina. Press Enter to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
