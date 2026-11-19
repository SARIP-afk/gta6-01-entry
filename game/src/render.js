// Drawing only: the world's state in, pixels out. The city is merged into a handful
// of meshes (buildings, lit windows, palms, lamps, signs), traffic and pedestrians
// are InstancedMesh pools, and the hero car and Rio are the only articulated groups.
// No sim lives here: positions come from state, and the camera just follows them.
import * as THREE from '../vendor/three.module.min.js';
import { CITY, PALETTE, CAR_MODELS } from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

/** Merge a list of transformed boxes into one vertex-coloured geometry. */
function mergeBoxes(parts) {
  const pos = [];
  const norm = [];
  const col = [];
  const color = new THREE.Color();
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  for (const p of parts) {
    const geo = new THREE.BoxGeometry(p.w, p.h, p.d);
    euler.set(p.rx || 0, p.ry || 0, p.rz || 0);
    quat.setFromEuler(euler);
    matrix.compose(new THREE.Vector3(p.x, p.y, p.z), quat, new THREE.Vector3(1, 1, 1));
    geo.applyMatrix4(matrix);
    const nonIndexed = geo.toNonIndexed();
    const pa = nonIndexed.attributes.position.array;
    const na = nonIndexed.attributes.normal.array;
    color.setHex(p.color);
    for (let i = 0; i < pa.length; i += 3) {
      pos.push(pa[i], pa[i + 1], pa[i + 2]);
      norm.push(na[i], na[i + 1], na[i + 2]);
      col.push(color.r, color.g, color.b);
    }
    geo.dispose();
    nonIndexed.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

function roadTexture(city) {
  const S = 1024;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d');
  // The plane spans x -364..476 (the pier and the sea sit east of the grid)
  // and z -364..364. The square texture maps each axis to its own span.
  const X0 = -364;
  const Z0 = -364;
  const toX = (v) => ((v - X0) / 840) * S;
  const toZ = (v) => ((v - Z0) / 728) * S;
  g.fillStyle = '#8a7a5c';
  g.fillRect(0, 0, S, S);
  // Beach sand on the south strip, sea blue past the pier.
  g.fillStyle = '#d9b380';
  g.fillRect(0, toZ(208), S, S - toZ(208));
  g.fillStyle = '#2e6f8e';
  g.fillRect(toX(CITY.pier.x + 10), 0, S - toX(CITY.pier.x + 10), S);
  // Asphalt roads with centre dashes.
  for (const r of city.roads) {
    g.fillStyle = '#3a3f46';
    g.fillRect(0, toZ(r) - 6 / 728 * S, S, 12 / 728 * S);
    g.fillRect(toX(r) - 6 / 840 * S, 0, 12 / 840 * S, S);
    g.fillStyle = '#f2c94c';
    for (let v = CITY.gridMin; v < CITY.gridMax; v += 16) {
      g.fillRect(toX(v), toZ(r) - 1, 8 / 840 * S, 2);
      g.fillRect(toX(r) - 1, toZ(v), 2, 8 / 728 * S);
    }
  }
  // Causeway to the pier.
  g.fillStyle = '#3a3f46';
  g.fillRect(toX(CITY.gridMax), toZ(-6) - 6 / 728 * S, toX(CITY.pier.x + 20) - toX(CITY.gridMax), 12 / 728 * S);
  g.fillStyle = '#7a6a4c';
  g.fillRect(toX(CITY.pier.x - 14), toZ(-22), 28 / 840 * S, 44 / 728 * S);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  return tex;
}

function signTexture(text, sub) {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 160;
  const g = cv.getContext('2d');
  g.fillStyle = '#1d2733';
  g.fillRect(0, 0, 512, 160);
  g.strokeStyle = '#f2c94c';
  g.lineWidth = 6;
  g.strokeRect(8, 8, 496, 144);
  g.fillStyle = '#f5f0e6';
  g.font = 'bold 54px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 66);
  g.fillStyle = '#f2c94c';
  g.font = 'bold 30px system-ui, sans-serif';
  g.fillText(sub, 256, 122);
  return new THREE.CanvasTexture(cv);
}

export function createRenderer(canvas, city) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 260, 1100);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);

  const hemi = new THREE.HemisphereLight(0xffe0b3, 0x8a6a4a, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd9a0, 1.6);
  sun.position.set(-120, 180, 60);
  scene.add(sun);

  // Ground: one road-textured plane over the whole playable area, pier included.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(840, 728),
    new THREE.MeshLambertMaterial({ map: roadTexture(city) }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(56, 0, 0);
  scene.add(ground);

  // Buildings: solid boxes + a lit-window layer, both merged to one mesh each.
  const solids = [];
  const windows = [];
  for (const b of city.buildings) {
    solids.push({ x: b.x, y: b.h / 2, z: b.z, w: b.w, h: b.h, d: b.d, color: b.color });
    solids.push({ x: b.x, y: b.h + 0.4, z: b.z, w: b.w * 0.7, h: 0.8, d: b.d * 0.7, color: 0x5a4a3a });
    if (b.lit) {
      const floors = Math.max(1, Math.floor(b.h / 6));
      for (let f = 0; f < floors; f += 1) {
        windows.push({ x: b.x - b.w / 2 - 0.05, y: 3 + f * 6, z: b.z, w: 0.1, h: 1.6, d: Math.min(3, b.d * 0.5), color: PALETTE.windowLit });
        windows.push({ x: b.x + b.w / 2 + 0.05, y: 3 + f * 6, z: b.z, w: 0.1, h: 1.6, d: Math.min(3, b.d * 0.5), color: PALETTE.windowLit });
      }
    }
  }
  // The pier deck and posts, merged with the buildings.
  solids.push({ x: CITY.pier.x, y: 0.6, z: -6, w: 30, h: 1.2, d: 46, color: 0x7a6a4c });
  const buildingMesh = new THREE.Mesh(mergeBoxes(solids), new THREE.MeshLambertMaterial({ vertexColors: true }));
  scene.add(buildingMesh);
  const windowMesh = new THREE.Mesh(mergeBoxes(windows), new THREE.MeshBasicMaterial({ vertexColors: true }));
  scene.add(windowMesh);

  // Palms: trunks and fronds, merged.
  const trunks = [];
  const fronds = [];
  for (const p of city.palms) {
    trunks.push({ x: p.x, y: p.h / 2, z: p.z, w: 0.5, h: p.h, d: 0.5, color: PALETTE.palmTrunk, rz: p.lean });
    for (let f = 0; f < 5; f += 1) {
      const a = (f / 5) * Math.PI * 2;
      fronds.push({
        x: p.x + Math.cos(a) * 1.4, y: p.h + 0.3, z: p.z + Math.sin(a) * 1.4,
        w: 2.6, h: 0.12, d: 0.9, color: PALETTE.palmLeaf, ry: -a,
      });
    }
  }
  scene.add(new THREE.Mesh(mergeBoxes(trunks), new THREE.MeshLambertMaterial({ vertexColors: true })));
  scene.add(new THREE.Mesh(mergeBoxes(fronds), new THREE.MeshLambertMaterial({ vertexColors: true })));

  // Lamps: one merged mesh of poles with warm heads.
  const lampParts = [];
  for (const l of city.lamps) {
    lampParts.push({ x: l.x, y: 2.5, z: l.z, w: 0.25, h: 5, d: 0.25, color: 0x2c313a });
    lampParts.push({ x: l.x, y: 5.1, z: l.z, w: 0.9, h: 0.3, d: 0.9, color: PALETTE.windowLit });
  }
  scene.add(new THREE.Mesh(mergeBoxes(lampParts), new THREE.MeshLambertMaterial({ vertexColors: true })));

  // Landmark signs: canvas-textured planes on posts.
  for (const s of city.signs) {
    const tex = signTexture(s.text, s.sub);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 5.6),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }),
    );
    plane.position.set(s.x, 7.5, s.z);
    plane.rotation.y = s.x > 200 ? -Math.PI / 2 : 0;
    scene.add(plane);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7.5, 0.5), new THREE.MeshLambertMaterial({ color: 0x2c313a }));
    post.position.set(s.x, 3.75, s.z);
    scene.add(post);
  }

  // Sun disc and a few flat clouds.
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(34, 24), new THREE.MeshBasicMaterial({ color: 0xfff2c0, fog: false }));
  sunDisc.position.set(-420, 150, -300);
  sunDisc.lookAt(0, 40, 0);
  scene.add(sunDisc);
  const cloudParts = [];
  for (let i = 0; i < 10; i += 1) {
    cloudParts.push({ x: -300 + i * 70, y: 120 + (i % 3) * 14, z: -260 + (i % 4) * 90, w: 46, h: 4, d: 16, color: 0xfff4e0 });
  }
  scene.add(new THREE.Mesh(mergeBoxes(cloudParts), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false })));

  // Hero car: one group of boxes, recoloured when Rio steals another model.
  const hero = new THREE.Group();
  const heroBodyMat = new THREE.MeshLambertMaterial({ color: CAR_MODELS[0].color });
  const heroBody = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.85, 1.9), heroBodyMat);
  heroBody.position.y = 0.75;
  hero.add(heroBody);
  const heroCabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 1.7), new THREE.MeshLambertMaterial({ color: 0x22303c }));
  heroCabin.position.set(-0.2, 1.5, 0);
  hero.add(heroCabin);
  const heroSpoiler = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 1.9), new THREE.MeshLambertMaterial({ color: 0x222222 }));
  heroSpoiler.position.set(-2.1, 1.35, 0);
  hero.add(heroSpoiler);
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.35, 10);
  wheelGeo.rotateX(Math.PI / 2);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x14181d });
  const heroWheels = [];
  for (const [wx, wz] of [[1.4, 0.85], [1.4, -0.85], [-1.4, 0.85], [-1.4, -0.85]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(wx, 0.42, wz);
    hero.add(w);
    heroWheels.push(w);
  }
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff6c0 });
  for (const hz of [0.6, -0.6]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.25, 0.4), headMat);
    h.position.set(2.22, 0.8, hz);
    hero.add(h);
  }
  scene.add(hero);

  // Rio on foot: jacket, head, hair, swinging limbs.
  const rio = new THREE.Group();
  const rioParts = {};
  function rioBox(w, h, d, color, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
    m.position.set(x, y, z);
    rio.add(m);
    return m;
  }
  rioParts.torso = rioBox(0.72, 0.95, 0.42, 0xd94f3d, 0, 1.25, 0);
  rioParts.head = rioBox(0.4, 0.4, 0.38, 0xd9a986, 0, 1.95, 0);
  rioParts.hair = rioBox(0.44, 0.16, 0.42, 0x1d1a16, 0, 2.2, 0);
  rioParts.armL = rioBox(0.2, 0.8, 0.2, 0xd94f3d, -0.48, 1.25, 0);
  rioParts.armR = rioBox(0.2, 0.8, 0.2, 0xd94f3d, 0.48, 1.25, 0);
  rioParts.legL = rioBox(0.26, 0.85, 0.26, 0x2c313a, -0.18, 0.42, 0);
  rioParts.legR = rioBox(0.26, 0.85, 0.26, 0x2c313a, 0.18, 0.42, 0);
  scene.add(rio);

  // Traffic: three InstancedMesh pools (body, cabin, wheels x4).
  const MAX_CARS = 34;
  const bodyGeo = new THREE.BoxGeometry(4.4, 0.85, 1.9);
  const cabinGeo = new THREE.BoxGeometry(2.2, 0.7, 1.7);
  const wheelGeoI = new THREE.BoxGeometry(0.7, 0.7, 0.35);
  const trafficBodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), MAX_CARS);
  const trafficCabins = new THREE.InstancedMesh(cabinGeo, new THREE.MeshLambertMaterial({ color: 0x22303c }), MAX_CARS);
  const trafficWheels = new THREE.InstancedMesh(wheelGeoI, new THREE.MeshLambertMaterial({ color: 0x14181d }), MAX_CARS * 4);
  trafficBodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  trafficCabins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  trafficWheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(trafficBodies);
  scene.add(trafficCabins);
  scene.add(trafficWheels);

  // Police: white bodies, red and blue light bars that flash on alternate beats.
  const MAX_UNITS = 6;
  const policeBodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }), MAX_UNITS);
  const policeCabins = new THREE.InstancedMesh(cabinGeo, new THREE.MeshLambertMaterial({ color: 0x22303c }), MAX_UNITS);
  const lightGeo = new THREE.BoxGeometry(1.0, 0.22, 1.2);
  const policeRed = new THREE.InstancedMesh(lightGeo, new THREE.MeshBasicMaterial({ color: 0xff2a2a }), MAX_UNITS);
  const policeBlue = new THREE.InstancedMesh(lightGeo, new THREE.MeshBasicMaterial({ color: 0x2a6bff }), MAX_UNITS);
  policeBodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  policeCabins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  policeRed.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  policeBlue.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(policeBodies);
  scene.add(policeCabins);
  scene.add(policeRed);
  scene.add(policeBlue);

  // Pedestrians: six InstancedMesh pools, one per body part.
  const MAX_PEDS = 54;
  const pedMats = {
    torso: new THREE.InstancedMesh(new THREE.BoxGeometry(0.72, 0.9, 0.4), new THREE.MeshLambertMaterial({ color: 0xffffff }), MAX_PEDS),
    head: new THREE.InstancedMesh(new THREE.BoxGeometry(0.38, 0.38, 0.36), new THREE.MeshLambertMaterial({ color: 0xd9a986 }), MAX_PEDS),
    legL: new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.85, 0.24), new THREE.MeshLambertMaterial({ color: 0x2c313a }), MAX_PEDS),
    legR: new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.85, 0.24), new THREE.MeshLambertMaterial({ color: 0x2c313a }), MAX_PEDS),
    armL: new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 0.75, 0.18), new THREE.MeshLambertMaterial({ color: 0xffffff }), MAX_PEDS),
    armR: new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 0.75, 0.18), new THREE.MeshLambertMaterial({ color: 0xffffff }), MAX_PEDS),
  };
  const shirtColors = [0x4fc3f7, 0xf2c94c, 0x90be6d, 0xe07a5f, 0xb5a6c9, 0xe8e8e8, 0xf28482];
  for (let i = 0; i < MAX_PEDS; i += 1) {
    const c = new THREE.Color(shirtColors[i % shirtColors.length]);
    pedMats.torso.setColorAt(i, c);
    pedMats.armL.setColorAt(i, c);
    pedMats.armR.setColorAt(i, c);
  }
  for (const m of Object.values(pedMats)) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(m);
  }

  // Golden shells: one instanced sphere pool.
  const shells = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.5, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xf2c94c }),
    20,
  );
  shells.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(shells);

  // Blob shadows: one instanced dark disc under every car, ped and cruiser.
  const MAX_BLOBS = MAX_CARS + MAX_PEDS + MAX_UNITS + 2;
  const blobs = new THREE.InstancedMesh(
    new THREE.CircleGeometry(1, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }),
    MAX_BLOBS,
  );
  blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(blobs);

  // Enemies: three small groups, built once, moved as they spawn.
  const enemies = [];
  for (let i = 0; i < 3; i += 1) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.0, 0.45), new THREE.MeshLambertMaterial({ color: 0x3d1d1d }));
    body.position.y = 1.2;
    g.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.38), new THREE.MeshLambertMaterial({ color: 0xc9977a }));
    head.position.y = 1.95;
    g.add(head);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.12), new THREE.MeshLambertMaterial({ color: 0x14181d }));
    gun.position.set(0.4, 1.35, 0.2);
    g.add(gun);
    g.visible = false;
    scene.add(g);
    enemies.push(g);
  }

  // Tracers: eight reusable lines.
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9 });
  const tracers = [];
  for (let i = 0; i < 8; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    const line = new THREE.Line(geo, tracerMat);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push(line);
  }

  const dummy = new THREE.Object3D();
  const camYaw = { value: 0 };
  const camPos = new THREE.Vector3(-70, 8, 10);
  const camLook = new THREE.Vector3();
  // Follow distance/height override (the cover shot pulls back for a wider frame).
  const follow = { dist: 0, height: 0 };
  function setFollow(dist, height) {
    follow.dist = dist;
    follow.height = height;
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  function setInstance(mesh, i, x, y, z, ry, sx, sy, sz, rx = 0) {
    dummy.position.set(x, y, z);
    dummy.rotation.set(rx, ry, 0);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }

  /** Paint one frame and return the render ledger (calls / triangles). */
  function draw(state, screen, time) {
    const { player, heroCar, traffic, police, combat, city } = state;
    const focus = player.mode === 'car' ? heroCar : player;
    const heading = focus.heading;

    // Camera: drift behind the heading, higher and further in the car.
    let d = heading - camYaw.value;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    camYaw.value += d * Math.min(1, 0.06);
    const dist = follow.dist || (player.mode === 'car' ? 11 : 7.5);
    const height = follow.height || (player.mode === 'car' ? 5.5 : 3.6);
    // Pull the camera in when the spot behind the car is inside a building, so
    // the car stays in frame instead of the camera climbing onto the roofs.
    function insideBuilding(x, z) {
      for (const b of city.buildings) {
        if (Math.abs(x - b.x) < b.w / 2 + 1 && Math.abs(z - b.z) < b.d / 2 + 1) return b.h;
      }
      return 0;
    }
    let camDist = dist;
    let camHeight = height;
    for (const d of [dist, 8, 5.5, 3.5]) {
      const cx = focus.x - Math.cos(camYaw.value) * d;
      const cz = focus.z + Math.sin(camYaw.value) * d;
      if (insideBuilding(cx, cz) === 0) {
        camDist = d;
        break;
      }
      camDist = d;
    }
    const blockedHeight = insideBuilding(focus.x - Math.cos(camYaw.value) * camDist, focus.z + Math.sin(camYaw.value) * camDist);
    if (blockedHeight > 0) camHeight = blockedHeight + 3;
    const wantX = focus.x - Math.cos(camYaw.value) * camDist;
    const wantZ = focus.z + Math.sin(camYaw.value) * camDist;
    if (screen === SCREEN_TITLE) {
      const a = time * 0.05;
      camPos.set(Math.cos(a) * 260, 120, Math.sin(a) * 260);
      camLook.set(0, 0, 0);
    } else {
      // A big jump (fresh load, a save, a staged shot) snaps; small moves ease.
      if (Math.hypot(wantX - camPos.x, wantZ - camPos.z) > 50) {
        camPos.set(wantX, camHeight, wantZ);
        camYaw.value = heading;
      } else {
        camPos.x += (wantX - camPos.x) * 0.12;
        camPos.y += (camHeight - camPos.y) * 0.12;
        camPos.z += (wantZ - camPos.z) * 0.12;
      }
      camLook.set(focus.x + Math.cos(heading) * 8, 1.5, focus.z - Math.sin(heading) * 8);
    }
    camera.position.copy(camPos);
    camera.lookAt(camLook);

    // Hero car.
    hero.position.set(heroCar.x, 0, heroCar.z);
    hero.rotation.y = heroCar.heading;
    heroBodyMat.color.setHex(heroCar.color);
    hero.visible = true;
    const wheelSpin = heroCar.speed * 0.5;
    for (const w of heroWheels) w.rotation.z = wheelSpin;

    // Rio: visible on foot, tucked away while driving.
    rio.visible = player.mode === 'foot';
    if (rio.visible) {
      rio.position.set(player.x, 0, player.z);
      rio.rotation.y = player.heading;
      const swing = player.speed > 0.1 ? Math.sin(time * 9) * 0.5 : 0;
      rioParts.legL.rotation.x = swing;
      rioParts.legR.rotation.x = -swing;
      rioParts.armL.rotation.x = -swing;
      rioParts.armR.rotation.x = swing;
    }

    // Traffic.
    let blob = 0;
    const cars = traffic.cars;
    for (let i = 0; i < cars.length; i += 1) {
      const c = cars[i];
      setInstance(trafficBodies, i, c.x, 0.75, c.z, c.heading, 1, 1, 1);
      setInstance(trafficCabins, i, c.x - Math.cos(c.heading) * 0.2, 1.5, c.z + Math.sin(c.heading) * 0.2, c.heading, 1, 1, 1);
      for (let w = 0; w < 4; w += 1) {
        const wx = (w < 2 ? 1.4 : -1.4);
        const wz = (w % 2 === 0 ? 0.85 : -0.85);
        const cH = Math.cos(c.heading);
        const sH = Math.sin(c.heading);
        setInstance(trafficWheels, i * 4 + w, c.x + wx * cH + wz * sH, 0.42, c.z - wx * sH + wz * cH, c.heading, 1, 1, 1);
      }
      trafficBodies.setColorAt(i, new THREE.Color(c.marked ? 0xf2c94c : (c.kind === 'taxi' ? 0xf2c94c : c.color)));
      setInstance(blobs, blob, c.x, 0.05, c.z, 0, 2.6, 1.6, 1);
      blob += 1;
    }
    trafficBodies.count = cars.length;
    trafficCabins.count = cars.length;
    trafficWheels.count = cars.length * 4;
    trafficBodies.instanceMatrix.needsUpdate = true;
    trafficCabins.instanceMatrix.needsUpdate = true;
    trafficWheels.instanceMatrix.needsUpdate = true;
    if (trafficBodies.instanceColor) trafficBodies.instanceColor.needsUpdate = true;

    // Police cruisers, lights flashing on alternate half-seconds.
    const flash = Math.floor(time * 2) % 2 === 0;
    for (let i = 0; i < police.units.length; i += 1) {
      const u = police.units[i];
      setInstance(policeBodies, i, u.x, 0.75, u.z, u.heading, 1, 1, 1);
      setInstance(policeCabins, i, u.x - Math.cos(u.heading) * 0.2, 1.5, u.z + Math.sin(u.heading) * 0.2, u.heading, 1, 1, 1);
      setInstance(policeRed, i, u.x, 1.95, u.z, u.heading, flash ? 1 : 0.001, 1, 1);
      setInstance(policeBlue, i, u.x, 1.95, u.z, u.heading, flash ? 0.001 : 1, 1, 1);
      setInstance(blobs, blob, u.x, 0.05, u.z, 0, 2.6, 1.6, 1);
      blob += 1;
    }
    policeBodies.count = police.units.length;
    policeCabins.count = police.units.length;
    policeRed.count = police.units.length;
    policeBlue.count = police.units.length;
    policeBodies.instanceMatrix.needsUpdate = true;
    policeCabins.instanceMatrix.needsUpdate = true;
    policeRed.instanceMatrix.needsUpdate = true;
    policeBlue.instanceMatrix.needsUpdate = true;

    // Pedestrians, limbs swinging with their walk phase.
    const peds = traffic.peds;
    for (let i = 0; i < peds.length; i += 1) {
      const p = peds[i];
      const down = p.down ? 0.4 : 1;
      const swing = p.down ? 0 : Math.sin(p.phase) * 0.55;
      const cH = Math.cos(p.heading);
      const sH = Math.sin(p.heading);
      const lx = -sH;
      const lz = -cH;
      setInstance(pedMats.torso, i, p.x, 1.25 * down, p.z, p.heading, 1, down, 1);
      setInstance(pedMats.head, i, p.x, 1.95 * down, p.z, p.heading, 1, 1, 1);
      setInstance(pedMats.legL, i, p.x + lx * 0.18, 0.42, p.z + lz * 0.18, p.heading, 1, 1, 1, swing);
      setInstance(pedMats.legR, i, p.x - lx * 0.18, 0.42, p.z - lz * 0.18, p.heading, 1, 1, 1, -swing);
      setInstance(pedMats.armL, i, p.x + lx * 0.48, 1.25, p.z + lz * 0.48, p.heading, 1, 1, 1, -swing);
      setInstance(pedMats.armR, i, p.x - lx * 0.48, 1.25, p.z - lz * 0.48, p.heading, 1, 1, 1, swing);
      setInstance(blobs, blob, p.x, 0.05, p.z, 0, 0.9, 0.9, 1);
      blob += 1;
    }
    for (const m of Object.values(pedMats)) {
      m.count = peds.length;
      m.instanceMatrix.needsUpdate = true;
    }
    setInstance(blobs, blob, heroCar.x, 0.05, heroCar.z, 0, 2.6, 1.6, 1);
    blob += 1;
    blobs.count = blob;
    blobs.instanceMatrix.needsUpdate = true;

    // Shells: taken ones shrink to nothing.
    for (let i = 0; i < city.shells.length; i += 1) {
      const s = city.shells[i];
      setInstance(shells, i, s.x, 0.5, s.z, 0, s.taken ? 0.001 : 1, s.taken ? 0.001 : 1, s.taken ? 0.001 : 1);
    }
    shells.count = city.shells.length;
    shells.instanceMatrix.needsUpdate = true;

    // Enemies.
    for (let i = 0; i < enemies.length; i += 1) {
      const e = combat.state.enemies[i];
      const g = enemies[i];
      if (!e || !e.alive) {
        g.visible = false;
        continue;
      }
      g.visible = true;
      g.position.set(e.x, 0, e.z);
      g.rotation.y = Math.atan2(-(player.z - e.z), player.x - e.x);
      g.position.y = e.hitFlash > 0 ? 0.15 : 0;
    }

    // Tracers.
    for (let i = 0; i < tracers.length; i += 1) {
      const s = combat.state.shots[i];
      const line = tracers[i];
      if (!s) {
        line.visible = false;
        continue;
      }
      line.visible = true;
      const pos = line.geometry.attributes.position;
      pos.setXYZ(0, s.x0, 1.4, s.z0);
      pos.setXYZ(1, s.x1, 1.4, s.z1);
      pos.needsUpdate = true;
    }

    renderer.render(scene, camera);
    return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  }

  /** World (x, y, z) to screen pixels, for damage numbers and health bars. */
  function project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(camera);
    return {
      x: (v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight,
      visible: v.z < 1,
    };
  }

  /** World point on the y=1.2 plane under a screen pixel, for mouse aiming. */
  function screenToGround(sx, sy) {
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const t = (1.2 - ray.ray.origin.y) / ray.ray.direction.y;
    if (!Number.isFinite(t) || t < 0) return null;
    const p = ray.ray.origin.clone().add(ray.ray.direction.clone().multiplyScalar(t));
    return { x: p.x, z: p.z };
  }

  function dispose() {
    renderer.dispose();
  }

  return { draw, project, screenToGround, dispose, setFollow, cameraHeading: () => camYaw.value, debugCam: () => ({ pos: [camPos.x, camPos.y, camPos.z], look: [camLook.x, camLook.y, camLook.z], yaw: camYaw.value }) };
}
