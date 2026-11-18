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
  // F4 V1: dark glass — kills the aquarium (M-6). Interior bench fades
  // behind it by design; fallback opacity 0.70 / envMapIntensity 1.2.
  glass: () =>
    new THREE.MeshPhysicalMaterial({
      color: 0x1e3a4a,
      metalness: 0.1,
      roughness: 0.05,
      transparent: true,
      opacity: 0.8,
      envMapIntensity: 1.5,
    }),
  trim: () =>
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.2, roughness: 0.8, envMapIntensity: 0.4 }),
  tire: () =>
    new THREE.MeshStandardMaterial({ color: 0x141414, metalness: 0.0, roughness: 0.95, envMapIntensity: 0.4 }),
  // F4 V3 (fallback darurat, teruji di slice): metalness 0.8/rough 0.3
  // membuat cakram MEMANTULKAN jalan gelap = hitam dari samping; 0.5/0.45
  // memberi komponen diffuse sehingga pelek terbaca abu-terang. Material
  // yang sama dipakai gagang pintu krom (tetap terbaca krom).
  rim: () =>
    new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 0.5, roughness: 0.45 }),
  head: () =>
    new THREE.MeshStandardMaterial({
      color: 0xfff6cc,
      emissive: 0xffedb0,
      // F4 V3: emissive compromise 1.2 — the LED strip shares this mesh
      // (no separate LED material/call); 2.2 would need its own mesh.
      emissiveIntensity: 1.2,
    }),
  // F4 V1: tail lamps at emissive 2.0 so the strip reads over the paint.
  tail: () =>
    new THREE.MeshStandardMaterial({
      color: 0xff2a22,
      emissive: 0xcc1100,
      emissiveIntensity: 2.0,
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
  // F4 V3 (bug fix): the old code returned `.geometry` WITHOUT applying
  // the rz=PI/2 matrix — the hero's tyres were Y-axis drums (bbox
  // x/z ±0.36, y ±0.15), not wheels. The drum's curved side occluded the
  // rim from every side view, which is why the rim only ever showed as
  // spoke tips below the drum. Static wheels were unaffected (merged path
  // applies matrices). 0 tri / 0 call — same geometry, correctly oriented.
  const { geometry, matrix } = cyl(radius, radius, width, 16, 0, 0, 0, 0, 0, Math.PI / 2);
  geometry.applyMatrix4(matrix);
  return geometry;
}

function rimGeometry(radius, width) {
  const parts = [cyl(radius, radius, width, 12, 0, 0, 0, 0, 0, Math.PI / 2)];
  // 5 spokes on each face, fanned around the axle.
  // F4 V3: spoke centres at face*(width/2 - 0.035), NOT the spec's literal
  // width/2 - 0.01 — with 0.05-thick spokes the literal value leaves the
  // outer face at +0.025 m past the tyre face and FAILS C-A4 (<= +0.005);
  // -0.035 puts the outer face flush with the tyre face (0.15 m).
  for (const face of [-1, 1]) {
    for (let k = 0; k < 5; k++) {
      parts.push(box(0.05, radius * 3.0, 0.06, face * (width / 2 - 0.035), 0, 0, (k * Math.PI * 2) / 5));
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
  // F4 V3: door handles live in their own chrome mesh (rim material),
  // moved out of trim — +1 draw call per car, 0 tri.
  const chromeParts = [];

  // ---- lower body: the slab that carries the whole silhouette ----
  // F4 V2 (Opsi B): beltline 0.42 -> 0.48 m, top edge 0.65 -> 0.71 m.
  paintParts.push(box(W, 0.48, L, 0, 0.47, 0));

  // ---- sloped hood (front) + sloped deck (rear) ----
  // Sign check: the hood's FRONT end must be LOW (rx +0.16 puts +z down),
  // the deck's REAR end must be LOW (rx -0.14 puts -z down).
  // F4 V2: hood 1.15 m / 0.12 rad -> 1.25 m / 0.16 rad, juts 0.15 m forward
  // (front edge 2.155 -> 2.305); sedan deck 0.95 m / 0.10 -> 1.00 m / 0.14,
  // juts 0.15 m rearward (rear edge -2.155 -> -2.33). Visual body length
  // 4.4 -> ~4.64 m; CAR.length stays 4.4 (collider unchanged) — the 0.15 m
  // visual overhang is accepted (keputusan D) and logged in the report.
  if (!isVan) {
    paintParts.push(box(W - 0.06, 0.1, 1.25, 0, 0.72, halfL - 0.52, 0.16));
    if (!isHatch) {
      paintParts.push(box(W - 0.06, 0.1, 1.0, 0, 0.72, -(halfL - 0.37), -0.14));
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
    // F4 V2: roof 1.90 @ z -0.20 -> 1.55 @ z -0.35 (sedan); hatch 2.50 @
    // -0.45 -> 2.15 @ -0.60 (same -0.15 shift, -0.35 length — spec gives
    // sedan numbers only; hatch follows the same delta).
    const roofLen = isHatch ? 2.15 : 1.55;
    const roofZ = isHatch ? -0.6 : -0.35;
    paintParts.push(box(W - 0.24, 0.06, roofLen, 0, roofH, roofZ));
    // Windshield + rear glass (sloped), side glass, pillars A/B/C.
    // Sign check (verified against the roof edges): the windshield's HIGH
    // end must meet the roof FRONT edge (rx +0.62 puts +z down-forward);
    // the rear glass's HIGH end hides under the roof, its LOW end meets
    // the deck (rx -0.52). The old code had both signs backwards — a
    // forward-leaning windshield that read as a fin; fixed here.
    // F4 V2: glass rx 0.55/-0.45 -> 0.62/-0.52 (hatch rear -0.35 -> -0.42);
    // side glass 1.70 -> 1.35 m centred on the new roof (-0.35).
    glassParts.push(box(W - 0.3, 0.08, 1.1, 0, roofH - 0.18, 0.95, 0.62));
    glassParts.push(
      box(W - 0.3, 0.08, 0.9, 0, roofH - 0.18, -1.15, isHatch ? -0.42 : -0.52),
    );
    glassParts.push(box(0.02, 0.34, 1.35, halfW - 0.09, roofH - 0.18, -0.35));
    glassParts.push(box(0.02, 0.34, 1.35, -(halfW - 0.09), roofH - 0.18, -0.35));
    trimParts.push(box(0.06, 0.5, 0.06, halfW - 0.15, roofH - 0.18, 0.45, 0.62));
    trimParts.push(box(0.06, 0.5, 0.06, -(halfW - 0.15), roofH - 0.18, 0.45, 0.62));
    // F4 V1: B-pillar 0.06 -> 0.12 m so the side glass reads as two panes,
    // not one aquarium sheet.
    trimParts.push(box(0.12, 0.5, 0.06, halfW - 0.09, roofH - 0.18, -0.35));
    trimParts.push(box(0.12, 0.5, 0.06, -(halfW - 0.09), roofH - 0.18, -0.35));
    trimParts.push(box(0.06, 0.5, 0.06, halfW - 0.15, roofH - 0.18, -0.85, isHatch ? -0.42 : -0.52));
    trimParts.push(box(0.06, 0.5, 0.06, -(halfW - 0.15), roofH - 0.18, -0.85, isHatch ? -0.42 : -0.52));
    // Dark interior bench + headrests, faintly visible through the glass.
    trimParts.push(box(W - 0.4, 0.3, 1.6, 0, 0.85, -0.2));
    trimParts.push(box(0.3, 0.18, 0.12, 0.45, 1.05, 0.15));
    trimParts.push(box(0.3, 0.18, 0.12, -0.45, 1.05, 0.15));
  }

  // ---- wheel arches: half-cylinder shells hugging each wheel ----
  // F4 V2: wheelZ 1.45 -> 1.40 (visual wheelbase 2.80 = CAR.wheelbase).
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      trimParts.push(
        cyl(wheelR + 0.06, wheelR + 0.06, 0.14, 12, sx * (halfW + 0.01), wheelR + 0.06, sz * 1.4, 0, 0, Math.PI / 2, 0, Math.PI),
      );
    }
  }

  // ---- door lines, handles, side skirts ----
  for (const sx of [-1, 1]) {
    const x = sx * (halfW + 0.01);
    trimParts.push(box(0.02, 0.5, 0.04, x, 0.5, 0.3));
    trimParts.push(box(0.02, 0.5, 0.04, x, 0.5, -0.9));
    // F4 V3: handles moved trim -> chrome mesh (see chromeParts).
    chromeParts.push(box(0.03, 0.05, 0.3, x, 0.75, 0.3));
    chromeParts.push(box(0.03, 0.05, 0.3, x, 0.75, -0.9));
    trimParts.push(box(0.04, 0.12, 3.6, x, 0.28, 0));
  }
  // Hood / deck shut lines (thin dark seams across the top).
  // F4 V2: follow the new hood rear edge (1.055) and deck front edge (-1.33).
  if (!isVan) {
    trimParts.push(box(W - 0.1, 0.03, 0.04, 0, 0.78, halfL - 1.145));
    trimParts.push(box(W - 0.1, 0.03, 0.04, 0, 0.78, -(halfL - 0.87)));
  }

  // ---- bumpers, grille + slats, valance, exhausts, plate ----
  // F4 V2: every front/rear face follows the new ends (+0.15 m).
  trimParts.push(box(W + 0.04, 0.22, 0.14, 0, 0.42, halfL + 0.18));
  trimParts.push(box(W + 0.04, 0.22, 0.14, 0, 0.42, -(halfL + 0.18)));
  trimParts.push(box(1.2, 0.18, 0.08, 0, 0.62, halfL + 0.21));
  for (const y of [0.56, 0.62, 0.68]) {
    trimParts.push(box(1.2, 0.03, 0.02, 0, y, halfL + 0.26));
  }
  trimParts.push(box(W, 0.14, 0.1, 0, 0.3, -(halfL + 0.17)));
  trimParts.push(cyl(0.05, 0.05, 0.15, 8, 0.5, 0.3, -(halfL + 0.23), Math.PI / 2));
  trimParts.push(cyl(0.05, 0.05, 0.15, 8, -0.5, 0.3, -(halfL + 0.23), Math.PI / 2));
  // Plate + fog dots must sit IN FRONT of the bumper face (halfL + 0.25),
  // otherwise the bumper swallows them.
  whiteParts.push(box(0.44, 0.12, 0.02, 0, 0.45, -(halfL + 0.26)));
  // F4 V3: front plate (+12 tri).
  whiteParts.push(box(0.44, 0.12, 0.02, 0, 0.45, halfL + 0.26));

  // ---- headlights + fog dots (front), tail lenses (rear) ----
  // F4 V3: black housings (trim) frame the lamps; the old 0.40x0.18 white
  // teeth are resized to 0.36x0.12 and sit INSIDE the housing (upper half)
  // with an LED strip (head mesh) on the black lower half — the strip only
  // reads on black, and keeping the full-size teeth would preserve M-13.
  // Strip depth 0.08 sets it into the housing, flush with the grille face.
  for (const sx of [-1, 1]) {
    trimParts.push(box(0.5, 0.24, 0.06, sx * 0.6, 0.62, halfL + 0.17));
    headParts.push(box(0.36, 0.12, 0.1, sx * 0.6, 0.66, halfL + 0.17));
    headParts.push(box(0.38, 0.035, 0.08, sx * 0.6, 0.545, halfL + 0.21));
  }
  headParts.push(box(0.12, 0.12, 0.06, 0.75, 0.35, halfL + 0.27));
  headParts.push(box(0.12, 0.12, 0.06, -0.75, 0.35, halfL + 0.27));
  headParts.push(box(0.2, 0.1, 0.05, 0.6, 0.45, -(halfL + 0.17)));
  headParts.push(box(0.2, 0.1, 0.05, -0.6, 0.45, -(halfL + 0.17)));
  // F4 V1: tail bar replaced by a black housing (trim) + two red lenses +
  // a centre strip (tail) — the old full-width bar vanished on red paint
  // (M-4). Lenses sit 0.03 m proud of the housing face.
  // F4 V2: housing/lenses follow the new rear end (+0.15 m).
  trimParts.push(box(1.78, 0.2, 0.06, 0, 0.62, -(halfL + 0.17)));
  tailParts.push(box(0.55, 0.14, 0.06, 0.6, 0.62, -(halfL + 0.2)));
  tailParts.push(box(0.55, 0.14, 0.06, -0.6, 0.62, -(halfL + 0.2)));
  tailParts.push(box(0.5, 0.14, 0.06, 0, 0.62, -(halfL + 0.2)));

  // ---- mirrors on stalks ----
  // F4 V3: mirror housings move trim -> paint (body colour); stalks stay trim.
  for (const sx of [-1, 1]) {
    trimParts.push(box(0.05, 0.05, 0.18, sx * (halfW + 0.03), 1.05, 0.75));
    paintParts.push(box(0.16, 0.14, 0.28, sx * (halfW + 0.07), 1.12, 0.75));
  }

  // ---- kind extras ----
  let redLamp = null;
  let blueLamp = null;
  if (isHero) {
    // F4 V1: spoiler 1.80x0.50 @ y 1.18 -> 1.50x0.35 @ y 0.98 — the old
    // table covered half the rear glass and ~90% of the rear width (M-5).
    trimParts.push(box(1.5, 0.08, 0.35, 0, 0.98, -(halfL - 0.25)));
    trimParts.push(box(0.05, 0.18, 0.35, 0.73, 0.9, -(halfL - 0.25)));
    trimParts.push(box(0.05, 0.18, 0.35, -0.73, 0.9, -(halfL - 0.25)));
    trimParts.push(box(0.08, 0.18, 0.08, 0.6, 0.89, -(halfL - 0.25)));
    trimParts.push(box(0.08, 0.18, 0.08, -0.6, 0.89, -(halfL - 0.25)));
  }
  if (isPolice) {
    // White roof + white door panels, light bar, push bar.
    // F4 V2: roof panel follows the sedan roof (1.55 @ z -0.35); light-bar
    // base/lenses follow the roof centre (-0.35); push bar +0.15 m.
    whiteParts.push(box(W - 0.24, 0.06, 1.55, 0, roofH + 0.01, -0.35));
    // F4 V1 (S0 bug fix): door panels were at +-(halfW-0.08)=+-0.87, i.e.
    // 0.07 m INSIDE the body face (+-0.95) — only a 0.15 m sliver showed.
    // At +-0.96 the panel face (0.97) stands proud of the body (M-8).
    whiteParts.push(box(0.02, 0.5, 1.2, halfW + 0.01, 0.55, -0.2));
    whiteParts.push(box(0.02, 0.5, 1.2, -(halfW + 0.01), 0.55, -0.2));
    trimParts.push(box(1.2, 0.1, 0.5, 0, roofH + 0.12, -0.35));
    trimParts.push(box(0.08, 0.4, 0.08, 0.5, 0.5, halfL + 0.25));
    trimParts.push(box(0.08, 0.4, 0.08, -0.5, 0.5, halfL + 0.25));
    trimParts.push(box(1.1, 0.08, 0.08, 0, 0.65, halfL + 0.27));
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
  // F4 V3: chrome door handles — their own mesh (rim material), +1 call.
  group.add(new THREE.Mesh(mergeParts(chromeParts), MAT.rim()));
  if (whiteParts.length) {
    group.add(new THREE.Mesh(mergeParts(whiteParts), MAT.white()));
  }
  if (isTaxi) {
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.15, 0.25),
      MAT.taxiSign(),
    );
    sign.position.set(0, roofH + 0.08, -0.35);
    group.add(sign);
  }
  if (isPolice) {
    const redMat = MAT.redLens();
    const blueMat = MAT.blueLens();
    redLamp = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.22, 0.5), redMat);
    redLamp.position.set(-0.3, roofH + 0.28, -0.35);
    blueLamp = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.22, 0.5), blueMat);
    blueLamp.position.set(0.3, roofH + 0.28, -0.35);
    group.add(redLamp);
    group.add(blueLamp);
  }

  // ---- wheels ----
  const wheels = [];
  const wheelX = halfW - 0.1;
  // F4 V2: wheelZ 1.45 -> 1.40 (visual wheelbase 2.80 = CAR.wheelbase).
  const wheelZ = 1.4;
  if (interactive) {
    // Hero: each wheel gets a steer group + a spin group (tire + rim).
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const steer = new THREE.Group();
        steer.position.set(sx * wheelX, wheelR, sz * wheelZ);
        const spin = new THREE.Group();
        spin.add(new THREE.Mesh(tireGeometry(wheelR, wheelW), MAT.tire()));
        // F4 V3: rim disc r 0.20 -> 0.23 (hero).
        spin.add(new THREE.Mesh(rimGeometry(0.23, wheelW + 0.02), MAT.rim()));
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
        // F4 V3: static rim disc r 0.19 -> 0.23; spokes inside the tyre
        // face (outer face 0.14 m vs tyre face 0.15 m — same -0.035
        // correction as rimGeometry; the spec's literal -0.01 leaves +0.015
        // and fails C-A4).
        rimParts.push(cyl(0.23, 0.23, wheelW + 0.02, 12, px, wheelR, pz, 0, 0, Math.PI / 2));
        for (const face of [-1, 1]) {
          for (let k = 0; k < 5; k++) {
            rimParts.push(
              box(0.05, 0.57, 0.06, px + face * (wheelW / 2 - 0.035), wheelR, pz, (k * Math.PI * 2) / 5),
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
