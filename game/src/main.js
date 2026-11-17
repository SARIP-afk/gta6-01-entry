// Boot and the one loop: input is read every frame, the world advances in fixed 1/60 s
// steps (several in a slow frame, none in a fast one), and the renderer paints what is
// there. The game moves between three screens: title, play and paused.
//
// ?seed=N fixes the city and the staged scenes. ?shot=start|play|end (with &seed=N)
// stages that scene instead of running the loop, paints it twice and sets
// window.__shotReady for a screenshot. window.__solmarina exposes the live state
// (mode, speed, position) for automated play tests, plus the scene and a few
// diagnostics (render info, city visibility, flat materials) used to hunt the
// headless frame-rate bottleneck in Phase 1 — the shipped game never calls them.
import * as THREE from 'three';
import { DEFAULT_SEED, STEP } from './config.js';
import { createRandom } from './random.js';
import { buildCity } from './city.js';
import { createWorld, EVENT_HIT } from './world.js';
import { ACTION_CONFIRM, ACTION_ENTER, ACTION_PAUSE, createInput } from './input.js';
import { createRenderer, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : DEFAULT_SEED;

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const hud = {
  speed: document.getElementById('hud-speed'),
  mode: document.getElementById('hud-mode'),
  hint: document.getElementById('hud-hint'),
};

const city = buildCity(THREE, createRandom(seed));
const world = createWorld(city);
const renderer = createRenderer(canvas, hud);
renderer.scene.add(city.group);

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
      buildings: city.buildingCount,
      palms: city.palmCount,
    };
  },
  /** The live three.js scene, for automated play tests. */
  scene: renderer.scene,
  /** Draw calls and triangles of the last rendered frame. */
  get renderInfo() {
    return renderer.info();
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

  function startGame() {
    world.reset();
    accumulator = 0;
    screen = SCREEN_PLAY;
    announce('Playing. Drive with W A S D. Press E to leave the car.');
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    const actions = input.takeActions();
    if (actions & ACTION_CONFIRM && screen === SCREEN_TITLE) startGame();
    else if (actions & ACTION_PAUSE && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    } else if (actions & (ACTION_PAUSE | ACTION_CONFIRM) && screen === SCREEN_PAUSED) {
      screen = SCREEN_PLAY;
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
        if (events & EVENT_HIT) announce('Hit.');
        accumulator -= STEP;
      }
    }
    renderer.draw(world.state, screen, dt);
  }

  // Leaving the tab pauses a running game rather than letting the car drive unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  announce('Solmarina. Press Enter to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
