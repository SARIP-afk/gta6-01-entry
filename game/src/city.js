// Solmarina, the city itself: a seeded procedural grid built from instanced meshes.
// Everything here is deterministic — every size, colour and position comes from the
// seeded random passed in, never from Math.random. The city is one group of meshes plus
// a list of 2D colliders (building footprints, channel banks, pier) and a driving route.
// Instanced meshes are named, so play tests can hide a layer (roads, crosswalks, ...)
// when hunting the frame-rate bottleneck. Phase 1: the bridge over the marina channel
// is one deck spanning the channel along the east-west road at z -6.
// Phase 2: buildCity also returns `map`, a flat 2D summary (roads, building footprints,
// water, landmarks, route) that the HUD draws as the minimap — no 3D data needed there.
import { CITY, PALETTE, districtOf } from './config.js';

/** Road centre lines, each way: 11 internal roads plus the perimeter ring. */
export function roadLines() {
  const lines = [];
  for (let k = 0; k < 11; k += 1) lines.push(-266 + 52 * k);
  return lines;
}

function blockCentre(i) {
  return -292 + 52 * i;
}

function blockRange(i) {
  return { min: -312 + 52 * i, max: -312 + 52 * i + 40 };
}

function pick(random, list) {
  return list[Math.floor(random() * list.length)];
}

function makeSkyTexture(THREE) {
  // A vertical gradient painted once on a small canvas: warm horizon, blue top.
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, PALETTE.skyTop);
  gradient.addColorStop(0.62, '#a8c8e2');
  gradient.addColorStop(0.82, PALETTE.skyHorizon);
  gradient.addColorStop(1, '#ffcf96');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 4, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function buildCity(THREE, random) {
  const group = new THREE.Group();
  group.name = 'solmarina-city';
  const colliders = [];
  const buildings = [];
  const roofs = [];
  const windows = [];
  const sidewalks = [];
  const palms = [];
  const lamps = [];
  const dashes = [];
  const crosswalks = [];

  const lines = roadLines();
  const groundMat = new THREE.MeshLambertMaterial({ color: PALETTE.groundSand });
  const asphaltMat = new THREE.MeshLambertMaterial({ color: PALETTE.asphalt });
  const walkMat = new THREE.MeshLambertMaterial({ color: PALETTE.sidewalk });
  const dashMat = new THREE.MeshLambertMaterial({ color: PALETTE.laneDash });
  const crossMat = new THREE.MeshLambertMaterial({ color: PALETTE.crosswalk });
  const seaMat = new THREE.MeshLambertMaterial({ color: PALETTE.sea });
  const seaDeepMat = new THREE.MeshLambertMaterial({ color: PALETTE.seaDeep });
  const woodMat = new THREE.MeshLambertMaterial({ color: PALETTE.pierWood });

  function box(w, h, d, mat, x, y, z) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    group.add(mesh);
    return mesh;
  }

  // --- ground, sea, beach, channel water -------------------------------------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1036, 1400), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(-182, 0, 0);
  ground.receiveShadow = true;
  group.add(ground);

  const sea = new THREE.Mesh(new THREE.PlaneGeometry(1064, 1400), seaDeepMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(336 + 532, -0.5, 0);
  sea.receiveShadow = true;
  group.add(sea);

  // A flat sand strip where the land meets the sea, slightly below road level.
  const beach = new THREE.Mesh(new THREE.PlaneGeometry(26, 1400), groundMat);
  beach.rotation.x = -Math.PI / 2;
  beach.position.set(348, -0.25, 0);
  group.add(beach);

  const channel = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.channel.x1 - CITY.channel.x0, CITY.channel.z1 - CITY.channel.z0),
    seaMat,
  );
  channel.rotation.x = -Math.PI / 2;
  channel.position.set(
    (CITY.channel.x0 + CITY.channel.x1) / 2,
    0.06,
    (CITY.channel.z0 + CITY.channel.z1) / 2,
  );
  group.add(channel);

  // --- sky dome ---------------------------------------------------------------
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1400, 16, 12),
    new THREE.MeshBasicMaterial({ map: makeSkyTexture(THREE), side: THREE.BackSide, fog: false }),
  );
  group.add(sky);

  // --- roads: asphalt strips on the ground ------------------------------------
  const roadGeoms = [];
  for (const c of lines) {
    roadGeoms.push({ x: c, z: 0, w: CITY.road, d: 648 });
    roadGeoms.push({ x: 0, z: c, w: 648, d: CITY.road });
  }
  for (const edge of [-312, 312]) {
    roadGeoms.push({ x: edge, z: 0, w: CITY.road, d: 648 });
    roadGeoms.push({ x: 0, z: edge, w: 648, d: CITY.road });
  }
  const roadMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), asphaltMat, roadGeoms.length);
  roadMesh.name = 'roads';
  {
    const m = new THREE.Matrix4();
    for (let i = 0; i < roadGeoms.length; i += 1) {
      const r = roadGeoms[i];
      m.makeScale(r.w, 0.1, r.d);
      m.setPosition(r.x, 0.05, r.z);
      roadMesh.setMatrixAt(i, m);
    }
  }
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  // --- lane dashes + crosswalk stripes ----------------------------------------
  for (const c of lines) {
    for (let p = -300; p <= 300; p += 16) {
      dashes.push({ x: c, z: p, w: 0.5, d: 5 });
      dashes.push({ x: p, z: c, w: 5, d: 0.5 });
    }
  }
  for (const cx of lines) {
    for (const cz of lines) {
      for (let s = -4; s <= 4; s += 2) {
        crosswalks.push({ x: cx + s, z: cz - 8.5, w: 1, d: 3 });
        crosswalks.push({ x: cx + s, z: cz + 8.5, w: 1, d: 3 });
        crosswalks.push({ x: cx - 8.5, z: cz + s, w: 3, d: 1 });
        crosswalks.push({ x: cx + 8.5, z: cz + s, w: 3, d: 1 });
      }
    }
  }
  function instancedBoxes(list, mat, y, name) {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, list.length);
    mesh.name = name;
    const m = new THREE.Matrix4();
    for (let i = 0; i < list.length; i += 1) {
      const b = list[i];
      m.makeScale(b.w, b.h ?? 0.12, b.d);
      m.setPosition(b.x, y, b.z);
      mesh.setMatrixAt(i, m);
    }
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }
  instancedBoxes(dashes, dashMat, 0.12, 'dashes');
  instancedBoxes(crosswalks, crossMat, 0.12, 'crosswalks');

  // --- blocks: sidewalks, buildings, palms, lamps ------------------------------
  const stadiumBlocks = new Set(['1,8', '1,9', '1,10', '2,8', '2,9', '2,10', '3,8', '3,9', '3,10']);
  for (let bx = 0; bx < CITY.blocks; bx += 1) {
    for (let bz = 0; bz < CITY.blocks; bz += 1) {
      const cx = blockCentre(bx);
      const cz = blockCentre(bz);
      const xr = blockRange(bx);
      const zr = blockRange(bz);
      sidewalks.push({ x: cx, z: cz, w: 40, d: 40, h: 0.2 });
      if (stadiumBlocks.has(`${bx},${bz}`)) continue;
      if (bx === CITY.tower.bx && bz === CITY.tower.bz) continue;
      // Waterfront park along the channel: no buildings, palms only.
      if (Math.abs(cz) < 60 && cx > 150) {
        for (let p = 0; p < 3; p += 1) {
          palms.push({ x: xr.min + 4 + random() * 32, z: zr.min + 4 + random() * 32 });
        }
        continue;
      }
      const district = districtOf(bx, bz);
      const palette = district === 'downtown'
        ? PALETTE.buildingDowntown
        : district === 'marina' ? PALETTE.buildingMarina : PALETTE.buildingSuburb;
      const count = district === 'downtown' ? 1 : 2;
      for (let n = 0; n < count; n += 1) {
        const w = district === 'downtown' ? 24 + random() * 6 : 11 + random() * 7;
        const d = district === 'downtown' ? 24 + random() * 6 : 11 + random() * 7;
        const h = district === 'downtown'
          ? 30 + random() * 60
          : district === 'marina' ? 12 + random() * 18 : 6 + random() * 8;
        const x = count === 1 ? cx : xr.min + 8 + (n * 20) + (random() * 4 - 2);
        const z = count === 1 ? cz : zr.min + 8 + (n * 20) + (random() * 4 - 2);
        const color = pick(random, palette);
        buildings.push({ x, z, w, d, h, color });
        roofs.push({ x, z, w: w + 0.8, d: d + 0.8, h: 0.7, y: h + 0.35 });
        colliders.push({ minX: x - w / 2 - 0.3, maxX: x + w / 2 + 0.3, minZ: z - d / 2 - 0.3, maxZ: z + d / 2 + 0.3 });
        const strips = Math.max(1, Math.floor(h / 12));
        for (let s = 0; s < strips; s += 1) {
          windows.push({ x, z: z + d / 2 + 0.18, w: w * 0.7, d: 0.36, h: 1.2, y: 5 + s * 12 });
        }
        if (random() < 0.6) {
          palms.push({ x: xr.min + 3 + random() * 6, z: zr.min + 3 + random() * 6 });
        }
      }
      if (random() < 0.5) {
        lamps.push({ x: xr.min + 2, z: zr.min + 2 });
      }
    }
  }
  instancedBoxes(sidewalks, walkMat, 0.1, 'sidewalks');

  // Buildings: one instanced box per building, coloured per instance.
  {
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      buildings.length,
    );
    mesh.name = 'buildings';
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    for (let i = 0; i < buildings.length; i += 1) {
      const b = buildings[i];
      m.makeScale(b.w, b.h, b.d);
      m.setPosition(b.x, b.h / 2, b.z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, color.set(b.color));
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  // Roof caps.
  {
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: PALETTE.roof }),
      roofs.length,
    );
    mesh.name = 'roofs';
    const m = new THREE.Matrix4();
    for (let i = 0; i < roofs.length; i += 1) {
      const r = roofs[i];
      m.makeScale(r.w, r.h, r.d);
      m.setPosition(r.x, r.y, r.z);
      mesh.setMatrixAt(i, m);
    }
    mesh.castShadow = true;
    group.add(mesh);
  }
  // Window strips on the south face.
  {
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: PALETTE.window }),
      windows.length,
    );
    mesh.name = 'windows';
    const m = new THREE.Matrix4();
    for (let i = 0; i < windows.length; i += 1) {
      const w = windows[i];
      m.makeScale(w.w, w.h, w.d);
      m.setPosition(w.x, w.y, w.z);
      mesh.setMatrixAt(i, m);
    }
    group.add(mesh);
  }
  // Palms: trunk + canopy blobs.
  {
    const trunk = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.28, 0.42, 6, 6),
      new THREE.MeshLambertMaterial({ color: PALETTE.palmTrunk }),
      palms.length,
    );
    trunk.name = 'palm-trunks';
    const canopy = new THREE.InstancedMesh(
      new THREE.SphereGeometry(2.6, 7, 5),
      new THREE.MeshLambertMaterial({ color: PALETTE.palmLeaf }),
      palms.length,
    );
    canopy.name = 'palm-canopies';
    const m = new THREE.Matrix4();
    for (let i = 0; i < palms.length; i += 1) {
      const p = palms[i];
      m.makeScale(1, 1, 1);
      m.setPosition(p.x, 3, p.z);
      trunk.setMatrixAt(i, m);
      m.makeScale(1.4, 0.55, 1.4);
      m.setPosition(p.x, 6.4, p.z);
      canopy.setMatrixAt(i, m);
    }
    trunk.castShadow = true;
    canopy.castShadow = true;
    group.add(trunk);
    group.add(canopy);
  }
  // Streetlights: pole + warm head.
  {
    const pole = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.12, 0.16, 7, 6),
      new THREE.MeshLambertMaterial({ color: PALETTE.lampPole }),
      lamps.length,
    );
    pole.name = 'lamp-poles';
    const head = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.9, 0.3, 0.3),
      new THREE.MeshLambertMaterial({ color: PALETTE.lampGlow, emissive: 0xffc861, emissiveIntensity: 0.7 }),
      lamps.length,
    );
    head.name = 'lamp-heads';
    const m = new THREE.Matrix4();
    for (let i = 0; i < lamps.length; i += 1) {
      const l = lamps[i];
      m.makeScale(1, 1, 1);
      m.setPosition(l.x, 3.5, l.z);
      pole.setMatrixAt(i, m);
      m.setPosition(l.x, 7, l.z);
      head.setMatrixAt(i, m);
    }
    group.add(pole);
    group.add(head);
  }

  // --- landmarks ----------------------------------------------------------------
  // Solmarina Tower: the city's spike, downtown north.
  {
    const tx = blockCentre(CITY.tower.bx);
    const tz = blockCentre(CITY.tower.bz);
    const tower = box(18, CITY.tower.height, 18, new THREE.MeshLambertMaterial({ color: '#e8dcc8' }), tx, CITY.tower.height / 2, tz);
    tower.castShadow = true;
    box(20, 2, 20, new THREE.MeshLambertMaterial({ color: PALETTE.roof }), tx, CITY.tower.height + 1, tz);
    const spire = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 2.2, 16, 6),
      new THREE.MeshLambertMaterial({ color: '#3a3f46' }),
    );
    spire.position.set(tx, CITY.tower.height + 10, tz);
    group.add(spire);
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(1.1, 8, 6),
      new THREE.MeshLambertMaterial({ color: '#ff5a3c', emissive: 0xff3c1e, emissiveIntensity: 1.2 }),
    );
    beacon.position.set(tx, CITY.tower.height + 18, tz);
    group.add(beacon);
    colliders.push({ minX: tx - 9.3, maxX: tx + 9.3, minZ: tz - 9.3, maxZ: tz + 9.3 });
  }
  // Stadium: a low ring south-west, with floodlights.
  {
    const sx = blockCentre(CITY.stadium.bx);
    const sz = blockCentre(CITY.stadium.bz);
    const bowl = new THREE.Mesh(
      new THREE.CylinderGeometry(CITY.stadium.radius, CITY.stadium.radius + 4, 18, 20),
      new THREE.MeshLambertMaterial({ color: '#d9e2ea' }),
    );
    bowl.position.set(sx, 9, sz);
    bowl.castShadow = true;
    bowl.receiveShadow = true;
    group.add(bowl);
    const field = new THREE.Mesh(
      new THREE.CylinderGeometry(CITY.stadium.radius - 8, CITY.stadium.radius - 8, 1, 20),
      new THREE.MeshLambertMaterial({ color: '#4a8a4a' }),
    );
    field.position.set(sx, 18.2, sz);
    group.add(field);
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.5, 26, 6),
        new THREE.MeshLambertMaterial({ color: PALETTE.lampPole }),
      );
      pole.position.set(sx + dx * 46, 13, sz + dz * 46);
      group.add(pole);
      const lamp = new THREE.Mesh(
        new THREE.BoxGeometry(6, 2, 1),
        new THREE.MeshLambertMaterial({ color: PALETTE.lampGlow, emissive: 0xffc861, emissiveIntensity: 0.9 }),
      );
      lamp.position.set(sx + dx * 46, 26, sz + dz * 46);
      group.add(lamp);
    }
    colliders.push({
      minX: sx - CITY.stadium.radius - 4, maxX: sx + CITY.stadium.radius + 4,
      minZ: sz - CITY.stadium.radius - 4, maxZ: sz + CITY.stadium.radius + 4,
    });
  }
  // The bridge: one deck spanning the channel along the east-west road at z -6,
  // overlapping both banks so the road reads as continuous, with railings on both
  // edges. The water north of the deck (z 0..10) still blocks cars and feet.
  {
    const b = CITY.bridge;
    const deckLength = b.x1 - b.x0;
    const deckX = (b.x0 + b.x1) / 2;
    const deck = box(deckLength, 0.5, b.width, asphaltMat, deckX, 0.28, b.z);
    deck.receiveShadow = true;
    const railMat = new THREE.MeshLambertMaterial({ color: '#e8e2d2' });
    box(deckLength, 1.1, 0.5, railMat, deckX, 0.9, b.z - b.width / 2);
    box(deckLength, 1.1, 0.5, railMat, deckX, 0.9, b.z + b.width / 2);
    const c = CITY.channel;
    colliders.push({ minX: c.x0, maxX: c.x1, minZ: b.z + b.width / 2, maxZ: c.z1 });
  }
  // Pier: wooden deck east into the sea, with a lighthouse at its end.
  {
    for (let x = CITY.pier.x0 + 4; x < CITY.pier.x1; x += 8) {
      box(8, 0.6, CITY.pier.width, woodMat, x, 1.0, CITY.pier.z);
    }
    const light = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 3, 16, 10),
      new THREE.MeshLambertMaterial({ color: '#f2ede2' }),
    );
    light.position.set(424, 9, CITY.pier.z);
    light.castShadow = true;
    group.add(light);
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(2.35, 2.35, 3, 10),
      new THREE.MeshLambertMaterial({ color: '#d84a35' }),
    );
    band.position.set(424, 12, CITY.pier.z);
    group.add(band);
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(1.6, 8, 6),
      new THREE.MeshLambertMaterial({ color: '#ffe9a8', emissive: 0xffd27a, emissiveIntensity: 1.4 }),
    );
    lamp.position.set(424, 18, CITY.pier.z);
    group.add(lamp);
    colliders.push({ minX: CITY.pier.x0, maxX: CITY.pier.x1, minZ: CITY.pier.z - 7, maxZ: CITY.pier.z + 7 });
  }

  // Driving route for the autopilot: a rectangle loop along the roads, starting on
  // the spawn road (z -6) so the car joins it heading the right way. Every leg is a
  // road centre line; the corners are open intersections, so the car can swing wide.
  const route = [
    { x: -58, z: -6 }, { x: 150, z: -6 }, { x: 150, z: 150 },
    { x: -58, z: 150 }, { x: -58, z: -6 },
  ];

  return {
    group,
    colliders,
    route,
    // Spawn: on the east-west road at z -6, car facing east toward downtown and the bridge.
    spawn: { car: { x: -58, z: -6, heading: Math.PI / 2 }, player: { x: -58, z: -1 } },
    buildingCount: buildings.length,
    palmCount: palms.length,
    // Flat 2D summary for the minimap (Phase 2): footprints, not meshes.
    map: {
      roads: lines,
      buildings: buildings.map((b) => ({ x: b.x, z: b.z, w: b.w, d: b.d })),
      channel: { ...CITY.channel },
      bridge: { ...CITY.bridge },
      tower: { x: blockCentre(CITY.tower.bx), z: blockCentre(CITY.tower.bz) },
      stadium: {
        x: blockCentre(CITY.stadium.bx),
        z: blockCentre(CITY.stadium.bz),
        r: CITY.stadium.radius,
      },
      pier: { ...CITY.pier },
      seaX: CITY.seaX,
      route,
    },
  };
}
