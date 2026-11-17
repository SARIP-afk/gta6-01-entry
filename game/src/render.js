// Drawing only: the three.js renderer, the chase camera, the car and Rio meshes, and
// the DOM HUD. The world state in, pixels out. The sun follows the active entity so
// its shadow map stays crisp where the action is; the camera trails behind with a
// speed-sensitive field of view.
//
// Phase 1 frame-rate notes: the renderer runs with no antialiasing, no shadow map and
// no tone mapping — all three were measured and cost frames in software rendering
// without buying anything on this flat, sun-soaked look. setFog() exists only so play
// tests can measure what the distance haze costs; the shipped game keeps it on.
import * as THREE from 'three';
import { CAMERA, CAR, GAME, PALETTE, PLAYER } from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';

function buildCarMesh() {
  const car = new THREE.Group();
  car.name = 'rio-car';
  const bodyMat = new THREE.MeshLambertMaterial({ color: CAR.color });
  const glassMat = new THREE.MeshLambertMaterial({ color: CAR.cabinColor });
  const wheelMat = new THREE.MeshLambertMaterial({ color: CAR.wheelColor });
  const lightMat = new THREE.MeshLambertMaterial({
    color: '#fff6c8', emissive: 0xffe9a8, emissiveIntensity: 0.9,
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(CAR.width, 0.55, CAR.length), bodyMat);
  body.position.y = 0.55;
  body.castShadow = true;
  car.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 2.2), glassMat);
  cabin.position.set(0, 1.05, -0.2);
  cabin.castShadow = true;
  car.add(cabin);
  const wheels = [];
  for (const [x, z, front] of [[-0.85, 1.45, true], [0.85, 1.45, true], [-0.85, -1.45, false], [0.85, -1.45, false]]) {
    // Steer group (yaw) around the spin mesh (axle along X): nesting keeps both right.
    const steer = new THREE.Group();
    steer.position.set(x, 0.36, z);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.3, 12), wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.castShadow = true;
    steer.add(wheel);
    car.add(steer);
    wheels.push({ steer, spin: wheel, front });
  }
  for (const x of [-0.6, 0.6]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.1), lightMat);
    lamp.position.set(x, 0.62, CAR.length / 2 + 0.02);
    car.add(lamp);
  }
  return { group: car, wheels };
}

function buildPlayerMesh() {
  const rio = new THREE.Group();
  rio.name = 'rio';
  const skin = new THREE.MeshLambertMaterial({ color: 0xe8b98a });
  const shirt = new THREE.MeshLambertMaterial({ color: PLAYER.shirtColor });
  const pants = new THREE.MeshLambertMaterial({ color: PLAYER.pantsColor });
  const cap = new THREE.MeshLambertMaterial({ color: PLAYER.color });
  const legs = [];
  for (const x of [-0.14, 0.14]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.8, 0.26), pants);
    leg.position.set(x, 0.4, 0);
    leg.castShadow = true;
    rio.add(leg);
    legs.push(leg);
  }
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.72, 0.32), shirt);
  torso.position.y = 1.16;
  torso.castShadow = true;
  rio.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.34), skin);
  head.position.y = 1.72;
  head.castShadow = true;
  rio.add(head);
  const capMesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.38), cap);
  capMesh.position.y = 1.94;
  rio.add(capMesh);
  return { group: rio, legs };
}

export function createRenderer(canvas, hud) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();
  const fog = new THREE.Fog(new THREE.Color(PALETTE.fog), 250, 1000);
  scene.fog = fog;

  const sun = new THREE.DirectionalLight(new THREE.Color(PALETTE.sun), 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -110;
  sun.shadow.camera.right = 110;
  sun.shadow.camera.top = 110;
  sun.shadow.camera.bottom = -110;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 600;
  sun.shadow.bias = -0.0008;
  scene.add(sun);
  scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(0xbcd8f0, 0xe8c9a0, 0.75);
  scene.add(hemi);

  const camera = new THREE.PerspectiveCamera(CAMERA.fovBase, 1, 0.1, 3000);
  const camPos = new THREE.Vector3(0, 10, -20);
  const camLook = new THREE.Vector3(0, 0, 0);

  const car = buildCarMesh();
  scene.add(car.group);
  const rio = buildPlayerMesh();
  scene.add(rio.group);

  const titleScreen = document.getElementById('title-screen');
  const pauseScreen = document.getElementById('pause-screen');
  let lastHud = '';

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function setSun(target) {
    // Golden hour from the west: low sun, long shadows, warm light.
    sun.position.set(target.x - 180, 140, target.z + 60);
    sun.target.position.set(target.x, 0, target.z);
  }

  function drawHud(state) {
    const speedKmh = Math.round(Math.abs(state.car.speed) * 3.6);
    const mode = state.mode === 'car' ? 'Driving' : 'On foot';
    const hint = state.mode === 'car'
      ? 'WASD drive · Space handbrake · E exit car · P pause'
      : 'WASD walk · Shift run · E enter car · P pause';
    const text = `${mode}|${speedKmh}|${hint}`;
    if (text === lastHud) return;
    lastHud = text;
    hud.speed.textContent = state.mode === 'car' ? `${speedKmh} km/h` : '—';
    hud.mode.textContent = mode;
    hud.hint.textContent = hint;
  }

  /**
   * Put the camera where it belongs for this screen. Live play eases it there
   * (snap false); a staged screenshot places it exactly (snap true) — the chase
   * camera only converges over many frames, and a shot paints two, so without the
   * snap the staged frames show the camera still travelling from its start pose.
   */
  function placeCamera(state, screen, snap, dt) {
    const active = state.mode === 'car' ? state.car : state.player;
    const heading = active.heading;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    if (screen === SCREEN_TITLE) {
      // Cinematic title view: low over the avenue looking north, the car and Rio
      // parked below, the avenue running up to the Solmarina Tower.
      camPos.set(state.car.x - 6, 5.5, state.car.z + 22);
      camLook.set(state.car.x + 4, 12, state.car.z - 60);
      camera.position.copy(camPos);
      camera.lookAt(camLook);
      camera.fov = CAMERA.fovBase;
      camera.updateProjectionMatrix();
      return;
    }
    const dist = state.mode === 'car' ? CAMERA.driveDistance : CAMERA.footDistance;
    const height = state.mode === 'car' ? CAMERA.driveHeight : CAMERA.footHeight;
    const wantX = active.x - fx * dist;
    const wantY = height;
    const wantZ = active.z - fz * dist;
    if (snap) {
      camPos.set(wantX, wantY, wantZ);
    } else {
      const k = 1 - Math.exp(-CAMERA.smoothing * Math.max(dt, 0.001));
      camPos.x += (wantX - camPos.x) * k;
      camPos.y += (wantY - camPos.y) * k;
      camPos.z += (wantZ - camPos.z) * k;
    }
    camLook.set(active.x + fx * 8, 1.5, active.z + fz * 8);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    const targetFov = state.mode === 'car'
      ? CAMERA.fovBase + Math.min(CAMERA.fovSpeed, Math.abs(state.car.speed) * 0.45)
      : CAMERA.fovBase;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov = targetFov;
      camera.updateProjectionMatrix();
    }
  }

  /** Paint one frame: meshes, chase camera, HUD, overlays. `dt` is the real frame time. */
  function draw(state, screen, dt) {
    const active = state.mode === 'car' ? state.car : state.player;
    const heading = active.heading;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);

    // Car mesh follows the car; Rio follows the player (hidden while driving).
    car.group.position.set(state.car.x, 0, state.car.z);
    car.group.rotation.y = state.car.heading;
    const wheelSpin = (state.car.speed * dt) / 0.36;
    for (let i = 0; i < car.wheels.length; i += 1) {
      const w = car.wheels[i];
      w.spin.rotateY(wheelSpin);
      if (w.front) w.steer.rotation.y = state.car.steer * 0.5;
    }
    rio.group.visible = state.mode === 'foot';
    rio.group.position.set(state.player.x, 0, state.player.z);
    rio.group.rotation.y = state.player.heading;
    if (state.player.moving) {
      const phase = state.time * (state.player.running ? 11 : 7);
      rio.legs[0].rotation.x = Math.sin(phase) * 0.5;
      rio.legs[1].rotation.x = -Math.sin(phase) * 0.5;
    } else {
      rio.legs[0].rotation.x = 0;
      rio.legs[1].rotation.x = 0;
    }

    setSun(active);
    placeCamera(state, screen, false, dt);

    if (titleScreen) titleScreen.style.display = screen === SCREEN_TITLE ? 'flex' : 'none';
    if (pauseScreen) pauseScreen.style.display = screen === SCREEN_PAUSED ? 'flex' : 'none';
    drawHud(state);
    renderer.render(scene, camera);
  }

  /** The camera's yaw (the direction it looks), for camera-relative walking. */
  function cameraYaw() {
    const dx = camLook.x - camera.position.x;
    const dz = camLook.z - camera.position.z;
    return Math.atan2(dx, dz);
  }

  resize();
  window.addEventListener('resize', resize);
  return {
    draw,
    cameraYaw,
    scene,
    camera,
    /** Draw calls and triangles of the last rendered frame. */
    info() {
      return {
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
      };
    },
    /** Test-only: switch the distance haze off/on to measure what it costs. */
    setFog(on) {
      scene.fog = on ? fog : null;
    },
    /** Staged shots only: place the camera exactly where it belongs, at once. */
    snap(state, screen) {
      placeCamera(state, screen, true, 1 / 60);
    },
  };
}
