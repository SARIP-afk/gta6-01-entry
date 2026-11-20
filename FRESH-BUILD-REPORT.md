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

## What is NOT done / needs a human

- **Not submitted.** No submit, no fee, no slot used — the last slot (3/3) is untouched; submission needs syarif's explicit word (deadline 24 Nov 22:00 WIB).
- **Not play-tested by a human.** Only headless renders + Node sim checks. Real-keyboard play (driving feel, shooting, M2–M4 completion) is unverified.
- Known cosmetic notes: sunset HUD text (cash, HEAT label) can sit on bright clouds; night-market ground is dark away from the lights (by design — lights are the readability); marina boats sit on dark ground (no marina water plane east of the grid); clouds are flat white slabs.
- Headless FPS (1–2) is a SwiftShader artefact, not a game measurement.
- `verify-shots/` PNGs are kept in the worktree (uncommitted) as the visual record.

## How to run / re-verify

```sh
cd ~/workspace/makefun/gta6-01-fresh
node --experimental-strip-types serve.ts --port 8091   # game on http://localhost:8091
node driver.mjs http://127.0.0.1:8091 verify-shots     # all 8 shots, PNG + errors
MAKEFUN_OUTPUT_DIR=/tmp/fresh-out node main.ts         # dossier hand-in check
```
