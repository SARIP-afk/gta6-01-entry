# Solmarina — fresh build report (v4.8 stopped 20 Nov 19:57 WIB; built from zero)

Built against `~/workspace/makefun/gta6-01-fresh-visual-bar.md`: the two Karimbu
frames (night market / beach chase) as the bar — **blocky but DETAILED, never
flat colours**. No code was copied from the v4.x rebuild; every module below
was written fresh in this session (new layout, sim, renderer, HUD, shots).

## What was built

`game/` (10 files, ~800 KB incl. vendored three.js r160):

| File | What it is |
|---|---|
| `index.html` | Shell + Karimbu-style HUD (edge panels, clean centre, square minimap) |
| `src/util.js` | Seeded RNG (`mulberry32`) + coordinate hash — no `Math.random` in sim/render |
| `src/layout.js` | Deterministic city: 48 m road grid, 266 buildings, market plaza, beach, marina, pier, stadium; all objectives sit on roads (see fixes) |
| `src/sim.js` | Fixed 1/60 s sim: walk/drive, steal cars, 30 traffic + 48 peds, police 6-tier wanted + heli at 4+, 4 missions × 2 stages with par + Gold/Silver/Bronze, pistol combat + gunmen, crew abilities (Z/X/C), 20 shells, save slots ×3, trace hash |
| `src/gfx.js` | Renderer implementing the full detail inventory (below) |
| `src/hud.js` | DOM HUD + 132 px square minimap (click to fast-travel), pause tabs MAP/STORY/STATS/SAVE |
| `src/sound.js` | Procedural WebAudio: 3 radio stations, engine hum, gunshots |
| `src/shots.js` | 8 staged scenes (`?shot=cover\|start\|play\|end\|market\|nightmarket\|beach\|chase`), Manhattan autopilot |
| `src/main.js` | Boot, fixed-step loop, keyboard/mouse input, quality tiers LOW 0.75× / MED 1× / HIGH 1.5× |
| `vendor/three.module.min.js` | three.js r160 (library, vendored as the kit requires) |

## Detail inventory — all 13 items shipped

1. Plaza tile grid (4096 px canvas ground texture: 4 m tiles, grout, per-tile hash shade; roads with dashes + crosswalks; sand with dune bands + speckles).
2. Window mullions — thin proud bars, low-rise only (h ≤ 20; trimmed from h ≤ 35 for the triangle budget).
3. Shopfronts on every south face: 2 dark-glass windows + door + gold sign band.
4. Balconies on ~1 in 3 tall buildings, 2 floors (slab + rail).
5. Striped stall awnings (5 alternating stripes), goods piles, crates, 2 warm lanterns per stall.
6. String lights between market stalls (catenary sag, warm Basic bulbs) — the night-market read.
7. Segmented umbrellas (4 alternating strips, raised centre, gold finial), striped towels, beach balls.
8. Two-ring palms (upper ring pitched up, lower drooping; trunk bands; coconuts).
9. Car glass + kinds: tapered bodies, sloped windshield/rear glass, taxi roof signs, van cabins, police push bar + flashing light bar, sculpted hero sports car (spoiler, mirrors, skirts, hubcaps, grille).
10. People: hair caps, skin arms/head, pants palette via instanced colour; hero on foot (tee, belt, shoes); gunmen with legs.
11. Helicopter: glass cockpit + frame bar, tail boom/fin/stabiliser, skids, gold stripe, nav lights, 2 rotor bars, translucent rotor disc, searchlight cone.
12. Street props at fixed spots: bins, benches, planters, cones (~80 boxes).
13. Night readability: all light sources are Basic-material objects (lit windows, lamps, string lights, lanterns, signs, headlights) — the 21:30 market reads without the HUD.

## Measured verification (headless Chromium 1187 + SwiftShader, 1280×720)

- All 8 staged shots: `ready=true`, **0 console errors**, each viewed as a PNG.
- Draw calls **76**, triangles **372,810** (budget < 500k; first measurement was 704,586 — trimmed via wider window spacing 4.2 → 6.0 m and mullions h ≤ 20).
- Determinism (Node): seed-1 trace hash identical across two runs (`2a5f4e7a`), seed-2 differs (`f092edea`).
- Staged scenes end in the intended state (Node check): play in-car, 16% damage, M1 stage advanced; cover wanted 3 + heli; chase wanted 4 + heli.
- `main.ts` hand-in verified: `MAKEFUN_OUTPUT_DIR=/tmp/fresh-out node main.ts` → exit 0; dossier has 4 images, text 130,135 bytes (< 163,840 cap); 10 game files, 800,102 bytes.
- Headless FPS is 1–2 (SwiftShader software rendering only — the same setup the v4.x builds used; 76 calls / 373k tris is comfortably GPU-light on real hardware).

## Bugs found and fixed during verification

- `setCamOverride` stored plain objects → `camera.lookAt` got NaN and nothing rendered. Now stores `THREE.Vector3`.
- Duplicate `id="district"` — `setText` wiped the district panel (incl. `standing-fill`) → HUD threw every frame, title screen never hid. Renamed outer panel.
- `armour` lives on `player`, but sim gunmen + HUD read `s.armour` → NaN. Fixed to `s.player.armour`.
- Police ram applied +2 damage **per step** while overlapping → wrecked the cover car in 2 s. Now +0.2/step, only at speed, plus a 0.4 s shared collision cooldown for building/traffic bumps (play damage 76 → 16).
- Autopilot router: degenerate waypoint when the target shared its x (drove into a block and wrecked). Rewrote as proper Manhattan routing to the road-aligned target + direct drive inside 40 m + steps capped at remaining distance (lands on the z=24 causeway).
- Objectives sat mid-block inside building footprints (downtown pickup, marina drop, gold-van start). All moved onto roads; the van route now follows roads only.
- Staged cameras placed mid-block/in buildings (cover, chase ×2, start ×2) — all moved onto roads after checking real footprints from `buildLayout(1)`.
- Pier deck at y=0.9 hid the car underneath → lowered to road level (y=0.12).
- Cover/chase helis staged above the frame edge or behind towers → re-placed in-frame (cover: close + low; chase: over the road).
- Play follow camera never settled headless → `snapFollow()` after staging.
- Palette mix returned raw numbers for colour keys → three's fog uniforms threw every frame. Now always returns `THREE.Color`.

## Sunset-chase pass (refs 3 & 4, 20 Nov ~21:00–22:00 WIB)

Two more Karimbu frames arrived as the bar after the first build
(`~/workspace/user/files/1000118044_0_kkwj.jpg` coastal sunset chase,
`~/workspace/user/files/1000118038_1_k4d3.jpg` beach sunset, draw calls
185): the sunset itself is a subject, and the chase runs along the coast
road toward the sun. Changes (render-only + staging, no sim changes):
- Gradient sky dome (BackSide sphere, 4×256 canvas, repainted per 0.25 h
  bucket from the time-of-day palette).
- Sun glitter path on the sea (warm gradient plane, long axis aimed at the
  sun azimuth, opacity follows the sunset factor).
- Lighthouse on the western headland (−280, 348): rock + banded tower +
  glowing lamp.
- Marina water: two planes east of the grid (clear of the causeway) so
  the moored boats float.
- Clouds: sunset-warm / night-dark tint, opacity 0.55, flattened to
  3.5 m, spread extended over the sea.
- Denser palms along the beach road (step 12 m) + second umbrella row
  (z ≈ 282).
- HUD: stronger text shadows on cash/clock/stars/wanted/speed.
- Re-staged `cover` + `chase` as the ref-3 composition (westbound on the
  z = 240 coast road at 18:00, low camera behind the hero, heli big
  ahead-left over the sea) and `beach` as a sunset view from the sand.
- Staging fixes found by viewing: the first chase/cover cameras sat
  inside palm crowns (giant frond across the frame) and the hero was
  clipped/half-hidden behind a police car — cameras moved onto the road
  centreline, police pushed back, heli moved onto the view axis.
- Measured: all 8 shots ready, 0 console errors; draw calls 48–99,
  triangles 372,762–383,322 (< 500k); determinism re-verified (seed-1
  `3163c720` twice, seed-2 `f0239866`); dossier re-checked via `main.ts`
  (exit 0, 4 images, text 135,737 bytes < 163,840) with regenerated
  cover/start/play/end JPEGs. Remaining nits: sea reads as a thin dark
  band from the coast road (glitter subtle at a glancing angle); a cloud
  box can still peek over a roofline; east facades go dark brown at
  sunset. NOT submitted — last slot untouched, awaiting syarif's word.

## Visual round v2.3 — independent-verification fixes (20 Nov, ~22:00 WIB)

Two failures found by independent verification of the v2 render; both
fixed here, nothing submitted.

1. **`?shot=beach` staged on asphalt.** The hero stood at z = 284 — ON
   the z = 288 beach road (asphalt 282–294) — and the camera looked down
   the road, so the frame read as a street. Restaged in `src/shots.js`
   only: hero on foot at (-17, 266), on sand among the northern umbrella
   row (umbrella (-20.4, 263.1) + towel + ball 3 m away), camera at
   (-4, 5.5, 264) looking WSW — sun + lighthouse + sea at the left,
   5 beachgoers (seeded peds repositioned to fixed spots west of the
   hero, slow westward stroll) mid-frame, sand foreground. Two earlier
   tries were viewed and rejected: northern strip at camera z = 278 (road
   still filled the left half, lamp 10 m in front of the lens) and the
   southern strip at camera z = 300 (road filled the right half, umbrellas
   out of frame). Final PNG viewed: beach reads as a beach.
2. **`window.__stats` was `{}`.** `main.js` only wrote it when 1 s of
   *sim* time elapsed; headless SwiftShader runs 1–2 FPS, so 60 sim
   frames take 30–60 s wall time and the driver read before the branch
   ever fired. Now `window.__stats = renderer.stats()` every frame
   (cheap counter read) and `__fps` accumulates wall-clock time from the
   rAF timestamp instead of sim time.
- Re-verified, all 8 shots, 0 console errors: calls / triangles —
  cover 99 / 380,098; start 85 / 383,322; play 72 / 373,628;
  end 63 / 372,762; market 48 / 377,314; nightmarket 48 / 377,314;
  beach 56 / 377,534; chase 95 / 380,478 (budget ≤ 250 calls,
  ≤ 500k triangles). Other 7 shots byte-identical to the v2 render
  except end/chase, which differ by 0.11% / 0.24% of pixels — diff-map
  shows only the heli rotor angle + hero-car bob edge AA (both animate
  on renderer time, so a ±1 rAF frame before capture shifts their phase;
  two consecutive re-runs of end/chase are pixel-identical). No
  composition changed. `screenshots/3-end.jpg` regenerated from the fresh
  end PNG (PIL q85 — verified byte-identical reproduction of the v2
  cover JPG with the same settings). NOT submitted.

## What is NOT done / needs a human

- **Not submitted.** No submit, no fee, no slot used — the last slot (3/3) is untouched; submission needs syarif's explicit word (deadline 24 Nov 22:00 WIB).
- **Not play-tested by a human.** Only headless renders + Node sim checks. Real-keyboard play (driving feel, shooting, M2–M4 completion) is unverified.
- Known cosmetic notes: night-market ground is dark away from the lights (by design — lights are the readability); the sea reads as a thin dark band from the coast road and the sun glitter is subtle at a glancing angle; a cloud box can still peek over a roofline as a pale slab; east-facing facades go dark brown at sunset. (Fixed in the sunset-chase pass: sunset HUD text legibility, marina boats now float on water, clouds are warm-tinted and flattened.)
- Headless FPS (1–2) is a SwiftShader artefact, not a game measurement.
- `verify-shots/` PNGs are kept in the worktree (uncommitted) as the visual record.

## How to run / re-verify

```sh
cd ~/workspace/makefun/gta6-01-fresh
node --experimental-strip-types serve.ts --port 8091   # game on http://localhost:8091
node driver.mjs http://127.0.0.1:8091 verify-shots     # all 8 shots, PNG + errors
MAKEFUN_OUTPUT_DIR=/tmp/fresh-out node main.ts         # dossier hand-in check
```
