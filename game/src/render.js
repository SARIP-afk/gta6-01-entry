// Drawing only: the three.js renderer, the chase camera, the car and Rio meshes, and
// the DOM HUD. The world state in, pixels out. The sun follows the active entity so
// its shadow map stays crisp where the action is; the camera trails behind with a
// speed-sensitive field of view.
//
// Phase 1 frame-rate notes: the renderer runs with no antialiasing, no shadow map and
// no tone mapping — all three were measured and cost frames in software rendering
// without buying anything on this flat, sun-soaked look. setFog() exists only so play
// tests can measure what the distance haze costs; the shipped game keeps it on.
// Phase 2: the HUD itself lives in hud.js (this file only calls hud.draw); the
// renderer also draws `state.extras` — visual-only police cruisers and traffic cars
// staged for the cover shot, with flashing light bars. Extras have no AI (Phase 3);
// they are placed by the shot stager and painted like any other mesh.
// Phase 3: the renderer also draws the LIVE city — police cruisers (state.police),
// traffic cars (state.traffic) and pedestrians (state.peds) — from their own mesh
// pools. The staged extras keep dedicated pools of their own, so a live cruiser
// never steals a staged one's slot in the cover shot.
import * as THREE from 'three';
import { CAMERA, CAR, EXTRA_CAR, GAME, PALETTE, PLAYER } from './config.js';

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

/** A visual-only car: same silhouette as Rio's, another paint job. Police get a roof light bar. */
function buildExtraCarMesh(kind, colorIndex) {
  const car = new THREE.Group();
  car.name = `extra-${kind}`;
  const bodyColor = kind === 'police'
    ? EXTRA_CAR.policeBody
    : EXTRA_CAR.trafficColors[colorIndex % EXTRA_CAR.trafficColors.length];
  const bodyMat = new THREE.MeshLambertMaterial({ color: bodyColor });
  const glassMat = new THREE.MeshLambertMaterial({ color: EXTRA_CAR.cabinColor });
  const wheelMat = new THREE.MeshLambertMaterial({ color: EXTRA_CAR.wheelColor });
  const body = new THREE.Mesh(new THREE.BoxGeometry(CAR.width, 0.55, CAR.length), bodyMat);
  body.position.y = 0.55;
  car.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 2.2), glassMat);
  cabin.position.set(0, 1.05, -0.2);
  car.add(cabin);
  if (kind === 'police') {
    // White roof band, then the light bar: red left, blue right.
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 0.12, 2.2),
      new THREE.MeshLambertMaterial({ color: EXTRA_CAR.policeRoof }),
    );
    roof.position.set(0, 1.32, -0.2);
    car.add(roof);
  }
  for (const [x, z] of [[-0.85, 1.45], [0.85, 1.45], [-0.85, -1.45], [0.85, -1.45]]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.3, 12), wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.36, z);
    car.add(wheel);
  }
  let redLamp = null;
  let blueLamp = null;
  if (kind === 'police') {
    const redMat = new THREE.MeshLambertMaterial({
      color: 0x881111, emissive: EXTRA_CAR.policeLightRed, emissiveIntensity: 1.6,
    });
    const blueMat = new THREE.MeshLambertMaterial({
      color: 0x112288, emissive: EXTRA_CAR.policeLightBlue, emissiveIntensity: 0.15,
    });
    redLamp = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.22, 0.5), redMat);
    redLamp.position.set(-0.45, 1.5, -0.2);
    car.add(redLamp);
    blueLamp = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.22, 0.5), blueMat);
    blueLamp.position.set(0.45, 1.5, -0.2);
    car.add(blueLamp);
  }
  return { group: car, redLamp, blueLamp };
}

/** A live traffic car: the same silhouette, fewer meshes (no lamps, no light bar). */
function buildTrafficCarMesh(kind, colorIndex) {
  const car = new THREE.Group();
  car.name = `traffic-${kind}`;
  const bodyColor = kind === 'taxi'
    ? 0xf2c94c
    : EXTRA_CAR.trafficColors[colorIndex % EXTRA_CAR.trafficColors.length];
  const bodyMat = new THREE.MeshLambertMaterial({ color: bodyColor });
  const glassMat = new THREE.MeshLambertMaterial({ color: EXTRA_CAR.cabinColor });
  const wheelMat = new THREE.MeshLambertMaterial({ color: EXTRA_CAR.wheelColor });
  const body = new THREE.Mesh(new THREE.BoxGeometry(CAR.width, 0.55, CAR.length), bodyMat);
  body.position.y = 0.55;
  car.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 2.2), glassMat);
  cabin.position.set(0, 1.05, -0.2);
  car.add(cabin);
  for (const [x, z] of [[-0.85, 1.45], [0.85, 1.45], [-0.85, -1.45], [0.85, -1.45]]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.3, 12), wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.36, z);
    car.add(wheel);
  }
  // The pool mesh is repainted every frame from the live car's kind/colour, so
  // a slot never shows the wrong paint job when cars respawn into other slots.
  return { group: car, bodyMat };
}

/** A pedestrian: torso + head, shirt colour varies (index into PALETTE.pedShirts). */
function buildPedMesh(shirtColor) {
  const ped = new THREE.Group();
  ped.name = 'pedestrian';
  const shirt = new THREE.MeshLambertMaterial({ color: shirtColor });
  const skin = new THREE.MeshLambertMaterial({ color: 0xe8b98a });
  const pants = new THREE.MeshLambertMaterial({ color: 0x33302a });
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.7, 0.26), pants);
  legs.position.y = 0.35;
  ped.add(legs);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.68, 0.3), shirt);
  torso.position.y = 1.04;
  ped.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.32), skin);
  head.position.y = 1.56;
  ped.add(head);
  // Repainted every frame from the live pedestrian's shirt, like traffic cars.
  return { group: ped, shirtMat: shirt };
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

  // Live pools (Phase 3): 3 cruisers, 8 traffic cars, 16 pedestrians.
  const policePool = [];
  const trafficPool = [];
  const pedPool = [];
  for (let i = 0; i < 3; i += 1) {
    const p = buildExtraCarMesh('police', i);
    p.group.visible = false;
    scene.add(p.group);
    policePool.push(p);
  }
  for (let i = 0; i < 8; i += 1) {
    const t = buildTrafficCarMesh('sedan', i);
    t.group.visible = false;
    scene.add(t.group);
    trafficPool.push(t);
  }
  for (let i = 0; i < 16; i += 1) {
    const p = buildPedMesh(PALETTE.pedShirts[i % PALETTE.pedShirts.length]);
    p.group.visible = false;
    scene.add(p.group);
    pedPool.push(p);
  }
  // Staged extras (cover shot): their own pools, so they never fight the live
  // cars for a slot. 2 police cruisers + 3 traffic cars, as the cover stages.
  const extraPolicePool = [];
  const extraTrafficPool = [];
  for (let i = 0; i < 2; i += 1) {
    const p = buildExtraCarMesh('police', i);
    p.group.visible = false;
    scene.add(p.group);
    extraPolicePool.push(p);
  }
  for (let i = 0; i < 3; i += 1) {
    const t = buildExtraCarMesh('traffic', i);
    t.group.visible = false;
    scene.add(t.group);
    extraTrafficPool.push(t);
  }

  const titleScreen = document.getElementById('title-screen');
  const pauseScreen = document.getElementById('pause-screen');

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

    // Police light bars flash on game time, so a staged shot (fixed time) shows
    // one steady phase. The same phase drives live cruisers and staged ones.
    const flashRed = Math.floor(state.time * 4) % 2 === 0;
    const flash = (mesh) => {
      if (mesh.redLamp && mesh.blueLamp) {
        mesh.redLamp.material.emissiveIntensity = flashRed ? 1.6 : 0.15;
        mesh.blueLamp.material.emissiveIntensity = flashRed ? 0.15 : 1.6;
      }
    };
    // Live cruisers (Phase 3): chase, ram, search — from state.police.
    const livePolice = state.police || [];
    for (let i = 0; i < policePool.length; i += 1) {
      const mesh = policePool[i];
      const p = livePolice[i];
      if (!p) { mesh.group.visible = false; continue; }
      mesh.group.visible = true;
      mesh.group.position.set(p.x, 0, p.z);
      mesh.group.rotation.y = p.heading;
      flash(mesh);
    }
    // Live traffic (Phase 3): from state.traffic. The pool mesh is a plain
    // sedan silhouette; a taxi reads by its yellow paint, a van by its colour.
    const liveTraffic = state.traffic || [];
    for (let i = 0; i < trafficPool.length; i += 1) {
      const mesh = trafficPool[i];
      const t = liveTraffic[i];
      if (!t) { mesh.group.visible = false; continue; }
      mesh.group.visible = true;
      mesh.group.position.set(t.x, 0, t.z);
      mesh.group.rotation.y = t.heading;
      mesh.bodyMat.color.setHex(t.kind === 'taxi'
        ? 0xf2c94c
        : EXTRA_CAR.trafficColors[t.colorIndex % EXTRA_CAR.trafficColors.length]);
    }
    // Pedestrians (Phase 3): from state.peds. A knocked-down pedestrian is
    // hidden until it walks again elsewhere (it respawns after 2 seconds).
    const livePeds = state.peds || [];
    for (let i = 0; i < pedPool.length; i += 1) {
      const mesh = pedPool[i];
      const p = livePeds[i];
      if (!p || p.state === 'down') { mesh.group.visible = false; continue; }
      mesh.group.visible = true;
      mesh.group.position.set(p.x, 0, p.z);
      mesh.group.rotation.y = p.heading;
      mesh.shirtMat.color.setHex(PALETTE.pedShirts[p.shirt % PALETTE.pedShirts.length]);
    }
    // Staged extras (cover shot): their own pools, placed by the shot stager.
    let extraPoliceSeen = 0;
    let extraTrafficSeen = 0;
    for (const extra of state.extras) {
      const pool = extra.kind === 'police' ? extraPolicePool : extraTrafficPool;
      const slot = extra.kind === 'police' ? extraPoliceSeen : extraTrafficSeen;
      if (slot >= pool.length) continue;
      if (extra.kind === 'police') extraPoliceSeen += 1;
      else extraTrafficSeen += 1;
      const mesh = pool[slot];
      mesh.group.visible = true;
      mesh.group.position.set(extra.x, 0, extra.z);
      mesh.group.rotation.y = extra.heading;
      flash(mesh);
    }
    for (let i = extraPoliceSeen; i < extraPolicePool.length; i += 1) extraPolicePool[i].group.visible = false;
    for (let i = extraTrafficSeen; i < extraTrafficPool.length; i += 1) extraTrafficPool[i].group.visible = false;

    setSun(active);
    placeCamera(state, screen, false, dt);

    if (titleScreen) titleScreen.style.display = screen === SCREEN_TITLE ? 'flex' : 'none';
    if (pauseScreen) pauseScreen.style.display = screen === SCREEN_PAUSED ? 'flex' : 'none';
    hud.draw(state, screen);
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
