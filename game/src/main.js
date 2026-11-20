// Solmarina (fresh build) — boot, fixed-step loop, keyboard/mouse input,
// title / pause / save wiring. The game runs offline from static files.
import * as THREE from '../vendor/three.module.min.js';
import { createWorld, saveGame, loadGame, STEP } from './sim.js';
import { Renderer } from './gfx.js';
import { Hud } from './hud.js';
import { Sound } from './sound.js';
import { stageShot } from './shots.js';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') || 1) || 1;
const shotName = params.get('shot');
const quality = localStorage.getItem('solmarina-quality') || 'med';

const canvas = document.getElementById('game');
const world = createWorld(seed);
const renderer = new Renderer(world, canvas, quality);
const sound = new Sound();
const hud = new Hud(world, handleAction);

let keys = {};
let mouse = { x: 0, y: 0, down: false };
let lastShot = 0;

function handleAction(action, arg) {
  const s = world.state;
  sound.ensure();
  if (action === 'start') {
    s.screen = 'play';
    if (!s.missions.started) s.missions.started = false; // sim starts M1 on first step
    document.getElementById('station-name').textContent = sound.stationName();
  } else if (action === 'resume') {
    s.screen = 'play';
    s.paused = false;
  } else if (action === 'quit-title') {
    world.reset(seed);
    s.screen = 'title';
  } else if (action === 'restart') {
    world.reset(seed);
    s.screen = 'play';
  } else if (action === 'save') {
    if (saveGame(world, arg)) sound.blip(880);
  } else if (action === 'load') {
    if (loadGame(world, arg)) { s.screen = 'play'; sound.blip(660); }
  } else if (action === 'station') {
    document.getElementById('station-name').textContent = sound.setStation(sound.station + arg);
  } else if (action === 'map-click') {
    // teleport is a debug convenience for the big map: walk the hero there
    s.player.x = arg.x; s.player.z = arg.z;
    s.heroCar.x = arg.x; s.heroCar.z = arg.z;
    s.screen = 'play';
  }
}

window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  sound.ensure();
  const s = world.state;
  if (e.code === 'KeyM' && s.screen === 'play') { s.screen = 'pause'; hud.showTab('map'); }
  else if (e.code === 'KeyM' && s.screen === 'pause') { s.screen = 'play'; }
  else if ((e.code === 'KeyP' || e.code === 'Escape') && s.screen === 'play') { s.screen = 'pause'; hud.showTab('map'); }
  else if ((e.code === 'KeyP' || e.code === 'Escape') && s.screen === 'pause') { s.screen = 'play'; }
  else if (e.code === 'KeyT' && s.screen === 'play') {
    document.getElementById('station-name').textContent = sound.setStation(sound.station + 1);
  } else if (e.code === 'KeyZ' && s.screen === 'play' && s.crew.mira <= 0) {
    s.crew.mira = 30; s.wanted = Math.max(0, s.wanted - 1);
    s.missions.dialog = { speaker: 'MIRA', line: 'Plates swapped. They\'re looking for a different car now.' };
    s.missions.dialogTimer = 5;
  } else if (e.code === 'KeyX' && s.screen === 'play' && s.crew.lio <= 0 && s.player.mode === 'car') {
    s.crew.lio = 45; s.heroCar.damage = 0;
    s.missions.dialog = { speaker: 'LIO', line: 'Quick fix — she\'s good as new. Don\'t scratch her again.' };
    s.missions.dialogTimer = 5;
  } else if (e.code === 'KeyC' && s.screen === 'play' && s.crew.kiki <= 0) {
    s.crew.kiki = 40;
    s.missions.dialog = { speaker: 'KIKI', line: 'Eyes out: two cruisers north, one on the causeway. Move.' };
    s.missions.dialogTimer = 5;
  }
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
canvas.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0) { mouse.down = true; sound.ensure(); }
});
window.addEventListener('mouseup', () => { mouse.down = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function readInput() {
  const s = world.state;
  const p = s.player;
  let moveX = 0, moveZ = 0;
  if (keys.KeyW || keys.ArrowUp) moveZ -= 1;
  if (keys.KeyS || keys.ArrowDown) moveZ += 1;
  if (keys.KeyA || keys.ArrowLeft) moveX -= 1;
  if (keys.KeyD || keys.ArrowRight) moveX += 1;
  // walking is camera-relative: screen up = away from camera (north on the map)
  const input = {
    moveX, moveZ,
    steer: (keys.KeyA || keys.ArrowLeft ? -1 : 0) + (keys.KeyD || keys.ArrowRight ? 1 : 0),
    throttle: (keys.KeyW || keys.ArrowUp) ? 1 : 0,
    brake: !!(keys.Space || keys.KeyS || keys.ArrowDown),
    boost: !!keys.ShiftLeft,
    enter: !!keys.KeyE,
    reload: !!keys.KeyR,
    shootAngle: null, shoot: false,
  };
  if (keys.KeyE) keys.KeyE = false; // edge-triggered
  if (keys.KeyR) keys.KeyR = false;
  // mouse aim: angle from the player to the cursor, in world space
  if (p.mode === 'walk' && mouse.down && performance.now() - lastShot > 180) {
    lastShot = performance.now();
    const rect = canvas.getBoundingClientRect();
    const nx = ((mouse.x - rect.left) / rect.width) * 2 - 1;
    const ny = ((mouse.y - rect.top) / rect.height) * 2 - 1;
    // screen-right maps to world +x rotated by camera yaw; approximate with
    // the camera's current yaw from the renderer
    const cam = renderer.camera;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    const yaw = Math.atan2(-fwd.z, fwd.x);
    const ang = Math.atan2(-ny, nx);
    input.shootAngle = yaw + ang;
    input.shoot = true;
    sound.shot();
  }
  return input;
}

// quality buttons on the title screen
document.querySelectorAll('[data-quality]').forEach((b) => {
  b.addEventListener('click', () => {
    localStorage.setItem('solmarina-quality', b.dataset.quality);
    location.reload();
  });
});

let staged = false;
let fpsFrames = 0, fpsTime = 0, lastWall = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const now = t || performance.now();
  const s = world.state;
  if (shotName && !staged) {
    staged = true;
    stageShot(shotName, world, renderer);
    // draw several frames so instanced pools settle before the capture
    for (let i = 0; i < 6; i++) renderer.update(STEP);
    document.title = `Solmarina — ${shotName}`;
    window.__shotReady = true;
  }
  if (s.screen === 'play' && !s.paused && !shotName) {
    // staged shots freeze the sim after staging so the frame stays composed
    world.step(STEP, readInput());
    sound.tick();
    sound.engine(s.heroCar.speed, s.player.mode === 'car');
  }
  renderer.update(STEP);
  hud.update(STEP);
  // __stats every frame: renderer.info counters are cheap reads, and the
  // old 1 s sim-time gate never fired headless — SwiftShader runs 1–2 FPS,
  // so 60 sim frames take 30–60 s of wall time and the driver read "{}".
  window.__stats = renderer.stats();
  // __fps from the wall clock, not sim time, for the same reason
  if (lastWall) {
    fpsFrames++;
    fpsTime += (now - lastWall) / 1000;
    if (fpsTime >= 1) {
      window.__fps = Math.round(fpsFrames / fpsTime);
      fpsFrames = 0; fpsTime = 0;
    }
  }
  lastWall = now;
}

// title screen shows the live city behind it
world.state.screen = 'title';
requestAnimationFrame(frame);

window.__solmarina = { world, renderer, hud, sound };
window.__traceHash = () => world.traceHash();
