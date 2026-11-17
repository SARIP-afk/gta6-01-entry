// car.js — procedural low-poly car builder (Batch 2, Phase A).
// Finishing (v3.8-structural, recording #4): file re-written in this session; gates re-run on this exact content — see BATCH2-FINISH-REPORT.md.
//
// ONE builder replaces the three near-identical car builders that used to
// live in render.js (buildCarMesh / buildExtraCarMesh) plus addCarDetails.
// Every car is built from the same parts list so the hero, police, traffic,
// taxi, van and hatch share one silhouette language: sloped hood + deck,
// glass cabin with pillars, wheel arches, full-width light bars, door lines.
//
// Geometry-first rules followed here:
//  - merged meshes wherever a part never moves relative to the body
//    (paint / glass / trim / lamps are one mesh each per car);
//  - the hero's wheels stay separate (steer + spin groups) so driving,
//    steering and the camera are untouched — same sizes, same colliders;
//  - static wheels (traffic / police) merge all four tires into one mesh
//    and all four rims into one mesh;
//  - no per-instance rotation, no new randomness, no external assets.
// Materials are MeshStandardMaterial / MeshPhysicalMaterial (browser-only
// file — the Node test stub never loads this module).

import * as THREE from 'three';
import { CAR } from './config.js';

// ---------------------------------------------------------------------------
// merge helpers
// ---------------------------------------------------------------------------

/** Merge [{ geometry, matrix }] into one non-indexed BufferGeometry. */
export function mergeParts(parts) {
  const positions = [];
  const normals = [];
  for (const { geometry, matrix } of parts) {
    const geo = geometry.index ? geometry.toNonIndexed() : geometry;
    geo.applyMatrix4(matrix);
    positions.push(...geo.attributes.position.array);
    normals.push(...geo.attributes.normal.array);
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return merged;
}

function xf({ x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 }) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
  return m;
}

function box(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  return { geometry: new THREE.BoxGeometry(w, h, d), matrix: xf({ x, y, z, rx, ry, rz }) };
}

function cyl(rt, rb, h, seg, x, y, z, rx = 0, ry = 0, rz = 0, ts = 0, tl = Math.PI * 2) {
  return {
    geometry: new THREE.CylinderGeometry(rt, rb, h, seg, 1, false, ts, tl),
    matrix: xf({ x, y, z, rx, ry, rz }),
  };
}

// ---------------------------------------------------------------------------
// materials
// ---------------------------------------------------------------------------

function paintMaterial(color, hero) {
  // Batch 2, Phase D (pass 5): the proposal's paint numbers — restored after
  // the diagnostic (plain Standard, no clearcoat, no env) proved the pink
  // wash is the LIGHT LEVEL, not the clearcoat or the env: the red channel
  // clips under ACES at hemi 1.25 + fill 0.9, and ACES desaturates clipped
  // red to pink. The light goes back to Batch 1 levels (see config.js);
  // the facade gate is carried by the asphalt albedo, not the light.
  return hero
    ? new THREE.MeshPhysicalMaterial({
        color,
        metalness: 0.1,
        roughness: 0.35,
        clearcoat: 1.0,
        clearcoatRoughness: 0.12,
        envMapIntensity: 0.25,
      })
    : new THREE.MeshStandardMaterial({
        color,
        metalness: 0.15,
        roughness: 0.45,
        envMapIntensity: 0.25,
      });
}

const MAT = {
  glass: () =>
    new THREE.MeshPhysicalMaterial({
      color: 0x9fd8e8,
      metalness: 0.1,
      roughness: 0.08,
      transparent: true,
      opacity: 0.55,
      envMapIntensity: 1.0,
    }),
  trim: () =>
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.2, roughness: 0.8, envMapIntensity: 0.4 }),
  tire: () =>
    new THREE.MeshStandardMaterial({ color: 0x141414, metalness: 0.0, roughness: 0.95, envMapIntensity: 0.4 }),
  rim: () =>
    new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 0.8, roughness: 0.3 }),
  head: () =>
    new THREE.MeshStandardMaterial({
      color: 0xfff6cc,
      emissive: 0xffedb0,
      emissiveIntensity: 0.9,
    }),
  tail: () =>
    new THREE.MeshStandardMaterial({
      color: 0xff2a22,
      emissive: 0xcc1100,
      emissiveIntensity: 0.9,
    }),
  white: () =>
    new THREE.MeshStandardMaterial({ color: 0xf5f5f5, metalness: 0.05, roughness: 0.5 }),
  redLens: () =>
    new THREE.MeshStandardMaterial({
      color: 0xff2020,
      emissive: 0xff0000,
      emissiveIntensity: 1.2,
    }),
  blueLens: () =>
    new THREE.MeshStandardMaterial({
      color: 0x2050ff,
      emissive: 0x0033ff,
      emissiveIntensity: 1.2,
    }),
  taxiSign: () =>
    new THREE.MeshStandardMaterial({
      color: 0xffc800,
      emissive: 0xcc9900,
      emissiveIntensity: 0.8,
    }),
};

// ---------------------------------------------------------------------------
// wheel geometry (axle along X; the wheel spins around X)
// ---------------------------------------------------------------------------

function tireGeometry(radius, width) {
  // Cylinder axis is Y; rotate to X so the wheel rolls around X.
  return cyl(radius, radius, width, 16, 0, 0, 0, 0, 0, Math.PI / 2).geometry;
}

function rimGeometry(radius, width) {
  const parts = [cyl(radius, radius, width, 12, 0, 0, 0, 0, 0, Math.PI / 2)];
  // 5 spokes on each face, fanned around the axle.
  for (const face of [-1, 1]) {
    for (let k = 0; k < 5; k++) {
      parts.push(box(0.05, radius * 3.0, 0.06, face * (width / 2 + 0.01), 0, 0, (k * Math.PI * 2) / 5));
    }
  }
  parts.push(cyl(0.08, 0.08, width + 0.02, 8, 0, 0, 0, 0, 0, Math.PI / 2));
  return mergeParts(parts);
}

// ---------------------------------------------------------------------------
// buildCar
// ---------------------------------------------------------------------------

/**
 * Build one car.
 *
 * @param {object} opts
 * @param {'hero'|'police'|'traffic'|'taxi'|'van'|'hatch'} opts.kind
 * @param {number} opts.paint  body colour (hex)
 * @param {boolean} opts.interactive  hero only: separate steer/spin wheels
 * @returns {{ group, paintMat, glassMat, wheels, redLamp, blueLamp }}
 *   group: origin at ground centre, +z = front. wheels: [{steer, spin}]
 *   (interactive only). redLamp/blueLamp: police light-bar lenses.
 *
 * Sizes are CAR (4.4 x 1.9, wheels r 0.36) for EVERY kind — the old
 * builders used CAR dims for police/traffic too (EXTRA_CAR's length/width
 * were never read by any builder), so nothing changes size here.
 */
export function buildCar({ kind = 'traffic', paint = 0x8a8a8a, interactive = false }) {
  const D = CAR;
  const L = D.length;
  const W = D.width;
  const halfL = L / 2;
  const halfW = W / 2;
  // CAR carries no roofHeight / wheels fields — these are the old builders'
  // literals (roof panel at 1.32, tyre r 0.36 / w 0.3), kept exactly.
  const roofH = 1.3;
  const wheelR = 0.36;
  const wheelW = 0.3;
  const isVan = kind === 'van';
  const isHatch = kind === 'hatch';
  const isPolice = kind === 'police';
  const isTaxi = kind === 'taxi';
  const isHero = kind === 'hero';

  const paintParts = [];
  const glassParts = [];
  const trimParts = [];
  const headParts = [];
  const tailParts = [];
  const whiteParts = [];

  // ---- lower body: the slab that carries the whole silhouette ----
  paintParts.push(box(W, 0.42, L, 0, 0.44, 0));

  // ---- sloped hood (front) + sloped deck (rear) ----
  // Sign check: the hood's FRONT end must be LOW (rx +0.12 puts +z down),
  // the deck's REAR end must be LOW (rx -0.10 puts -z down).
  if (!isVan) {
    paintParts.push(box(W - 0.06, 0.1, 1.15, 0, 0.72, halfL - 0.62, 0.12));
    if (!isHatch) {
      paintParts.push(box(W - 0.06, 0.1, 0.95, 0, 0.72, -(halfL - 0.52), -0.1));
    } else {
      paintParts.push(box(W - 0.06, 0.1, 0.5, 0, 0.72, -(halfL - 0.3), -0.06));
    }
  }

  // ---- cabin ----
  if (isVan) {
    // Tall box van: one big cabin, flat roof, big side windows.
    paintParts.push(box(W - 0.2, 0.9, 2.6, 0, 1.15, -0.2));
    paintParts.push(box(W - 0.24, 0.06, 2.6, 0, 1.62, -0.2));
    glassParts.push(box(W - 0.3, 0.7, 0.08, 0, 1.15, 1.12, -0.15));
    glassParts.push(box(0.02, 0.55, 2.3, halfW - 0.09, 1.15, -0.2));
    glassParts.push(box(0.02, 0.55, 2.3, -(halfW - 0.09), 1.15, -0.2));
    glassParts.push(box(W - 0.3, 0.6, 0.08, 0, 1.15, -1.52));
  } else {
    const roofLen = isHatch ? 2.5 : 1.9;
    const roofZ = isHatch ? -0.45 : -0.2;
    paintParts.push(box(W - 0.24, 0.06, roofLen, 0, roofH, roofZ));
    // Windshield + rear glass (sloped), side glass, pillars A/B/C.
    // Sign check (verified against the roof edges): the windshield's HIGH
    // end must meet the roof FRONT edge (rx +0.55 puts +z down-forward);
    // the rear glass's HIGH end hides under the roof, its LOW end meets
    // the deck (rx -0.45). The old code had both signs backwards — a
    // forward-leaning windshield that read as a fin; fixed here.
    glassParts.push(box(W - 0.3, 0.08, 1.1, 0, roofH - 0.18, 0.95, 0.55));
    glassParts.push(
      box(W - 0.3, 0.08, 0.9, 0, roofH - 0.18, -1.15, isHatch ? -0.35 : -0.45),
    );
    glassParts.push(box(0.02, 0.34, 1.7, halfW - 0.09, roofH - 0.18, -0.2));
    glassParts.push(box(0.02, 0.34, 1.7, -(halfW - 0.09), roofH - 0.18, -0.2));
    trimParts.push(box(0.06, 0.5, 0.06, halfW - 0.15, roofH - 0.18, 0.45, 0.55));
    trimParts.push(box(0.06, 0.5, 0.06, -(halfW - 0.15), roofH - 0.18, 0.45, 0.55));
    trimParts.push(box(0.06, 0.5, 0.06, halfW - 0.09, roofH - 0.18, -0.2));
    trimParts.push(box(0.06, 0.5, 0.06, -(halfW - 0.09), roofH - 0.18, -0.2));
    trimParts.push(box(0.06, 0.5, 0.06, halfW - 0.15, roofH - 0.18, -0.85, isHatch ? -0.35 : -0.45));
    trimParts.push(box(0.06, 0.5, 0.06, -(halfW - 0.15), roofH - 0.18, -0.85, isHatch ? -0.35 : -0.45));
    // Dark interior bench + headrests, faintly visible through the glass.
    trimParts.push(box(W - 0.4, 0.3, 1.6, 0, 0.85, -0.2));
    trimParts.push(box(0.3, 0.18, 0.12, 0.45, 1.05, 0.15));
    trimParts.push(box(0.3, 0.18, 0.12, -0.45, 1.05, 0.15));
  }

  // ---- wheel arches: half-cylinder shells hugging each wheel ----
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      trimParts.push(
        cyl(wheelR + 0.06, wheelR + 0.06, 0.14, 12, sx * (halfW + 0.01), wheelR + 0.06, sz * 1.45, 0, 0, Math.PI / 2, 0, Math.PI),
      );
    }
  }

  // ---- door lines, handles, side skirts ----
  for (const sx of [-1, 1]) {
    const x = sx * (halfW + 0.01);
    trimParts.push(box(0.02, 0.5, 0.04, x, 0.5, 0.3));
    trimParts.push(box(0.02, 0.5, 0.04, x, 0.5, -0.9));
    trimParts.push(box(0.03, 0.05, 0.3, x, 0.75, 0.3));
    trimParts.push(box(0.03, 0.05, 0.3, x, 0.75, -0.9));
    trimParts.push(box(0.04, 0.12, 3.6, x, 0.28, 0));
  }
  // Hood / deck shut lines (thin dark seams across the top).
  if (!isVan) {
    trimParts.push(box(W - 0.1, 0.03, 0.04, 0, 0.78, halfL - 1.2));
    trimParts.push(box(W - 0.1, 0.03, 0.04, 0, 0.78, -(halfL - 1.0)));
  }

  // ---- bumpers, grille + slats, valance, exhausts, plate ----
  trimParts.push(box(W + 0.04, 0.22, 0.14, 0, 0.42, halfL + 0.03));
  trimParts.push(box(W + 0.04, 0.22, 0.14, 0, 0.42, -(halfL + 0.03)));
  trimParts.push(box(1.2, 0.18, 0.08, 0, 0.62, halfL + 0.06));
  for (const y of [0.56, 0.62, 0.68]) {
    trimParts.push(box(1.2, 0.03, 0.02, 0, y, halfL + 0.11));
  }
  trimParts.push(box(W, 0.14, 0.1, 0, 0.3, -(halfL + 0.02)));
  trimParts.push(cyl(0.05, 0.05, 0.15, 8, 0.5, 0.3, -(halfL + 0.08), Math.PI / 2));
  trimParts.push(cyl(0.05, 0.05, 0.15, 8, -0.5, 0.3, -(halfL + 0.08), Math.PI / 2));
  // Plate + fog dots must sit IN FRONT of the bumper face (halfL + 0.10),
  // otherwise the bumper swallows them.
  whiteParts.push(box(0.44, 0.12, 0.02, 0, 0.45, -(halfL + 0.11)));

  // ---- headlights + fog dots (front), full-width tail bar (rear) ----
  headParts.push(box(0.4, 0.18, 0.1, 0.6, 0.62, halfL + 0.02));
  headParts.push(box(0.4, 0.18, 0.1, -0.6, 0.62, halfL + 0.02));
  headParts.push(box(0.12, 0.12, 0.06, 0.75, 0.35, halfL + 0.12));
  headParts.push(box(0.12, 0.12, 0.06, -0.75, 0.35, halfL + 0.12));
  headParts.push(box(0.2, 0.1, 0.05, 0.6, 0.45, -(halfL + 0.02)));
  headParts.push(box(0.2, 0.1, 0.05, -0.6, 0.45, -(halfL + 0.02)));
  tailParts.push(box(1.7, 0.14, 0.06, 0, 0.62, -(halfL + 0.02)));

  // ---- mirrors on stalks ----
  for (const sx of [-1, 1]) {
    trimParts.push(box(0.05, 0.05, 0.18, sx * (halfW + 0.03), 1.05, 0.75));
    trimParts.push(box(0.16, 0.14, 0.28, sx * (halfW + 0.07), 1.12, 0.75));
  }

  // ---- kind extras ----
  let redLamp = null;
  let blueLamp = null;
  if (isHero) {
    // Rear spoiler: wing + end plates + struts (dark, like the old car).
    trimParts.push(box(1.8, 0.08, 0.5, 0, 1.18, -(halfL - 0.25)));
    trimParts.push(box(0.05, 0.25, 0.5, 0.88, 1.1, -(halfL - 0.25)));
    trimParts.push(box(0.05, 0.25, 0.5, -0.88, 1.1, -(halfL - 0.25)));
    trimParts.push(box(0.08, 0.25, 0.08, 0.6, 1.0, -(halfL - 0.25)));
    trimParts.push(box(0.08, 0.25, 0.08, -0.6, 1.0, -(halfL - 0.25)));
  }
  if (isPolice) {
    // White roof + white door panels, light bar, push bar.
    whiteParts.push(box(W - 0.24, 0.06, 1.9, 0, roofH + 0.01, -0.2));
    whiteParts.push(box(0.02, 0.5, 1.2, halfW - 0.08, 0.55, -0.2));
    whiteParts.push(box(0.02, 0.5, 1.2, -(halfW - 0.08), 0.55, -0.2));
    trimParts.push(box(1.2, 0.1, 0.5, 0, roofH + 0.12, -0.2));
    trimParts.push(box(0.08, 0.4, 0.08, 0.5, 0.5, halfL + 0.1));
    trimParts.push(box(0.08, 0.4, 0.08, -0.5, 0.5, halfL + 0.1));
    trimParts.push(box(1.1, 0.08, 0.08, 0, 0.65, halfL + 0.12));
  }
  if (isTaxi) {
    // Roof sign (separate emissive mesh, returned via whiteParts? no —
    // it gets its own material below).
  }

  // ---- assemble ----
  const group = new THREE.Group();
  const paintMat = paintMaterial(paint, isHero || isPolice);
  const glassMat = MAT.glass();
  group.add(new THREE.Mesh(mergeParts(paintParts), paintMat));
  group.add(new THREE.Mesh(mergeParts(glassParts), glassMat));
  group.add(new THREE.Mesh(mergeParts(trimParts), MAT.trim()));
  group.add(new THREE.Mesh(mergeParts(headParts), MAT.head()));
  group.add(new THREE.Mesh(mergeParts(tailParts), MAT.tail()));
  if (whiteParts.length) {
    group.add(new THREE.Mesh(mergeParts(whiteParts), MAT.white()));
  }
  if (isTaxi) {
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.15, 0.25),
      MAT.taxiSign(),
    );
    sign.position.set(0, roofH + 0.08, -0.2);
    group.add(sign);
  }
  if (isPolice) {
    const redMat = MAT.redLens();
    const blueMat = MAT.blueLens();
    redLamp = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.22, 0.5), redMat);
    redLamp.position.set(-0.3, roofH + 0.28, -0.2);
    blueLamp = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.22, 0.5), blueMat);
    blueLamp.position.set(0.3, roofH + 0.28, -0.2);
    group.add(redLamp);
    group.add(blueLamp);
  }

  // ---- wheels ----
  const wheels = [];
  const wheelX = halfW - 0.1;
  const wheelZ = 1.45;
  if (interactive) {
    // Hero: each wheel gets a steer group + a spin group (tire + rim).
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const steer = new THREE.Group();
        steer.position.set(sx * wheelX, wheelR, sz * wheelZ);
        const spin = new THREE.Group();
        spin.add(new THREE.Mesh(tireGeometry(wheelR, wheelW), MAT.tire()));
        spin.add(new THREE.Mesh(rimGeometry(0.2, wheelW + 0.02), MAT.rim()));
        steer.add(spin);
        group.add(steer);
        wheels.push({ steer, spin });
      }
    }
  } else {
    // Static: all four tires merged, all four rims merged.
    const tireParts = [];
    const rimParts = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const px = sx * wheelX;
        const pz = sz * wheelZ;
        tireParts.push(cyl(wheelR, wheelR, wheelW, 16, px, wheelR, pz, 0, 0, Math.PI / 2));
        rimParts.push(cyl(0.19, 0.19, wheelW + 0.02, 12, px, wheelR, pz, 0, 0, Math.PI / 2));
        for (const face of [-1, 1]) {
          for (let k = 0; k < 5; k++) {
            rimParts.push(
              box(0.05, 0.57, 0.06, px + face * (wheelW / 2 + 0.03), wheelR, pz, (k * Math.PI * 2) / 5),
            );
          }
        }
        rimParts.push(cyl(0.08, 0.08, wheelW + 0.04, 8, px, wheelR, pz, 0, 0, Math.PI / 2));
      }
    }
    group.add(new THREE.Mesh(mergeParts(tireParts), MAT.tire()));
    group.add(new THREE.Mesh(mergeParts(rimParts), MAT.rim()));
  }

  return { group, paintMat, glassMat, wheels, redLamp, blueLamp };
}
