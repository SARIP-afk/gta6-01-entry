#!/usr/bin/env python3
"""K9_ facade edit — exact-string replaces, each anchor must match exactly once.
Aborts (no write) on any mismatch. Run from repo root."""
import sys

PATH = "game/src/gfx.js"
src = open(PATH).read()

def replace_once(old, new, label):
    n = src.count(old)
    assert n == 1, f"{label}: anchor count {n}, expected 1 — ABORT, file untouched"
    return src.replace(old, new)

# --- Edit 1a: saturated K9_ palette definition (replaces FACADE_TINTS) ---
old_palette = """// Warm sunset tints washed over each facade, now including the teal and
// sand-beige of the Kumala palette so the skyline is not only orange.
const FACADE_TINTS = ['#ff9a5a', '#ff7a8a', '#ffc46b', '#ff8a4d', '#3fa8a0', '#d8c08a'];"""
new_palette = """// K9_ saturated facades: one loud colour per building (pink / teal /
// yellow / green / orange / gold / magenta / sea-blue), picked by hash,
// so the skyline reads as a coloured city at cover distance instead of
// one mauve-brown mass. The old wash (15-35% tint over a brown base)
// let the brown base dominate — that is gone.
const K9_FACADE_COLORS = ['#e84393', '#2ec4b6', '#ffd166', '#06d6a0', '#f4845f', '#e9c46a', '#d81159', '#118ab2'];"""
src = replace_once(old_palette, new_palette, "palette")

# --- Edit 1b: facade body at full palette strength ---
old_facade = """      // Each facade leans toward a different warm tone so the sunset
      // skyline is not one uniform mauve, and the body maps onto the
      // atlas tile — a framed window plus a floor line on every bay,
      // lined up with the instanced window grid — at zero extra draw
      // calls and zero extra triangles.
      const tintPick = pickFrom(FACADE_TINTS, hash2(bxr, bzr, 41));
      const tint = rgbFromHex(tintPick);
      const tintAmt = 0.15 + f * 0.2;
      const wall = tinted(b.color, 0.92 + f * 0.16);
      const facade = [0, 1, 2].map((ch) => lerp(wall[ch], tint[ch], tintAmt));
      solid.add(b.x, b.h / 2, b.z, b.w, b.h, b.d, facade, 0, 0, 0, { bx: b.w / colsX, bz: b.d / colsZ, floorH: 3.4, y0: 0 });"""
new_facade = """      // K9_ facade: the palette colour at FULL strength — the atlas
      // tile ground is near-white, so the vertex colour passes through
      // almost untouched, and the body still maps onto the tile (a
      // framed window plus a floor line on every bay, lined up with
      // the instanced window grid) at zero extra draw calls and zero
      // extra triangles. Only a small brightness wobble (±10% via f)
      // is kept, so no two neighbours read as the same flat swatch.
      const K9_facadeIdx = Math.floor(hash2(bxr, bzr, 41) * K9_FACADE_COLORS.length) % K9_FACADE_COLORS.length;
      const facade = tinted(K9_FACADE_COLORS[K9_facadeIdx], 0.9 + f * 0.2);
      solid.add(b.x, b.h / 2, b.z, b.w, b.h, b.d, facade, 0, 0, 0, { bx: b.w / colsX, bz: b.d / colsZ, floorH: 3.4, y0: 0 });"""
src = replace_once(old_facade, new_facade, "facade")

# --- Edit 2: thicker cornice + one string-course band (tall buildings only) ---
old_cornice = """      solid.add(b.x, b.h - 0.15, b.z, b.w + 0.3, 0.35, b.d + 0.3, corniceCol);"""
new_cornice = """      solid.add(b.x, b.h - 0.15, b.z, b.w + 0.3, 0.6, b.d + 0.3, corniceCol);
      // K9_ string course: one protruding mid-height band, tall
      // buildings only. The city has 266 buildings — a band on every
      // one would cost 266 boxes / 3,192 tris, far over this round's
      // 1,500-tri budget; the h>30 towers are the skyline that reads
      // from the cover angle. Colour is the palette entry 3 steps from
      // the facade, so the band never matches its own wall.
      if (b.h > 30) {
        const K9_band = K9_FACADE_COLORS[(K9_facadeIdx + 3) % K9_FACADE_COLORS.length];
        solid.add(b.x, b.h / 2, b.z, b.w + 0.3, 0.3, b.d + 0.3, K9_band);
      }"""
src = replace_once(old_cornice, new_cornice, "cornice")

# --- Edit 3: balconies — one floor higher, light cream slab + rail ---
old_balc = """      // sparse balconies on tall buildings
      if (b.h > 30 && hash2(Math.round(b.x), Math.round(b.z), 17) < 0.33) {
        for (let fl = 1; fl <= 2; fl++) {
          const y = 3.4 * fl + 2.6;
          solid.add(b.x, y, b.z + b.d / 2 + 0.7, b.w * 0.5, 0.25, 1.5, '#7a7568');
          solid.add(b.x, y + 0.6, b.z + b.d / 2 + 1.4, b.w * 0.5, 0.9, 0.08, '#4a4e57');
        }
      }"""
new_balc = """      // K9_ balconies: same tall-building set as before (h>30,
      // hash<0.33 — widening to h>20 / <0.5 would add ~500 boxes /
      // ~6,000 tris, far over this round's 1,500-tri budget), but one
      // floor higher (1-3) and in light cream, so slab and rail read
      // against the saturated facades instead of vanishing as dark grey.
      if (b.h > 30 && hash2(Math.round(b.x), Math.round(b.z), 17) < 0.33) {
        for (let fl = 1; fl <= 3; fl++) {
          const y = 3.4 * fl + 2.6;
          solid.add(b.x, y, b.z + b.d / 2 + 0.7, b.w * 0.5, 0.25, 1.5, '#e8e0cc');
          solid.add(b.x, y + 0.6, b.z + b.d / 2 + 1.4, b.w * 0.5, 0.9, 0.08, '#f5efe0');
        }
      }"""
src = replace_once(old_balc, new_balc, "balcony")

open(PATH, "w").write(src)
print("K9_ edits applied: palette + facade + cornice/string-course + balcony")
print("new boxes: string-course 55 (h>30) + balcony +46 (23 bldgs x 2) = 101 boxes = 1,212 tris")
