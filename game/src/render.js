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
import { CAMERA, CAR, EXTRA_CAR, GAME, LIGHT, PALETTE, PLAYER, SIREN } from './config.js';
import { buildCar, mergeParts } from './car.js';

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
  // Rio P1 (rio-visual): skeleton proportions per RIO-AUDIT §2.1 — 1.80 m
  // envelope, head 1:7.5, hip-pivot legs, shoes as leg children. Render-only;
  // animation (draw) untouched — legs[] now holds pivot GROUPs, which the
  // existing rio.legs[i].rotation.x code already drives.
  const rio = new THREE.Group();
  rio.name = 'rio';
  const skin = new THREE.MeshLambertMaterial({ color: 0xe8b98a });
  const shirt = new THREE.MeshLambertMaterial({ color: PLAYER.shirtColor });
  const pants = new THREE.MeshLambertMaterial({ color: PLAYER.pantsColor });
  const cap = new THREE.MeshLambertMaterial({ color: PLAYER.color });
  const shoeMat = new THREE.MeshLambertMaterial({ color: PLAYER.shoeColor });
  const jacketMat = new THREE.MeshLambertMaterial({ color: PLAYER.jacketColor });
  // Rio P2: hair brown (pedestrian palette) + light sole (hubColor).
  const hairMat = new THREE.MeshLambertMaterial({ color: 0x2a2018 });
  const soleMat = new THREE.MeshLambertMaterial({ color: 0xc8ccd2 });
  // Helper for mergeParts(): a box part placed at (x, y, z) in the parent
  // group's space. Merging per material keeps the detail at 1 draw call.
  const part = (w, h, d, x, y, z) => ({
    geometry: new THREE.BoxGeometry(w, h, d),
    matrix: new THREE.Matrix4().makeTranslation(x, y, z),
  });
  const legs = [];
  for (const x of [-0.09, 0.09]) {
    // Leg pivot at the hip (y=0.95): the mesh hangs below the pivot, so the
    // swing rotates about the hip instead of the middle of the box.
    const leg = new THREE.Group();
    leg.position.set(x, 0.95, 0);
    // Rio P4: the leg is split at the knee (y=-0.475 rel hip) so the shin can
    // flex (kneeFlex, RIO-AUDIT §2.4). Thigh + shin are the same 0.14x0.95x0.16
    // column as P1 while the knee is straight — one extra mesh per leg.
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.475, 0.16), pants);
    thigh.position.y = -0.2375;
    thigh.castShadow = true;
    leg.add(thigh);
    const knee = new THREE.Group();
    knee.position.set(0, -0.475, 0);
    leg.add(knee);
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.475, 0.16), pants);
    shin.position.y = -0.2375;
    shin.castShadow = true;
    knee.add(shin);
    // Shoe as a CHILD of the knee (was a child of the hip pivot in P1/P2):
    // it now follows the knee flex instead of staying rigid with the thigh.
    // Offsets are the P2 ones shifted +0.475 into knee space; the bottom of
    // the stack still touches the ground exactly when the leg is straight.
    const shoe = new THREE.Mesh(mergeParts([
      part(0.15, 0.10, 0.28, 0, -0.395, 0.05),
      part(0.13, 0.08, 0.05, 0, -0.405, 0.195), // S3/S4 toe cap, front-proud
    ]), shoeMat);
    shoe.castShadow = true;
    knee.add(shoe);
    // Rio P2 (P1): light sole under the shoe — bottom flush with the ground,
    // top flush with the shoe bottom (sandwiched faces, no z-fighting).
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.03, 0.28), soleMat);
    sole.position.set(0, -0.46, 0.05);
    knee.add(sole);
    rio.add(leg);
    leg.knee = knee;
    legs.push(leg);
  }
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.54, 0.24), shirt);
  torso.position.y = 1.22;
  torso.castShadow = true;
  rio.add(torso);
  // Yellow jacket panel over the shirt: Rio's signature colour, visible at range.
  // Resized to the new torso (front face z=+0.12): panel back sits flush at
  // z=0.12, front at z=0.16.
  // Rio P2: the jacket is ONE merged mesh (front panel + back/side panels +
  // buckle, same yellow material — one draw call instead of five).
  const jacket = new THREE.Mesh(mergeParts([
    part(0.30, 0.42, 0.04, 0, 1.22, 0.14),   // front panel (P1, unchanged)
    part(0.30, 0.42, 0.04, 0, 1.22, -0.14),  // J1 back panel (P0)
    part(0.06, 0.42, 0.20, -0.21, 1.22, 0),  // J2 side panel L (P1)
    part(0.06, 0.42, 0.20, 0.21, 1.22, 0),   // J3 side panel R (P1)
    part(0.08, 0.05, 0.02, 0, 0.97, 0.14),   // B1 buckle on the belt (P2)
  ]), jacketMat);
  rio.add(jacket);
  // Rio P2 (P1): blue front pockets, one merged mesh.
  const pockets = new THREE.Mesh(mergeParts([
    part(0.10, 0.12, 0.02, -0.09, 1.08, 0.17),
    part(0.10, 0.12, 0.02, 0.09, 1.08, 0.17),
  ]), shirt);
  rio.add(pockets);
  // Rio P2 (P2): dark zipper down the middle of the front panel — embedded
  // 0.005 m, protruding 0.015 m.
  const zipper = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.36, 0.02), shoeMat);
  zipper.position.set(0, 1.22, 0.165);
  rio.add(zipper);
  // NEW neck: bridges torso top (1.49) to head bottom (1.53).
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.08, 0.09), skin);
  neck.position.y = 1.53;
  rio.add(neck);
  // Rio P3: ears merge into the head mesh (same skin material, RIO-AUDIT
  // §2.3: 0.018x0.06x0.04 at (+/-0.103, 1.65, 0) — 1 mm embedded in the head
  // side so no faces are coplanar).
  const head = new THREE.Mesh(mergeParts([
    part(0.19, 0.24, 0.21, 0, 1.65, 0),
    part(0.018, 0.06, 0.04, -0.103, 1.65, 0),
    part(0.018, 0.06, 0.04, 0.103, 1.65, 0),
  ]), skin);
  head.castShadow = true;
  rio.add(head);
  // Rio P2 (P0): the temporary slab cap is REPLACED by a dome + brim
  // (mockup dims). Dome: sphere r 0.105, scaleY 0.43, centre y 1.755 —
  // peak 1.80 m; its lower half hides inside the head. One merged mesh.
  const capMesh = new THREE.Mesh(mergeParts([
    {
      geometry: new THREE.SphereGeometry(0.105, 8, 4),
      matrix: new THREE.Matrix4().compose(
        new THREE.Vector3(0, 1.755, 0),
        new THREE.Quaternion(),
        new THREE.Vector3(1, 0.43, 1)),
    },
    part(0.16, 0.015, 0.08, 0, 1.745, 0.13), // C2 brim
  ]), cap);
  rio.add(capMesh);
  // Rio P2 (P0): brown hair — back mass + sideburns + fringe, one merged
  // mesh (mockup dims; the back mass is the gameplay read from behind).
  const hair = new THREE.Mesh(mergeParts([
    part(0.20, 0.18, 0.05, 0, 1.66, -0.13),   // H1 back mass
    part(0.02, 0.12, 0.06, -0.10, 1.62, 0.02), // H2 sideburn L
    part(0.02, 0.12, 0.06, 0.10, 1.62, 0.02),  // H3 sideburn R
    part(0.19, 0.03, 0.02, 0, 1.755, 0.11),   // H4 fringe
  ]), hairMat);
  rio.add(hair);
  // Rio P3: geometric face (RIO-AUDIT §2.3, rescaled for the new head
  // 0.19x0.24x0.21, front z=+0.105). All MeshLambertMaterial, no castShadow.
  // The two temporary P1 eye boxes are REPLACED, not stacked. Merged per
  // material (pattern from car.js / P2) so the face costs 5 meshes, not 10.
  // Deviations from the audit table (1-5 mm, anti-z-fight + fringe):
  // - brow y 1.735 -> 1.73: fringe H4 bottom is y=1.74, so the audit brow
  //   top (1.7415) would tuck 1.5 mm under the fringe; at 1.73 the brow
  //   top (1.7365) clears it by 3.5 mm and stays readable in close-up.
  // - brow/mouth z 0.111 -> 0.110: their backs would sit exactly coplanar
  //   with the head front (z=0.105); 1 mm embed, same as the P2 zipper.
  // - ear x +/-0.104 -> +/-0.103: inner face would sit exactly on the head
  //   side plane (x=+/-0.095); 1 mm embed. Ears merge into the head mesh
  //   (same skin material) — no extra draw call.
  const whiteMat = new THREE.MeshLambertMaterial({ color: 0xf5f2ea });
  const faceWhites = new THREE.Mesh(mergeParts([
    part(0.045, 0.04, 0.012, -0.048, 1.68, 0.11),
    part(0.045, 0.04, 0.012, 0.048, 1.68, 0.11),
  ]), whiteMat);
  rio.add(faceWhites);
  const pupilMat = new THREE.MeshLambertMaterial({ color: 0x14100c });
  const facePupils = new THREE.Mesh(mergeParts([
    part(0.02, 0.026, 0.008, -0.048, 1.68, 0.117),
    part(0.02, 0.026, 0.008, 0.048, 1.68, 0.117),
  ]), pupilMat);
  rio.add(facePupils);
  const browMat = new THREE.MeshLambertMaterial({ color: 0x2a1a10 });
  const faceBrows = new THREE.Mesh(mergeParts([
    part(0.055, 0.013, 0.012, -0.048, 1.73, 0.11),
    part(0.055, 0.013, 0.012, 0.048, 1.73, 0.11),
  ]), browMat);
  rio.add(faceBrows);
  const noseMat = new THREE.MeshLambertMaterial({ color: 0xc98f5f });
  const faceNose = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.03), noseMat);
  faceNose.position.set(0, 1.645, 0.115);
  rio.add(faceNose);
  const mouthMat = new THREE.MeshLambertMaterial({ color: 0x7a2e22 });
  const faceMouth = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.016, 0.012), mouthMat);
  faceMouth.position.set(0, 1.585, 0.11);
  rio.add(faceMouth);
  // Belt resized to the new torso (old 0.60 did not fit torso 0.40): sits at
  // the hip, y=0.97, overlapping the torso bottom (0.95) slightly.
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.07, 0.26), shoeMat);
  belt.position.y = 0.97;
  rio.add(belt);
  // Collar resized to the new torso (top now 1.49): 0.26 x 0.08 x 0.28 at
  // y=1.48, wrapping the neck base; slightly deeper than the torso (0.24)
  // so it reads as a rim.
  const collar = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.28), jacketMat);
  collar.position.y = 1.48;
  rio.add(collar);
  const arms = [];
  for (const x of [-0.21, 0.21]) {
    const arm = new THREE.Group();
    arm.position.set(x, 1.44, 0);
    // Rio P4: split at the elbow (y=-0.345 rel shoulder) so the forearm can
    // flex (elbow 0.55 +/- 0.25, RIO-AUDIT §2.4). Same 0.13x0.69x0.15 sleeve
    // as P1 while the elbow is straight — one extra mesh per arm.
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.345, 0.15), jacketMat);
    upper.position.y = -0.1725;
    upper.castShadow = true;
    arm.add(upper);
    const elbow = new THREE.Group();
    elbow.position.set(0, -0.345, 0);
    arm.add(elbow);
    const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.345, 0.15), jacketMat);
    forearm.position.y = -0.1725;
    forearm.castShadow = true;
    elbow.add(forearm);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.11), skin);
    hand.position.y = -0.40;
    elbow.add(hand);
    // Rio P2 (P1): blue cuff at the wrist — 0.005 m below the sleeve bottom
    // so no faces are coplanar with the sleeve/hand.
    const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.14), shirt);
    cuff.position.y = -0.31;
    elbow.add(cuff);
    rio.add(arm);
    arm.elbow = elbow;
    arms.push(arm);
  }
  // Rio P4: the head meshes, as one turnable set for the idle head-turn.
  // Every part is centred on the rio Y axis, so rotation.y spins each in
  // place — no head group or geometry move needed.
  const headParts = [head, capMesh, hair, faceWhites, facePupils, faceBrows, faceNose, faceMouth];
  // Lean (rotation.x) must act in the body's own frame after the heading:
  // YXZ composes Ry * Rx, so the forward lean follows the facing direction.
  rio.rotation.order = 'YXZ';
  return { group: rio, legs, arms, head: headParts };
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
  // Siren S2a: one shared radial-gradient texture (white centre -> transparent
  // edge), drawn once at load, shared by every halo + pool sprite. Deterministic
  // (no random), no external asset, no per-frame upload.
  const sirenTexture = (() => {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();

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
  const hemi = new THREE.HemisphereLight(0xbcd8f0, 0xb8c4d8, LIGHT.hemiIntensity);
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
  // F2.11: traffic-signal cycle metadata (avenue A/B + lens 0/1/2 per
  // instance, in traffic-lenses order) + the cached lens mesh + a scratch
  // colour. The mesh is looked up lazily in draw() — the city joins the
  // scene after createRenderer returns, so it is not there yet here.
  const lensMeta = options.trafficLensMeta || null;
  let lensMesh = null;
  const lensColor = new THREE.Color();
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
  // F4 V4: makeBlob takes separate X/Z radii so the hero blob can be an
  // ellipse (1.15 x 2.5 m = 2.3 x 5.0 m) instead of a 4.8 m disc.
  // Orientation: scale is applied in the circle's local XY plane BEFORE
  // rotation.x = -PI/2 lays it flat, so scale (1.15, 2.5) puts the LONG
  // axis along world Z. The blob mesh is scene-level (not a child of the
  // car group), so it must be spun to the car's heading itself: with
  // Euler order XYZ the rotation.z spins the ellipse in its own plane
  // before the X-rotation, and rotation.z = -heading aligns the 2.5 m
  // axis with the car's forward direction (verified: heading PI/2 ->
  // long axis along +X). The per-frame rotation.z assignments live in
  // draw() next to each blob's position.set. Circular blobs (Rio, peds)
  // need no rotation.
  const makeBlob = (rx, rz = rx) => {
    const b = new THREE.Mesh(blobGeo, blobMat);
    b.rotation.x = -Math.PI / 2;
    b.scale.set(rx, rz, 1);
    b.renderOrder = 1;
    scene.add(b);
    return b;
  };
  const carBlob = makeBlob(1.15, 2.5);
  const rioBlob = makeBlob(0.55);
  const pedBlobs = pedPool.map(() => makeBlob(0.45));
  // F4 V4: one blob per live police cruiser + live traffic car (11),
  // same shared geometry/material as the other blobs (16 tri each).
  const policeBlobs = policePool.map(() => makeBlob(1.15, 2.5));
  const trafficBlobs = trafficPool.map(() => makeBlob(1.15, 2.5));
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
  // Siren S2b: one halo + one pool per cruiser (3 live + 2 staged), following
  // the blob pattern (MeshBasicMaterial, transparent, depthWrite off,
  // renderOrder 1) — only the blending is additive and the colour follows the
  // flash phase. Each sprite has its own material (opacity fades per cruiser)
  // but all share the one gradient texture. Halo: a yaw-only billboard over
  // the light bar. Pool: a flat ellipse on the asphalt under the cruiser,
  // long axis along the car (poolSize [length, width]: the plane's local Y
  // becomes world Z after the X-rotation, so scale.y carries the length).
  const sirenHaloGeo = new THREE.PlaneGeometry(SIREN.haloSize, SIREN.haloSize);
  const sirenPoolGeo = new THREE.PlaneGeometry(1, 1);
  const makeSirenSprite = (isPool) => {
    const mat = new THREE.MeshBasicMaterial({
      map: sirenTexture,
      transparent: true,
      opacity: isPool ? SIREN.poolOpacity : SIREN.haloOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const m = new THREE.Mesh(isPool ? sirenPoolGeo : sirenHaloGeo, mat);
    if (isPool) {
      m.rotation.x = -Math.PI / 2;
      m.scale.set(SIREN.poolSize[1], SIREN.poolSize[0], 1);
    }
    m.renderOrder = 1;
    m.visible = false;
    scene.add(m);
    return m;
  };
  const policeHalos = policePool.map(() => makeSirenSprite(false));
  const policePools = policePool.map(() => makeSirenSprite(true));
  const extraPoliceHalos = extraPolicePool.map(() => makeSirenSprite(false));
  const extraPolicePools = extraPolicePool.map(() => makeSirenSprite(true));
  // Siren S1 scratch: each police car owns its lens materials, so the OFF
  // colour scale is cached per material (first use) and never compounds.
  const lampBaseColor = new Map();
  const sirenColor = new THREE.Color();
  const setLamp = (lamp, on) => {
    let base = lampBaseColor.get(lamp.material);
    if (!base) {
      base = lamp.material.color.clone();
      lampBaseColor.set(lamp.material, base);
    }
    lamp.material.emissiveIntensity = on ? SIREN.onEmissive : SIREN.offEmissive;
    if (on) lamp.material.color.copy(base);
    else lamp.material.color.copy(base).multiplyScalar(SIREN.offColorScale);
  };

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
    // F1 (L1): sun swung ~40 deg south so it crosses the E-W streets
    // diagonally instead of running parallel to them — shadows fall
    // DIAGONAL across the road (pattern, not mass). Elevation ~37 deg,
    // unchanged in spirit (36.4 -> 37.2 deg); target, shadow map,
    // frustum and bias untouched.
    sun.position.set(target.x - 120, 140, target.z + 140);
    sun.target.position.set(target.x, 0, target.z);
    // F1 (L2): the fill is now LOW (~31 deg) and COOL, modelling walls
    // rather than flooding the road from 62 deg; intensity 0.45.
    fill.position.set(target.x + 140, 90, target.z - 60);
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

  // Rio P4 (RIO-AUDIT §2.4): phase-from-distance animation state. It lives
  // HERE, in render.js, accumulated from the player position each frame —
  // never in world.js — so the sim (S0–S7) cannot change. The gait cycle is
  // derived from the sim speeds (walk 5 / run 9 m/s, config.js, read-only):
  // jog cycle = 2π·5/13 = 2.416 m, sprint cycle = 2π·9/19 = 2.977 m.
  // cycle >= 2·step (audit condition): jog 2.416 >= 2.300, sprint 2.977 >= 2.590.
  const RIO_CYCLE_JOG = (2 * Math.PI * PLAYER.walkSpeed) / 13;
  const RIO_CYCLE_SPRINT = (2 * Math.PI * PLAYER.runSpeed) / 19;
  let rioPhase = 0;
  let rioBlend = 0;
  let rioPrevX = null;
  let rioPrevZ = null;
  let rioPrevMode = null;

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
    carBlob.rotation.z = -state.car.heading;
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
    // Rio P4 (RIO-AUDIT §2.4): phase from DISTANCE, not time. The phase
    // advances with the ground the player actually covers, so the stride
    // stays in sync with the body at any frame rate; the old time-based
    // phase (7/11 rad/s) slid 3.29/6.31 m/s. A mode change (enter/exit,
    // bust respawn, shot staging) teleports the player, so the old position
    // baseline is discarded on it; a single-frame jump longer than
    // runSpeed * dt is a teleport the mode change did not catch and is
    // ignored instead of spinning the phase.
    const rioRunning = state.player.running;
    const rioCycle = rioRunning ? RIO_CYCLE_SPRINT : RIO_CYCLE_JOG;
    let rioDist = 0;
    if (state.mode !== rioPrevMode) {
      rioPrevMode = state.mode;
      rioPrevX = state.player.x;
      rioPrevZ = state.player.z;
    } else if (state.mode === 'foot' && state.player.moving && rioPrevX !== null) {
      rioDist = Math.hypot(state.player.x - rioPrevX, state.player.z - rioPrevZ);
      const rioMaxStep = PLAYER.runSpeed * Math.max(dt, 1 / 60) + 0.05;
      if (rioDist > rioMaxStep) rioDist = 0;
      rioPrevX = state.player.x;
      rioPrevZ = state.player.z;
    } else {
      rioPrevX = state.player.x;
      rioPrevZ = state.player.z;
    }
    rioPhase += (rioDist * 2 * Math.PI) / rioCycle;
    // moveBlend eases 0 <-> 1 so stopping never snaps the limbs (the old
    // code reset 0.376 rad in one frame). tau = 0.30 s: the audit's ~=0.125 s
    // would step the knee 0.11 rad in one 60 fps frame, failing gate 6.9
    // (<=0.05 rad/frame); 0.30 s keeps the largest joint step (knee 0.9 rad)
    // at 0.9 * (1 - exp(-1/(60*0.30))) = 0.049 rad/frame.
    const rioTarget = state.mode === 'foot' && state.player.moving ? 1 : 0;
    rioBlend += (rioTarget - rioBlend) * (1 - Math.exp(-Math.max(dt, 1 / 60) / 0.30));
    const ph = rioPhase;
    const b = rioBlend;
    const s = Math.sin(ph);
    const c = Math.cos(ph);
    // Jog (5 m/s) vs sprint (9 m/s): same formulas, gait constants differ.
    const A = rioRunning ? 0.75 : 0.65;      // leg swing amplitude (rad)
    const K = rioRunning ? 0.9 : 0.6;        // knee flex (rad)
    const bobA = rioRunning ? 0.04 : 0.025;  // vertical bob (m)
    const leanA = rioRunning ? 0.16 : 0.08;  // forward lean (rad)
    rio.legs[0].rotation.x = b * A * s;
    rio.legs[1].rotation.x = -b * A * s;
    // Knee flexes only while its leg swings forward (foot off the ground);
    // straight through stance, so the foot plants instead of dragging.
    rio.legs[0].knee.rotation.x = b * K * Math.max(0, -c);
    rio.legs[1].knee.rotation.x = b * K * Math.max(0, c);
    // Arms swing against the legs (Batch 2, Phase C); elbows stay bent and
    // flex more while the arm swings forward. 0.08 rad of bend at idle so
    // the arms never hang perfectly straight.
    rio.arms[0].rotation.x = -b * 0.4 * s;
    rio.arms[1].rotation.x = b * 0.4 * s;
    rio.arms[0].elbow.rotation.x = -(0.08 + b * (0.47 + 0.25 * s));
    rio.arms[1].elbow.rotation.x = -(0.08 + b * (0.47 - 0.25 * s));
    // Bob peaks at double support (|cos|); breathing lifts the body 0–8 mm
    // at 0.25 Hz when idle — one-sided so the feet never sink below ground.
    const t = state.time;
    const bob = b * bobA * Math.abs(c);
    const breath = (1 - b) * 0.008 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.25 * t));
    rio.group.position.y = bob + breath;
    rio.group.rotation.x = b * leanA;
    // Idle head-turn: slow look-around, 0.3 rad at 0.5 rad/s (12.6 s period).
    const headTurn = (1 - b) * 0.3 * Math.sin(0.5 * t);
    for (let i = 0; i < rio.head.length; i += 1) rio.head[i].rotation.y = headTurn;

    // Police light bars flash on game time, so a staged shot (fixed time) shows
    // one steady phase. The same phase drives live cruisers and staged ones.
    const flashRed = Math.floor(state.time * 4) % 2 === 0;
    // F2.11: traffic signals cycle on game time (12 s): Avenue A green
    // 0-5, yellow 5-6, red 6-12; Avenue B is the opposite phase (red 0-6,
    // green 6-11, yellow 11-12). Pure function of state.time, so staged
    // shots are deterministic; 126 setColorAt per frame, one buffer upload.
    if (lensMeta) {
      if (!lensMesh) lensMesh = scene.getObjectByName('traffic-lenses');
      if (lensMesh) {
        const t = ((state.time % 12) + 12) % 12;
        for (let i = 0; i < lensMeta.length; i += 1) {
          const m = lensMeta[i];
          // Phase per avenue: 0 red, 1 yellow, 2 green.
          const phase = m.avenue === 'A'
            ? (t < 5 ? 2 : t < 6 ? 1 : 0)
            : (t < 6 ? 0 : t < 11 ? 2 : 1);
          const lit = m.lens === phase;
          lensColor.setHex(lit
            ? (m.lens === 0 ? 0xff3a2a : m.lens === 1 ? 0xffb020 : 0x2aff5a)
            : 0x1a1a1a);
          lensMesh.setColorAt(i, lensColor);
        }
        if (lensMesh.instanceColor) lensMesh.instanceColor.needsUpdate = true;
      }
    }
    // Siren S1: lens contrast — the OFF lens reads dark (emissive 0.05 +
    // diffuse colour x0.35) and the ON lens hot (emissive 2.2). The 2 Hz
    // pattern and synchronous phase are unchanged.
    const flash = (mesh) => {
      if (mesh.redLamp && mesh.blueLamp) {
        setLamp(mesh.redLamp, flashRed);
        setLamp(mesh.blueLamp, !flashRed);
      }
    };
    // Siren S2c: halo + pool follow one cruiser. Colour = the current flash
    // phase (shared by all cruisers — synchronous 2 Hz); opacity fades
    // linearly with cruiser–camera distance (full to 40 m, zero at 90 m).
    // Positions/colours update in place — no allocation per frame. The halo
    // sits on the light bar (roof 1.30 + 0.28, peak 1.69 m) as a yaw-only
    // billboard; a plane's +Z normal must point AT the camera, i.e. opposite
    // the look direction, so rotation.y = cameraYaw() + PI (not cameraYaw()
    // itself — that would face the normal away and backface-cull the halo).
    const updateSiren = (halo, pool, x, z, heading) => {
      sirenColor.setHex(flashRed ? EXTRA_CAR.policeLightRed : EXTRA_CAR.policeLightBlue);
      const dist = Math.hypot(x - camera.position.x, z - camera.position.z);
      const fade = dist <= SIREN.fadeNear ? 1 : dist >= SIREN.fadeFar ? 0
        : 1 - (dist - SIREN.fadeNear) / (SIREN.fadeFar - SIREN.fadeNear);
      halo.position.set(x - 0.35 * Math.sin(heading), 1.7, z - 0.35 * Math.cos(heading));
      halo.rotation.y = cameraYaw() + Math.PI;
      halo.material.color.copy(sirenColor);
      halo.material.opacity = SIREN.haloOpacity * fade;
      halo.visible = fade > 0;
      pool.position.set(x, groundY(x, z) + 0.02, z);
      pool.rotation.z = -heading;
      pool.material.color.copy(sirenColor);
      pool.material.opacity = SIREN.poolOpacity * fade;
      pool.visible = fade > 0;
    };
    const hideSiren = (halo, pool) => {
      halo.visible = false;
      pool.visible = false;
    };
    // Live cruisers (Phase 3): chase, ram, search — from state.police.
    const livePolice = state.police || [];
    for (let i = 0; i < policePool.length; i += 1) {
      const mesh = policePool[i];
      const p = livePolice[i];
      // F4 V4: cruiser blob follows the cruiser; hidden with it.
      if (!p) { mesh.group.visible = false; policeBlobs[i].visible = false; hideSiren(policeHalos[i], policePools[i]); continue; }
      mesh.group.visible = true;
      mesh.group.position.set(p.x, 0, p.z);
      mesh.group.rotation.y = p.heading;
      policeBlobs[i].visible = true;
      policeBlobs[i].position.set(p.x, groundY(p.x, p.z), p.z);
      policeBlobs[i].rotation.z = -p.heading;
      flash(mesh);
      updateSiren(policeHalos[i], policePools[i], p.x, p.z, p.heading);
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
      // F4 V4: traffic blob follows the slot's car.
      trafficBlobs[slot].visible = true;
      trafficBlobs[slot].position.set(t.x, groundY(t.x, t.z), t.z);
      trafficBlobs[slot].rotation.z = -t.heading;
      mesh.paintMat.color.setHex(t.kind === 'taxi'
        ? 0xf2c94c
        : EXTRA_CAR.trafficColors[t.colorIndex % EXTRA_CAR.trafficColors.length]);
    }
    for (let i = 0; i < trafficPool.length; i += 1) {
      if (!usedSlots.has(i)) { trafficPool[i].group.visible = false; trafficBlobs[i].visible = false; }
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
      if (extra.kind === 'police') updateSiren(extraPoliceHalos[slot], extraPolicePools[slot], extra.x, extra.z, extra.heading);
    }
    for (let i = extraPoliceSeen; i < extraPolicePool.length; i += 1) { extraPolicePool[i].group.visible = false; hideSiren(extraPoliceHalos[i], extraPolicePools[i]); }
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

/**
 * F1 (glass swap): replace the city's Lambert window/storefront glass with
 * MeshStandardMaterial so the panes can reflect the PMREM environment.
 * Browser-only (render.js never loads in the Node stub, which has no
 * MeshStandardMaterial) — city.js stays 100% Lambert. Idempotent: a mesh
 * whose material is already Standard is left alone, so calling this twice
 * is a no-op. instanceColor is NOT touched (it lives on the InstancedMesh,
 * not the material), so the per-pane lit/unlit colours survive the swap.
 * Called exactly once from main.js, after the city group joins the scene.
 */
export function applyGlassMaterials(scene) {
  const windows = scene.getObjectByName('windows');
  if (windows && !windows.material.isMeshStandardMaterial) {
    const old = windows.material;
    windows.material = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.12, metalness: 0.1, envMapIntensity: 1.2,
    });
    old.dispose();
  }
  const storefront = scene.getObjectByName('storefront-glass');
  if (storefront && !storefront.material.isMeshStandardMaterial) {
    const old = storefront.material;
    storefront.material = new THREE.MeshStandardMaterial({
      color: 0x4a6a8a, roughness: 0.12, metalness: 0.1, envMapIntensity: 1.2,
      // F2 (§10 Q2, opsi b): opacity 0,45 -> 0,35 — emissive interior 0,9
      // saja TIDAK cukup (pane sunlit R-B +19 -> +9, shaded -2 -> -8);
      // kaca 0,45 memudarkan interior hangat jadi abu-hijau netral.
      // Hanya mesh storefront-glass yang transparan (windows opaque),
      // jadi perubahan ini tidak menyentuh kaca jendela / kriteria 5.8.
      transparent: true, opacity: 0.35,
    });
    old.dispose();
  }
}
