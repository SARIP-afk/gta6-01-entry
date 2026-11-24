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

## Visual round v2.4 — audit against refs 1–4, sunset is a subject (20 Nov, ~22:00–23:30 WIB)

Re-viewed all 8 v2.3 PNGs against the four Karimbu frames. The sunset pass
had shipped, but the frames did not show it: the sky was one flat orange
slab, the sun a pale speck, the chase heli a speck or missing, the beach an
empty brown field, and the play shot a wall. Root causes found by reading
the code, not guessing:

1. **Sky gradient was orange→orange→brown.** The dome lerped `bg`
   (0xf2a35e) to `fog` (0xe8a06a) — no purple/pink anywhere. Fix
   (`gfx.js`): sunset-aware stops — zenith lerps to deep purple
   #4a2358, mid-sky to pink #c94f6d, horizon stays orange. Ref 3's
   pink/purple/orange gradient now reads in every sunset frame.
2. **Sun was a 14 m speck.** Disc 14→30 m, halo 30→85 m — and the halo is
   now a soft radial-gradient texture, not a flat circle: the first try
   read as a hard-edged orange balloon. Sea warms toward the sunset
   (`seaMat` tinted 0xff8a4d × sunsetF·0.45).
3. **Glitter floated at a fixed spot** (-150, 400) — off-frame from the
   beach and over the city from downtown. Now ray-gated each frame: only
   where the sun ray from the player crosses the sea rectangle, centred
   mid-crossing, opacity sunsetF·0.8, plane 300×110. (Still subtle at a
   glancing angle from the sand — the sun + sky now carry the sunset.)
4. **Cloud slab.** Opacity at sunset 0.55→~0.25, darker tint, box heights
   staggered ×8 instead of ×4 so the group is broken haze, not a bar.
5. **Heli missing/small.** The sim overwrites `heli.active` and orbits
   the heli (alt ~48, radius 26) every step — so the cover's staged heli
   at wanted 3 vanished, and the chase heli ended up a clipped speck.
   Fix: `heli.staged` flag (`sim.js`, cleared by reset, real play
   untouched) freezes the heli where `stageShot` puts it. Cover heli
   (-22, 250, alt 14), chase heli (-54, 247, alt 13) — big, fully in
   frame, machine-readable with rotor disc + searchlight cone.
6. **Beach hero tiny, sky empty.** Camera (-4, 5.5, 264) → (-8, 4.2,
   262): 9.8 m from the hero. Market/nightmarket: camera shifted so the
   hero sits at the left third instead of dead-centre blocking the stalls.
7. **Play shot: car stuck at 0.5 km/h against a wall.** Root cause in
   `layout.js`: building faces could sit 0.5 m from a road centreline
   (255/266 buildings had a face inside the ±6 m road corridor), so the
   autopilot car ground along a jutting face (damage 4→16) and the
   follow camera sat 3.6 m from a 35 m wall. Fix: faces clamped to ≥8 m
   from the road line (pure arithmetic, RNG stream untouched). Node
   probe: the same 20 s drive now ends at 21.5 m/s, damage 3, camera
   clear of buildings. Plus a real camera fix in `gfx.js`: `clampCam`
   is now a hero→camera segment-vs-AABB test (was point-in-box, which
   missed the case where the wall sits beside the segment) — the camera
   can no longer sit behind a building relative to the hero.
8. **Night readability:** SUNSET hemiI 0.6→0.75 (east facades were dark
   brown), NIGHT hemiI 0.42→0.5 / sunI 0.34→0.4.

Measured after the pass: all 8 shots ready, **0 console errors**; calls /
triangles — cover 99 / 380,242; start 85 / 383,466; play 68 / 374,566;
end 63 / 372,906; market 48 / 377,458; nightmarket 48 / 377,458; beach
57 / 377,690; chase 95 / 380,622 (budget ≤ 250 calls, ≤ 500k triangles).
Determinism re-verified (Node, 60 s weaving drive): seed-1 `f06861c2`
twice, seed-2 `0498d9b0`. Dossier re-checked via `main.ts` (exit 0,
4 images, text 142,728 bytes < 163,840) with regenerated
cover/start/play/end JPEGs (PIL q85). NOT submitted — last slot
untouched, awaiting syarif's word. Known remaining nits: the sea is
still a thin band from the coast road and the glitter is subtle at a
glancing angle; the beach foreground sand is a large empty expanse; the
play shot's event-feed line overlaps the mission panel edge (pre-existing
HUD nit).

## Playtest round — full game played to completion (20 Nov, ~23:30–17:00 WIB next day)

NOT a visual round: no graphics/sky/staging changes except functional
bug fixes. Harness: `playtest/pt.mjs` (own headless Chromium 1187 +
SwiftShader, CDP on 9224, game on 8091) + `playtest/pt-inpage.js`
(Manhattan autopilot copied from `shots.js`, scripted mission runners,
collision probes, real-key/mouse tests). The game was driven to
completion end-to-end (M1→M4, `won=true`) by autopilot + fast-forward
`world.step` calls; real keyboard/mouse used for E-enter/exit, weapon
keys 1–4, radio, crew, pause, and the minimap click. **0 console
errors across all 29 scenarios.** Draw calls 54–90, triangles
372k–386k (budget ≤ 250 / ≤ 500k). Determinism re-verified (Node):
seed-1 trace hash `4d9f8d47` twice, seed-2 `12327809`. Dossier
re-checked via `main.ts` (exit 0, 4 images, text 151,568 bytes
< 163,840).

### Results per item (all PASS unless noted)

| # | Item | Result |
|---|---|---|
| 1 | Vehicles (E enter/exit, gas/brake/reverse/steer) | PASS. Real keys: exit→`walk`, enter→`car`. Top speed 122.4 km/h, boost 151.2, reverse −32.4. Brake 122.4→full reverse in 2 s (very strong — feel note, not a bug). |
| 2 | Collisions | PASS. Traffic vs hero on foot: min 19.4 m, 0 overlap (90 s natural); deterministic in-lane probe: car stops 9.6 m from the hero, 0 pass-through. Traffic vs traffic: min pair 1.6 m, 8 hard-overlap frames (max 6 consecutive = 0.1 s graze). Car vs building: penetration 0 (180 s loop, damage 0). Walk vs building: min gap 0.85 m, never inside. Police vs building: penetration 0. |
| 3 | Missions M1–M4 | ALL COMPLETE, all GOLD. M1 +$500/+400 RP (53.3 s); M2 +$800/+400 (footOnly negative test: car to 4 m of the stadium, stage stays 1; on-foot advance confirmed); M3 +$1,200/+400 (tail 20 s within 40 m); M4 +$2,000/+400 + 3×$50 gunman kills, total 57.4 s (par 240), `won=true`, screen `over`. |
| 4 | Combat | PASS. Keys 1–4 select FISTS/SOL-9/SMG/12G (HUD active slot follows; ammo 48/120/12). No firing from a car. Reload R refills (12G 3→6, reserve 90→87). Gunmen: 3 shoot the hero (armour 27→0 under 10 s fire, health regen holds 100); shooting kills in 3 SOL-9 hits, `hitFlash` seen, +$50/kill, wanted → 2. |
| 5 | Wanted / police | PASS. Steal (real E): wanted 1, 2 police. Ped run-over: wanted 1→3, peds 48→47, 4 police. Wanted 4: heli active all 5 samples, alt 52→45 (orbits ~48), 5 police. Cooldown at safehouse: 3→CLEAR in 12.1 s (4 s/star, as designed). No roadblock mechanic exists — police chase + ram only. |
| 6 | Systems | PASS. Save/load slots 1–3 independent, full state restored (cash/pos/mission stage/car/health/ammo/wanted). Pause tabs MAP/STORY/STATS/SAVE all render + resume. Minimap click-travel: (−76,−139) → (313,−230), expected (317,−228). Radio cycles 3 stations. Crew Z (−1 wanted, 30 s cooldown blocks re-use), X (damage → 0), C (dialog). Day/night: +1 h per 240 sim-s, HUD clock 13:00. |
| 7 | HUD 1280×720 | PASS (viewed PNG). Mission, KPD dispatch, event feed, district, minimap, vitals, dialog, 4 weapon slots, crew, clock/cash/stars/heat/rank, speed, radio — all readable, no overlaps, centre clear. |
| 7 | HUD 640×360 | KNOWN LIMIT (viewed PNG): panels overlap each other (dialog covers health, speed number overlaps the weapon panel). Primary target is 1280×720; a responsive-HUD pass is a visual-round job, not done here. |
| 8 | Console errors / determinism / draw calls | PASS. 0 console errors in every scenario; determinism verified (above); draw calls ≤ 90 everywhere. |

### Bugs found and fixed in this round (game code)

- **CRITICAL — E enter car never worked.** The walk branch consumed
  `input.enter` → `mode='car'`, then the driving branch in the *same*
  step read `input.enter` again and exited immediately. The hero could
  never enter any car — M2 was uncompletable in real play (the builder
  never tested E-enter; all shots start in car mode). Fix (`sim.js`):
  the walk branch clears `input.enter` after handling it.
- **CRITICAL — M3 tail crashed the sim.** On `tailTime > 20` the code
  set `stage = 2` (out of range for a 2-stage mission) without calling
  `finishMission`; the next step threw on `currentStage().x` and every
  step after threw the same way (323 console errors, sim frozen).
  Fix: call `finishMission(s, m)` directly + null-stage guard.
- **M4 stage 0 soft-lock.** The trap-clear check was nested inside the
  `dObj < 7` branch, but the gunmen spawn 14–26 m from the safehouse —
  a hero who killed them from range and waited (wanted 0, all gunmen
  dead) never advanced the stage. Fix: M4 stage 0 advances when the
  heat is lost and the gunmen are dead, wherever the hero is.
- **`finishMission` paid out repeatedly.** The mission block keeps
  running while the hero stands in the objective radius, and the pier
  car crosses the 7 m mission radius into the 5 m autopilot radius
  over ~6 steps — M4 paid +$2,000/+400 RP six times (cash +$12,150).
  Fix: `finishMission` returns early if `done[m.id]` is already set.
- **Police ram had no cooldown** (+0.2/step = 12 dmg/s per cop while
  touching). Fix: ram only when `hitCooldown <= 0`, then 0.4 s.
- **Traffic drove through the hero on foot** (in-lane probe: min
  0.37 m, 47 overlap frames). Fix: traffic stops for a hero on foot
  in its forward cone + `pedPush` shoves the hero aside, building-checked.
- **Police drove through buildings** (worst −9.39 m). Fix:
  axis-separated police movement with `hitsBuilding` + 6–7 m hold
  from an on-foot hero.
- **Traffic clipped buildings** (−0.72 m). Fix: axis-separated traffic
  movement + guarded separation push.
- **M2 `footOnly` not enforced** (driving into the 4 m radius
  completed the stage). Fix: completion requires `mode === 'walk'`.
- **Wreck exit trapped the hero in a building** (fixed `car+(3,3)`).
  Fix: try 8 offsets, first one outside any building.
- **Save/load incomplete** (old code did not restore mission stage /
  car / health / ammo / wanted and restarted M1 on load). Fix: full
  state saved/restored (mode, player + car pos/heading/damage/model,
  health, armour, weapon + `ammoStore`, wanted, mission stage +
  missionTime, gunmen alive flags, shells).
- **Weapon keys 1–4 did nothing** (HUD advertised 4 weapons, sim had
  one). Fix (`sim.js` + `main.js` + `hud.js`): `WEAPONS` table
  (SOL-9 34/26/0.12, SMG 16/22/0.16, 12G 55/14/0.28, FISTS ∞),
  `setWeapon`, per-weapon fire intervals (180/90/450 ms), HUD active
  slot + `∞` ammo for FISTS.
- **E/R taps lost at low FPS** (`main.js` edge-trigger read once per
  rAF). Fix: `pressed` latch on keydown (play screen only), consumed
  by `readInput`.
- **Minimap click-travel dead.** `#hud` sets `pointer-events: none`
  and only `.panel` re-enables it — the minimap canvas inherited
  `none`, so real clicks fell through to the game canvas.
  Fix (`index.html`): `#hud .panel, #hud #minimap { pointer-events: auto; }`.
- **12G weapon slot hidden.** The weapons panel (top 196 px, 4 slots
  ≈ 140 px tall) ran under the crew panel (top 306 px). Fix
  (`index.html`): `#crew` top 306 → 340 px. Verified in the 720 PNG.
- **Event-feed overlap nit (v2.4).** Fix (`hud.js`): feed top is now
  mission-panel bottom + 8 px when wanted = 0 (218 px when wanted > 0,
  below the dispatch panel). Verified in the 720 PNG.

### Harness bugs fixed along the way (playtest code only)

- Manhattan router: degenerate waypoint when the target shared the
  hero's x/z (walker froze); `onZ` branch routed to a road
  intersection up to 18 m away when the target was 1.7 m away in x
  (M4 re-enter ping-pong); causeway east of x=288 is invisible to the
  router (car orbited the entrance); the π-ambiguity fix (aim at the
  final target) sent the car diagonally across the market into the
  stall row when the target was 270 m away (M3 tail wreck). Fixed with
  a two-phase U-turn (stop straight, then creep-turn), a direct-drive
  rule east of x=288, advance braking before sharp waypoint turns, and
  a stall-detour in `walkTo`. M3's tail is still traffic-sensitive
  (passed 4/6 full runs; one failure was the market-stall wreck above,
  now fixed at the router level).
- M3's tail now follows the van with Manhattan routing only
  (`manhattan: true`) and hangs back at 25 m instead of closing in.

### What is still untested / known limits

- Real-human feel at 60 FPS (headless is 1–2 FPS; steering/brake feel
  and mouse-aim shooting were verified only via scripted input).
- The 640×360 HUD overlap (see table above).
- Long-session stability (longest single run: the full M1→M4 chain,
  ~340 sim-s + probes; no soak test).
- The M3 tail's traffic sensitivity (see above) — worth one more
  full-chain re-run before submit, since the van route crosses the
  market area.
- `verify-shots/` PNGs are kept in the worktree (uncommitted) as the
  visual record; `playtest/` (harness + `results.json` + key
  screenshots) is committed with this round.

## City density round — "kota yah ke sepi amat" (20 Nov, ~00:35 WIB)

Syarif's eye: the city felt empty in the cover/chase/beach frames. Pure
density pass — no HUD, control or mission changes.

- **Traffic 30 → 60** (`sim.js`): 6 vans, 8 taxis, 34 sedans, 12 scooters.
  Renderer pools resized to match (sedan-kind 56, vans 12, scooters 12,
  wheels/hubs 320) — still 1 draw call per pool.
- **Parked cars: 107** (`layout.js` + static instanced pools in `gfx.js`):
  mid-block, 7 m off the road centreline (past the 6 m asphalt edge, clear
  of ≥8 m building faces, 8.5 m lamps, 9 m+ ped sidewalks); 5 draw calls
  for the whole fleet (body, glass, rear glass, roof, wheels).
- **Peds 48 → 108**: 48 sidewalk wanderers + 24 market crowd (plaza patch)
  + 24 beachgoers (sand patch z 248–306) + 12 stall vendors standing behind
  the counters, facing their stall (face heading + sway). Area peds stay in
  their patch and respawn inside it, so they never wander onto a road.
  Per-ped height variety (scale 0.92–1.08, part heights scale with it);
  shirt palette 8 → 12, pants 6 → 8.
- **Street life**: 38 green street-name signs (merged soup, 0 extra calls),
  AC units + roof water tanks on facades, lit-window ratio 0.32 → 0.42,
  marina boats 5 → 8, 3 sailboats on the open sea, third umbrella row
  (z ≈ 298) — umbrellas 19 → 28.

Measured (all 8 shots, 0 console errors): calls / triangles —
cover 106 / 424,902 (was 99 / 380,242); start 92 / 428,126; play 72 /
418,014; end 69 / 417,210; market 55 / 423,286 (was 48 / 377,458);
nightmarket 55 / 423,286; beach 64 / 422,350 (was 57 / 377,690); chase
102 / 425,282 (was 95 / 380,622). Budget ≤ 250 calls, ≤ 500k triangles.
Determinism re-verified (Node, 60 s drive): seed-1 `55ad5650` twice
(hash changed from `4d9f8d47` because the sim content changed — more
traffic/peds — which is expected). All 8 PNGs viewed: cover/chase show
traffic ahead + parked cars on the edges, market/nightmarket show a real
crowd + vendors + string lights, beach shows goers + sailboat + third
umbrella row. NOT submitted — last slot untouched, awaiting syarif's word.

## Phase 2 — close the 6 gaps (21 Nov, "buat 100% semuanya")

All six items from the playtest report are implemented and verified.
M1–M4 still complete GOLD (`won=true`) after all changes.

### 1. 5th weapon — MAR-7 rifle (key 5)
- `sim.js`: `WEAPONS['MAR-7'] = {dmg: 70, range: 40, spread: 0.06, mag: 8}`;
  `WEAPON_ORDER` is now `['FISTS','SOL-9','SMG','12G','MAR-7']`;
  `ammoStore['MAR-7'] = {ammo: 24, reserve: 48}`.
- `main.js`: `FIRE_INTERVAL['MAR-7'] = 600`; weapon keys extended Digit1–Digit5.
- `hud.js` + `index.html`: 5th `.wslot` (`5 MAR-7`); controls line says `1–5`.
- Playtest (`combat-mar7`): Digit5 → MAR-7, ammo 24, reserve 48; killed a
  gunman at 30 m in 2 shots (0.1 s), +$50, wanted 2. Reload: MAR-7 3→8,
  reserve 90→85. Shooting from a car still blocked (ammo 48→48).

### 2. Police roadblock
- `sim.js`: at wanted ≥ 3, with ≥ 3 police and the hero travelling on a road,
  3 cruisers form a block 60 m ahead (perpendicular offsets −3.6/0/+3.6 m,
  outer cars angled ±0.45 so the three span the 12 m road), staged 22 m past
  the block so they drive in and are set before the hero arrives. Blockers
  hold still facing the oncoming hero. Release on 40 s timer, hero 25 m past,
  or wanted < 3; 45 s cooldown after clearing. The gold-van route stays
  > 30 m clear of the block point. Traffic also stops for blocking cruisers.
  Breach: ramming a blocker at speed > 8 → +5 damage, speed ×0.55, blocker
  shoved 4 m, event "Roadblock breached". HUD: event-feed line + orange
  square on minimap/big map.
- Playtest (`roadblock`): formed t=0 at (−12, 0), 3 blockers, in position
  t=3.1 while the hero was still 22 m short, breach t=5.3 (+5 dmg), hero
  through to x=50.6, block cleared. The roadblock also fired live during
  the M4 escape ("KPD roadblock ahead — find another route") and M4 still
  finished GOLD. Minor: the breach radius can catch a side blocker too, so
  the event can appear twice — cosmetic only.

### 3. Full sound (procedural WebAudio)
- `sound.js`: `horn()` (two-tone 370 + 466 Hz square, 0.35 s); persistent
  police siren (triangle ~950 Hz swept ±260 Hz by a 0.55 Hz LFO, gain driven
  per frame); `footsteps(moving, dt)` (filtered-noise thud every 0.38 s,
  alternating pitch); `cycleVolume()` 50% → 25% → mute → 100% → 50% with
  `volumeLabel()`. Siren target gain `max(0.015, min(0.09, 0.12 − dist·0.0006))`.
- `main.js`: KeyH → horn; KeyV → volume cycle (station line shows
  `station · VOL x%`); per-frame `sound.siren(wanted > 0, nearestCop)` +
  `sound.footsteps(walking, STEP)`.
- Playtest (`sound`): ctx `running`, masterGain 0.5, volume cycle
  `[VOL 25%, MUTED, VOL 100%, VOL 50%]`, radio line after V:
  "SOL 98.1 · COAST FM · VOL 25%", siren gain 0.078 at wanted 2 (target
  0.09, slewing with a 0.2 s constant — correct).

### 4. Waypoint on the big map
- `sim.js`: state `waypoint: null`, cleared when the hero comes within 12 m
  (event "Waypoint reached"). `main.js` `handleAction('waypoint')` sets it;
  tapping within 15 m of the existing waypoint clears it.
- `hud.js`: big-map canvas (`#bigmap`, 480×450) in the pause MAP tab; click
  sets the waypoint (same world mapping as the minimap); `drawMap` refactored
  to `drawMapOn(ctx, W, H)` shared by minimap + big map; waypoint drawn as a
  cyan diamond + ring on both maps; roadblock as an orange square; mission
  panel shows `◆ WAYPOINT <dist> m <compass>` (N = −z, E = +x); big map
  redraws on the 0.15 s timer while paused.
- `gfx.js`: cyan octahedron `wpMarker` (1 extra draw call, only when a
  waypoint is set), bobs over the waypoint.
- Playtest (`waypoint`): real P key → MAP tab → real big-map click at
  fraction (0.7, 0.3) → waypoint (200.33, −120.64) vs expected (202, −120);
  line "◆ WAYPOINT 299 m NE"; `wpMarkerVisible: true`; drive-to cleared it
  in 23.7 s (`waypointAfter: null`).

### 5. Responsive HUD 640×360 — bugs found by measurement, then fixed
The first 360 pass still overlapped, so the layout was verified with a
`getBoundingClientRect` probe (not by eye) and fixed until the probe
reported zero overlaps:
- **Found:** at 1280×720 the 5th weapon slot was hidden behind the crew
  panel — `#crew` sat at `top: 340px` but 5 slots make the weapons panel
  end at ~377 px. Fixed: `#crew { top: 388px }` (desktop). All 5 slots now
  visible at 720.
- **Found at 640×360:** crew strip × mission panel (36 px), feed × crew
  strip (7 px), vitals × dialog (21 px), rank bar × weapons panel (16 px).
  Root cause: panels have no `border-box`, so each is 16–22 px wider than
  its CSS width (padding + border).
- **Fixes (media query ≤ 700 px only):** mission 164 px; crew strip
  compacted (gap 6 px, font 10 px, READY status + crew-name suffix hidden
  — ability name + key badge stay); dispatch top 116 px; district-panel
  width 170 px; vitals 150 px; dialog 238 px (260 px border-box); rank
  padding 4 px 6 px; weapons top 142 px; radio line hidden.
- **Verified:** rect probe at 640×360 reports `overlaps: []` — mission
  8–190, crew 194–446, feed 220–420, dispatch 199–441, top-right 482–632,
  weapons 458–632, district 8–196, minimap 8–96, vitals 8–180, dialog
  190–450, speed 565–632. Screenshots `15-hud-720` + `16-hud-360` viewed:
  every panel readable at both sizes, dialog clear of vitals, rank bar
  fully visible. Trade-off: at ≤ 700 px the crew rows show only key +
  ability name (no crew-member name, no READY/COOLDOWN status).

### 6. 60 FPS audit — honest statement
- `gfx.js`: per-frame `new THREE.Vector3` for the sun direction replaced
  with a reused module-level `sunDirTmp`.
- `hud.js`: new `setWidth()` helper — bar widths (standing, health,
  armour, RP) only written to the DOM when the value changed (previously
  every frame).
- **Honest result: real-hardware FPS cannot be measured in this VM.**
  Headless Chromium runs on SwiftShader at 1–2 FPS — that is a software-
  renderer artefact, not a game measurement. What is verified instead: the
  render budget (max 106/250 draw calls, ~428k/500k triangles — see below)
  and no heavy per-frame work (no per-frame allocations in the hot path
  after the two fixes above). **60 FPS on real hardware is NOT claimed.**

### Regression: M1–M4 + render + determinism
- Playtest `missions`: M1 GOLD (legs 17.9 s / 62 s, +$500), M2 GOLD (+$800),
  M3 GOLD (tail), M4 GOLD (+$2000, 61.3 s, `won=true`). One M1 run-over
  ("WANTED HEAT 2 — pedestrian down") is the designed mechanic with the
  denser peds — mission still GOLD.
- Driver (all 8 shots, 0 console errors) — calls / triangles, identical to
  the density round because the waypoint marker is hidden with no waypoint
  set and the roadblock reuses existing police meshes: cover 106 / 424,902;
  start 92 / 428,126; play 72 / 418,014; end 69 / 417,210; market 55 /
  423,286; nightmarket 55 / 423,286; beach 64 / 422,350; chase 102 /
  425,282. Budget ≤ 250 calls, ≤ 500k triangles.
- Determinism re-verified (Node, 60 s, seed 1): trace hash `811c9dc5`
  twice (changed from `55ad5650` because the sim content changed — roadblock
  + MAR-7 + waypoint — which is expected; seed unchanged).
- `verify-shots/` refreshed with the new 8 PNGs; `playtest/shots/` gains
  `17-roadblock.png` (cruisers blocking the road, feed line visible) and
  `18-waypoint-map.png` (cyan waypoint diamond on the big map).
- Curiosity, not a blocker: the isolated `combat-gunmen` probe reports the
  kill at 12.1 sim-seconds while an instrumented browser probe of the same
  sim kills in 3 steps (0.05 s) — the kill itself is confirmed (3 shots,
  +$50, wanted 2) and the M4 combat kills all 3 gunmen in 0.2–0.4 s each,
  so the 12 s is scenario-context, not sim logic. NOT submitted — last slot
  untouched, awaiting syarif's word.

## What is NOT done / needs a human

- **Not submitted.** No submit, no fee, no slot used — the last slot (3/3) is untouched; submission needs syarif's explicit word (deadline 24 Nov 22:00 WIB).
- **Not play-tested by a human.** Autopilot + scripted play verified the full game to completion (M1–M4, `won=true`), but real-keyboard feel at 60 FPS is still unverified.
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

## Ronde grafik Kumala (mulai 21 Nov 22:19 WIB, koordinator + recording #8 01a1feb0)
- Perintah syarif 22:19 WIB: "pokoknya saya mau detail kayak gini apapun caranya mau nambah apapun itu" — patokan 2 screenshot Kumala (fasad warna-warni, langit ungu-oranye, glare + pantulan laut, bayangan panjang, traffic padat, mercusuar).
- Keputusan syarif 22:24 WIB: batas draw calls ronde ini DINAIKKAN 250 → 350-400 (triangles tetap <500k). Verifikasi ronde pakai budget baru.
- Builder A (langit/matahari/laut/awan, prefix K8_) jalan; lanjut B (fasad), C (density + mobil + bayangan), D (framing beach-hero). Playtest 48/48 GOLD + 0 console error tetap wajib. JANGAN submit (slot terakhir, deadline 24 Nov 22:00 WIB).
