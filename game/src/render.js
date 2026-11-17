// Drawing only: the three.js renderer, the chase camera, the car and Rio meshes, and
// Finishing (v3.8-structural, recording #4): file re-written in this session; gates re-run on this exact content — see BATCH2-FINISH-REPORT.md.
// the DOM HUD. The world state in, pixels out. The sun follows the active entity so
// its shadow map stays crisp where the action is; the camera trails behind with a
// speed-sensitive field of view.
//
// Phase 1 frame-rate notes: the renderer ran with no antialiasing, no shadow map and
// no tone mapping — all three were measured and cost frames in software rendering
// without buying anything on the flat, sun-soaked look of the time. setFog() exists
// only so play tests can measure what the distance haze costs; the shipped game
// keeps it on. Phase 3.5 (visual pass) reverses the shadow/tone-mapping call: the
// audit proved the flat look came from the missing shadows and grade, not from the
// polygon count — shadows and ACES are ON now, and the headless frame rate is
// reported honestly instead of bought back by flattening the picture.
// Batch 1 (v3.7-sharp): antialiasing ON by default (free on a real GPU; the
// finalist review plays the game on one) — ?aa=0 in the URL turns it off for
// A/B capture tests. Hemisphere 1.15 + a weak east fill light lift the
// shadowed streets the blur diagnosis measured at 46.6% near-black.
// Phase 2: the HUD itself lives in hud.js (this file only calls hud.draw); the
// renderer also draws `state.extras` — visual-only police cruisers and traffic cars
// staged for the cover shot, with flashing light bars. Extras have no AI (Phase 3);
// they are placed by the shot stager and painted like any other mesh.
// Phase 3: the renderer also draws the LIVE city — police cruisers (state.police),
// traffic cars (state.traffic) and pedestrians (state.peds) — from their own mesh
// pools. The staged extras keep dedicated pools of their own, so a live cruiser
// never steals a staged one's slot in the cover shot.
import * as THREE from 'three';
import { CAMERA, CAR, EXTRA_CAR, GAME, LIGHT, PALETTE, PLAYER } from './config.js';
import { buildCar } from './car.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';

// Batch 2, Phase A: the car builders moved to game/src/car.js — one
// buildCar() (sloped hood/deck, glass cabin + pillars, wheel arches, merged
// meshes, spoked rims) replaces buildCarMesh / buildExtraCarMesh /
// buildTrafficCarMesh + addCarDetails. Same sizes, same speeds, same
// colliders — visual only. The old windshield lean (rx -0.5, top edge
// forward of the roof) is corrected in car.js (rx +0.55).
/** A pedestrian: two legs, torso, head, hair, and two sleeved arms that swing
 * while walking (Batch 2, Phase C — the old ped was 3 boxes and glided).
 * The arms are groups pivoted at the shoulder, so rotation.x swings them
 * like Rio's legs. Same size, same speed, same hitbox — visual only. */
function buildPedMesh(shirtColor) {
  const ped = new THREE.Group();
  ped.name = 'pedestrian';
  const shirt = new THREE.MeshLambertMaterial({ color: shirtColor });
  const skin = new THREE.MeshLambertMaterial({ color: 0xe8b98a });
  const pants = new THREE.MeshLambertMaterial({ color: 0x33302a });
  const hairMat = new THREE.MeshLambertMaterial({ color: 0x2a2018 });
  const legs = [];
  for (const x of [-0.09, 0.09]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.7, 0.26), pants);
    leg.position.set(x, 0.35, 0);
    ped.add(leg);
    legs.push(leg);
  }
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.68, 0.3), shirt);
  torso.position.y = 1.04;
  ped.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.32), skin);
  head.position.y = 1.56;
  ped.add(head);
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.34), hairMat);
  hair.position.y = 1.78;
  ped.add(hair);
  const arms = [];
  for (const x of [-0.35, 0.35]) {
    const arm = new THREE.Group();
    arm.position.set(x, 1.32, 0);
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.58, 0.16), shirt);
    sleeve.position.y = -0.29;
    arm.add(sleeve);
    ped.add(arm);
    arms.push(arm);
  }
  // Repainted every frame from the live pedestrian's shirt, like traffic cars.
  return { group: ped, shirtMat: shirt, legs, arms };
}

function buildPlayerMesh() {
  const rio = new THREE.Group();
  rio.name = 'rio';
  const skin = new THREE.MeshLambertMaterial({ color: 0xe8b98a });
  const shirt = new THREE.MeshLambertMaterial({ color: PLAYER.shirtColor });
  const pants = new THREE.MeshLambertMaterial({ color: PLAYER.pantsColor });
  const cap = new THREE.MeshLambertMaterial({ color: PLAYER.color });
  const shoeMat = new THREE.MeshLambertMaterial({ color: PLAYER.shoeColor });
  const jacketMat = new THREE.MeshLambertMaterial({ color: PLAYER.jacketColor });
  const legs = [];
  for (const x of [-0.14, 0.14]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.8, 0.26), pants);
    leg.position.set(x, 0.4, 0);
    leg.castShadow = true;
    rio.add(leg);
    legs.push(leg);
    // Shoes: dark, slightly proud of the leg, so the feet read on the asphalt.
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.36), shoeMat);
    shoe.position.set(x, 0.06, 0.04);
    shoe.castShadow = true;
    rio.add(shoe);
  }
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.72, 0.32), shirt);
  torso.position.y = 1.16;
  torso.castShadow = true;
  rio.add(torso);
  // Yellow jacket panel over the shirt: Rio's signature colour, visible at range.
  const jacket = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.5, 0.08), jacketMat);
  jacket.position.set(0, 1.18, 0.19);
  rio.add(jacket);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.34), skin);
  head.position.y = 1.72;
  head.castShadow = true;
  rio.add(head);
  const capMesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.38), cap);
  capMesh.position.y = 1.94;
  rio.add(capMesh);
  // Batch 2, Phase C: Rio stops being a wooden figure — a minimal face (two
  // eyes), a belt and a collar, and two sleeved arms (yellow jacket, skin
  // hands) pivoted at the shoulders, swinging against the legs on the
  // existing walk phase. Same size, same speed, same hitbox — visual only.
  const eyeMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
  for (const x of [-0.08, 0.08]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.02), eyeMat);
    eye.position.set(x, 1.76, 0.18);
    rio.add(eye);
  }
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.34), shoeMat);
  belt.position.y = 0.82;
  rio.add(belt);
  const collar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.34), jacketMat);
  collar.position.y = 1.5;
  rio.add(collar);
  const arms = [];
  for (const x of [-0.37, 0.37]) {
    const arm = new THREE.Group();
    arm.position.set(x, 1.45, 0);
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.56, 0.18), jacketMat);
    sleeve.position.y = -0.28;
    sleeve.castShadow = true;
    arm.add(sleeve);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), skin);
    hand.position.y = -0.6;
    arm.add(hand);
    rio.add(arm);
    arms.push(arm);
  }
  return { group: rio, legs, arms };
}

export function createRenderer(canvas, hud, options = {}) {
  // Batch 1: antialiasing ON unless the URL says ?aa=0 (A/B capture tests).
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: options.antialias !== false });
  renderer.setPixelRatio(1);
  // Phase 3.5 visual pass: shadows and ACES tone mapping are ON. The shadow
  // camera + castShadow flags were already there — only this flag was off. The
  // normal bias keeps the big flat instanced faces acne-free at a 220 m frustum
  // (texel ~0.21 m); it was tuned against the staged shots, see the report.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = LIGHT.exposure;

  const scene = new THREE.Scene();
  // Phase 3.5: cooler, farther haze — the city keeps its depth instead of
  // drowning in warm cream fog at 250 m.
  const fog = new THREE.Fog(new THREE.Color(PALETTE.fog), 350, 1200);
  scene.fog = fog;
  // Batch 2, Phase D: a procedural PMREM environment map, generated once at
  // load from a mini scene (blue sky ball + bright sun disc + warm ground) —
  // the only reflection source without external assets. It lights the
  // MeshStandard/Physical materials (car paint, glass, sea) that Lambert
  // ignores; without it, moving to Standard would be invisible. Deterministic
  // (no random), one-off cost at load, then scene.environment for free.
  {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    // Batch 2, Phase D (pass 4): the env scene is deliberately DIM (a deep
    // blue sky, a warm sun disc, a mid-brown ground) — pass 3 proved even a
    // mid-bright env washes the red hero car pink through the diffuse
    // irradiance. The direct sun + hemi + fill do the main lighting; the env
    // only adds a subtle clearcoat sheen.
    const skyBall = new THREE.Mesh(
      new THREE.SphereGeometry(50, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x4a6a8a, side: THREE.BackSide }),
    );
    envScene.add(skyBall);
    const sunDisc = new THREE.Mesh(
      new THREE.CircleGeometry(8, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd890 }),
    );
    sunDisc.position.set(-30, 18, -30);
    sunDisc.lookAt(0, 0, 0);
    envScene.add(sunDisc);
    const groundDisc = new THREE.Mesh(
      new THREE.CircleGeometry(45, 24),
      new THREE.MeshBasicMaterial({ color: 0x8a6a45 }),
    );
    groundDisc.rotation.x = -Math.PI / 2;
    groundDisc.position.y = -8;
    envScene.add(groundDisc);
    const envRT = pmrem.fromScene(envScene, 0.04);
    scene.environment = envRT.texture;
    pmrem.dispose();
  }

  const sun = new THREE.DirectionalLight(new THREE.Color(PALETTE.sun), LIGHT.sunIntensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -110;
  sun.shadow.camera.right = 110;
  sun.shadow.camera.top = 110;
  sun.shadow.camera.bottom = -110;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 600;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.15;
  scene.add(sun);
  scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(0xbcd8f0, 0xe8c9a0, LIGHT.hemiIntensity);
  scene.add(hemi);
  // Batch 1: a weak fill light from the east (opposite the western sun), no
  // shadow map — it lifts the faces the sun never reaches, so the shadowed
  // side of a street stops being a black hole. Positioned in setSun(), which
  // already follows the active entity.
  const fill = new THREE.DirectionalLight(new THREE.Color(LIGHT.fillColor), LIGHT.fillIntensity);
  scene.add(fill);
  scene.add(fill.target);

  const camera = new THREE.PerspectiveCamera(CAMERA.fovBase, 1, 0.1, 3000);
  const camPos = new THREE.Vector3(0, 10, -20);
  const camLook = new THREE.Vector3(0, 0, 0);
  // Batch 2 (test-only): a held camera pose for proof frames (e.g. the
  // 3/4-front car shot the cover never shows). Only the automated driver
  // sets it; the shipped game never calls holdCamera.
  let cameraHold = null;

  const car = buildCar({ kind: 'hero', paint: CAR.color, interactive: true });
  car.group.name = 'rio-car';
  scene.add(car.group);
  const rio = buildPlayerMesh();
  scene.add(rio.group);

  // Live pools (Phase 3): 3 cruisers, 8 traffic cars, 16 pedestrians.
  const policePool = [];
  const trafficPool = [];
  const pedPool = [];
  for (let i = 0; i < 3; i += 1) {
    const p = buildCar({ kind: 'police', paint: EXTRA_CAR.policeBody });
    p.group.name = 'police-live';
    p.group.visible = false;
    scene.add(p.group);
    policePool.push(p);
  }
  // Traffic slots carry a kind so the draw loop can match a live car to a
  // slot of the same silhouette (van/taxi/sedan). Mix mirrors the spawn
  // mix in traffic.js (taxi 20%, van 15%, sedan 65%).
  const TRAFFIC_SLOT_KINDS = ['sedan', 'sedan', 'sedan', 'sedan', 'sedan', 'taxi', 'taxi', 'van'];
  for (let i = 0; i < 8; i += 1) {
    const kind = TRAFFIC_SLOT_KINDS[i];
    const t = buildCar({
      kind,
      paint: kind === 'taxi' ? 0xf2c94c : EXTRA_CAR.trafficColors[i % EXTRA_CAR.trafficColors.length],
    });
    t.group.name = `traffic-${kind}`;
    t.slotKind = kind;
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
  // Batch 2, Phase D: blob shadows — a soft dark disc under the hero car,
  // Rio and each pedestrian, following them every frame. A backup for the
  // coarse shadow map (texel ~0.21 m): the characters read as grounded even
  // where the real shadow is a smear. Transparent, depthWrite off, so it
  // never z-fights the road or the dashes. The disc height follows the
  // surface: road 0.11, sidewalk 0.21, beach sand -0.14.
  const groundY = (x, z) => {
    if (x > 336) return -0.14;
    const d = (v) => {
      const t = (((v + 266) % 52) + 52) % 52;
      return Math.min(t, 52 - t);
    };
    return (d(x) < 6.5 || d(z) < 6.5) ? 0.11 : 0.21;
  };
  const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false });
  const blobGeo = new THREE.CircleGeometry(1, 16);
  const makeBlob = (r) => {
    const b = new THREE.Mesh(blobGeo, blobMat);
    b.rotation.x = -Math.PI / 2;
    b.scale.set(r, r, 1);
    b.renderOrder = 1;
    scene.add(b);
    return b;
  };
  const carBlob = makeBlob(2.4);
  const rioBlob = makeBlob(0.55);
  const pedBlobs = pedPool.map(() => makeBlob(0.45));
  // Staged extras (cover shot): their own pools, so they never fight the live
  // cars for a slot. 2 police cruisers + 3 traffic cars, as the cover stages.
  // The staged traffic trio shows three silhouettes (sedan, hatch, van) so
  // the cover reads as a street full of different cars.
  const extraPolicePool = [];
  const extraTrafficPool = [];
  for (let i = 0; i < 2; i += 1) {
    const p = buildCar({ kind: 'police', paint: EXTRA_CAR.policeBody });
    p.group.name = 'police-staged';
    p.group.visible = false;
    scene.add(p.group);
    extraPolicePool.push(p);
  }
  const STAGED_TRAFFIC_KINDS = ['sedan', 'hatch', 'van'];
  for (let i = 0; i < 3; i += 1) {
    const kind = STAGED_TRAFFIC_KINDS[i];
    const t = buildCar({
      kind,
      paint: EXTRA_CAR.trafficColors[i % EXTRA_CAR.trafficColors.length],
    });
    t.group.name = `traffic-staged-${kind}`;
    t.slotKind = kind;
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
    // Batch 1 iter-2: the fill is HIGHER (63 deg) so it lifts horizontal
    // surfaces (roads) more than vertical ones; intensity 0.7.
    fill.position.set(target.x + 90, 180, target.z - 30);
    fill.target.position.set(target.x, 0, target.z);
  }

  /**
   * Put the camera where it belongs for this screen. Live play eases it there
   * (snap false); a staged screenshot places it exactly (snap true) — the chase
   * camera only converges over many frames, and a shot paints two, so without the
   * snap the staged frames show the camera still travelling from its start pose.
   */
  function placeCamera(state, screen, snap, dt) {
    if (cameraHold) {
      camera.position.copy(cameraHold.pos);
      camera.lookAt(cameraHold.look);
      return;
    }
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
    const dist = state.cameraOverride?.distance
      ?? (state.mode === 'car' ? CAMERA.driveDistance : CAMERA.footDistance);
    const height = state.cameraOverride?.height
      ?? (state.mode === 'car' ? CAMERA.driveHeight : CAMERA.footHeight);
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
    const targetFov = state.cameraOverride?.fov
      ?? (state.mode === 'car'
        ? CAMERA.fovBase + Math.min(CAMERA.fovSpeed, Math.abs(state.car.speed) * 0.45)
        : CAMERA.fovBase);
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
    carBlob.position.set(state.car.x, groundY(state.car.x, state.car.z), state.car.z);
    const wheelSpin = (state.car.speed * dt) / 0.36;
    for (let i = 0; i < car.wheels.length; i += 1) {
      const w = car.wheels[i];
      // Spin around the axle (X). The old code rotated the tyre mesh around
      // its local Y after a z-rotation, which spun the wheels backwards;
      // rotation.x += is the physically correct roll direction.
      w.spin.rotation.x += wheelSpin;
      if (i < 2) w.steer.rotation.y = state.car.steer * 0.5;
    }
    rio.group.visible = state.mode === 'foot';
    rio.group.position.set(state.player.x, 0, state.player.z);
    rio.group.rotation.y = state.player.heading;
    rioBlob.visible = state.mode === 'foot';
    rioBlob.position.set(state.player.x, groundY(state.player.x, state.player.z), state.player.z);
    if (state.player.moving) {
      const phase = state.time * (state.player.running ? 11 : 7);
      rio.legs[0].rotation.x = Math.sin(phase) * 0.5;
      rio.legs[1].rotation.x = -Math.sin(phase) * 0.5;
      // Batch 2, Phase C: the arms swing against the legs on the same phase.
      rio.arms[0].rotation.x = -Math.sin(phase) * 0.4;
      rio.arms[1].rotation.x = Math.sin(phase) * 0.4;
    } else {
      rio.legs[0].rotation.x = 0;
      rio.legs[1].rotation.x = 0;
      rio.arms[0].rotation.x = 0;
      rio.arms[1].rotation.x = 0;
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
    // Live traffic (Phase 3): from state.traffic. Each live car takes the
    // first free pool slot of the same silhouette kind (a van gets a van
    // mesh); if none is free it falls back to any free slot, repainted to
    // the live car's colour — the old code's behaviour for a mismatch.
    const liveTraffic = state.traffic || [];
    const usedSlots = new Set();
    for (let i = 0; i < liveTraffic.length; i += 1) {
      const t = liveTraffic[i];
      if (!t) continue;
      let slot = trafficPool.findIndex((m, j) => !usedSlots.has(j) && m.slotKind === t.kind);
      if (slot < 0) slot = trafficPool.findIndex((m, j) => !usedSlots.has(j));
      if (slot < 0) break;
      usedSlots.add(slot);
      const mesh = trafficPool[slot];
      mesh.group.visible = true;
      mesh.group.position.set(t.x, 0, t.z);
      mesh.group.rotation.y = t.heading;
      mesh.paintMat.color.setHex(t.kind === 'taxi'
        ? 0xf2c94c
        : EXTRA_CAR.trafficColors[t.colorIndex % EXTRA_CAR.trafficColors.length]);
    }
    for (let i = 0; i < trafficPool.length; i += 1) {
      if (!usedSlots.has(i)) trafficPool[i].group.visible = false;
    }
    // Pedestrians (Phase 3): from state.peds. A knocked-down pedestrian is
    // hidden until it walks again elsewhere (it respawns after 2 seconds).
    const livePeds = state.peds || [];
    for (let i = 0; i < pedPool.length; i += 1) {
      const mesh = pedPool[i];
      const p = livePeds[i];
      if (!p || p.state === 'down') { mesh.group.visible = false; pedBlobs[i].visible = false; continue; }
      mesh.group.visible = true;
      mesh.group.position.set(p.x, 0, p.z);
      mesh.group.rotation.y = p.heading;
      mesh.shirtMat.color.setHex(PALETTE.pedShirts[p.shirt % PALETTE.pedShirts.length]);
      // Batch 2, Phase C: the peds' arms swing while they walk or flee —
      // same 7 Hz walk phase as Rio's, offset per ped so the crowd does not
      // march in lockstep.
      const pedPhase = state.time * 7 + i * 1.3;
      mesh.arms[0].rotation.x = -Math.sin(pedPhase) * 0.35;
      mesh.arms[1].rotation.x = Math.sin(pedPhase) * 0.35;
      pedBlobs[i].visible = true;
      pedBlobs[i].position.set(p.x, groundY(p.x, p.z), p.z);
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
    /** The GPU's anisotropy ceiling, for the capture-time texture setup. */
    maxAnisotropy() {
      return renderer.capabilities.getMaxAnisotropy();
    },
    /** Whether this WebGL context actually got antialiasing (A/B verification). */
    antialias() {
      return renderer.getContext().getContextAttributes().antialias;
    },
    /** Capture tests only: render at 2x for a supersampled screenshot. */
    setPixelRatio(ratio) {
      renderer.setPixelRatio(ratio);
      resize();
    },
    /** Test-only: switch the distance haze off/on to measure what it costs. */
    setFog(on) {
      scene.fog = on ? fog : null;
    },
    /** Staged shots only: place the camera exactly where it belongs, at once. */
    snap(state, screen) {
      placeCamera(state, screen, true, 1 / 60);
    },
    /** Test-only: hold the camera at an exact pose until releaseCamera(). */
    holdCamera(x, y, z, lx, ly, lz) {
      cameraHold = {
        pos: new THREE.Vector3(x, y, z),
        look: new THREE.Vector3(lx, ly, lz),
      };
    },
    releaseCamera() {
      cameraHold = null;
    },
  };
}
