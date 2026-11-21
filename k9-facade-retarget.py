#!/usr/bin/env python3
"""K9_ retarget — verified from the K9 render: the cover/chase frames are
dominated by the strand row (z>=192, h 10-30), NOT the h>30 downtown
towers, so the first K9 gating put every band + balcony where the cover
camera never looks. Retarget both to the strand row. Exact-string
replaces, each anchor must match exactly once or abort with no write."""
PATH = "game/src/gfx.js"
src = open(PATH).read()

def replace_once(old, new, label):
    global src
    n = src.count(old)
    assert n == 1, f"{label}: anchor count {n}, expected 1 — ABORT, file untouched"
    src = src.replace(old, new)

# --- Retarget 1: string course from downtown towers to the strand row ---
old_band = """      // K9_ string course: one protruding mid-height band, tall
      // buildings only. The city has 266 buildings — a band on every
      // one would cost 266 boxes / 3,192 tris, far over this round's
      // 1,500-tri budget; the h>30 towers are the skyline that reads
      // from the cover angle. Colour is the palette entry 3 steps from
      // the facade, so the band never matches its own wall.
      if (b.h > 30) {"""
new_band = """      // K9_ string course: one protruding mid-height band on the
      // strand row (z>=192, 24 buildings) — the row that lines the
      // cover/chase right edge. First K9 pass gated this on h>30, but
      // the render proved the cover frame's dominant buildings are the
      // strand row (h 10-30): downtown bands never showed from the
      // cover angle. The city has 266 buildings, so a band on every
      // one would cost 266 boxes / 3,192 tris, far over this round's
      // 1,500-tri budget. Colour is the palette entry 3 steps from
      // the facade, so the band never matches its own wall.
      if (b.z >= 192) {"""
replace_once(old_band, new_band, "band-retarget")

# --- Retarget 2: balconies also on the strand row (seed 22 picks the
# cover's key buildings: the pink (-19,208), the orange tower
# (-77,211), (-66,209), (65,218) and (114,216); seed 17 missed the
# pink one). Downtown set unchanged. ---
old_balc = """      // K9_ balconies: same tall-building set as before (h>30,
      // hash<0.33 — widening to h>20 / <0.5 would add ~500 boxes /
      // ~6,000 tris, far over this round's 1,500-tri budget), but one
      // floor higher (1-3) and in light cream, so slab and rail read
      // against the saturated facades instead of vanishing as dark grey.
      if (b.h > 30 && hash2(Math.round(b.x), Math.round(b.z), 17) < 0.33) {"""
new_balc = """      // K9_ balconies: downtown set as before (h>30, hash<0.33 —
      // widening that to h>20 / <0.5 would add ~500 boxes / ~6,000
      // tris, far over this round's 1,500-tri budget) PLUS the strand
      // row (z>=192, h>15, seed 22 <0.5: 9 buildings incl. the cover's
      // pink (-19,208) and orange tower (-77,211)), one floor higher
      // (1-3) and in light cream, so slab and rail read against the
      // saturated facades instead of vanishing as dark grey. The
      // strand faces point south, toward the cover/chase camera.
      const K9_balcDowntown = b.h > 30 && hash2(Math.round(b.x), Math.round(b.z), 17) < 0.33;
      const K9_balcStrand = b.z >= 192 && b.h > 15 && hash2(Math.round(b.x), Math.round(b.z), 22) < 0.5;
      if (K9_balcDowntown || K9_balcStrand) {"""
replace_once(old_balc, new_balc, "balcony-retarget")

open(PATH, "w").write(src)
print("K9_ retarget applied")
print("new boxes vs K8: strand bands 24 + downtown balc 46 + strand balc 54 = 124 boxes = 1,488 tris; cover ~493,352")
