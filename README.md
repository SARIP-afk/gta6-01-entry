[![gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/c/gta6-01)
[![rank](https://make.fun/badge/gta6-01/SARIP-afk/gta6-01-entry/rank.svg)](https://make.fun/c/gta6-01)
[![reward](https://make.fun/badge/gta6-01/SARIP-afk/gta6-01-entry/reward.svg)](https://make.fun/c/gta6-01)

# Solmarina — open-world action-adventure

*A courier. A debt. A city that never slows down.*

Solmarina is a complete open-world crime game in the spirit of GTA 6, built from
scratch for [make.fun's **Make GTA 6** bounty](https://make.fun/c/gta6-01)
($1,666, top 100 paid). Rio, a courier who became a wheelman, owes the fixer
**DANTE** four jobs — and the city, its police, and its streets all answer back.

Play it: serve `game/` with any static server (`node serve.ts`, then
http://localhost:8080) and open `game/index.html` in desktop Chrome. Keyboard
and mouse, no install, no network requests — every script, texture and sound is
a file under `game/` or a `data:` URI.

## The story — four jobs

| # | Mission | Job | Reward |
|---|---|---|---|
| M1 | **FIRST DROP** | Pick up a package downtown, deliver it to the pier | $500 |
| M2 | **THE HANDOFF** | Meet SANA at the stadium — on foot — then drop at the marina | $800 |
| M3 | **TAIL THE VAN** | Stay on Dante's gold van from downtown to the marina | $1,200 |
| M4 | **LOSE THE HEAT** | Wanted 3 out of nowhere — lose the cordon, then run the pier in 120 s | $2,000 + the title **WHEELMAN** |

Every mission has two named stages, a par time, and a gold / silver / bronze
rating. Dialogue from DANTE and SANA (with procedural portraits) carries the
story; the chain saves between visits.

## What is in the city

- **A living coastal city** — a deterministic procedural grid (same seed, same
  streets), 180+ towers with lit windows, rooftop and street signs, palms,
  lamps, the marina causeway and the pier, all under a golden-hour sky.
- **Driving and walking** — arcade car handling with boost and damage, enter and
  exit any car with E, steal parked traffic cars (the police notice).
- **Traffic and pedestrians** — 30 cars and 50 walkers on the road grid,
  respawning near the player so the streets stay alive where you are.
- **Wanted and police** — six named tiers (CLEAR to MAXIMUM FORCE), cruisers
  that pursue, ram, lose the trail, search and give up; a dispatch panel names
  each unit, its role and its live distance; a crime feed says *why* wanted
  rose; the safehouse is sacred ground.
- **Combat** — one pistol (SOL-9), mouse aim, damage numbers, enemy health
  bars, gunmen to drop in the M4 trap.
- **HUD and minimap** — mission banner with live distance and timers, wanted
  stars and tier, cash, health, ammo, speed, car name and damage, district
  standing, a 120 px minimap with a gold objective diamond and a gold-ringed van.
- **Pause manager** — MAP / STORY / STATS / SAVE tabs: a big map, the mission
  list with ratings, completion %, career stats, and three save slots.
- **Save** — three slots (cash, mission chain, shells, exports, standing,
  position) on the title screen.
- **Radio** — three procedural WebAudio stations (SOL 98.1 Coast FM, BASS 94.6
  Harbor, LO-FI 88.9 Tide), cycled with T.
- **Side content** — 20 golden shells to find, 5 export models to deliver to
  the marina, district standing that turns FRIENDLY and helps you hide.

## Controls

WASD drive / walk · Shift run / boost · Space brake · E enter & exit cars ·
Mouse aim, click shoot · R reload · T radio · M map · P pause.

## Tech

- Three.js r160, vendored under `game/vendor/` (the only library).
- Fixed 1/60 s sim, seeded RNG everywhere — the same seed and the same inputs
  always give the same trace (verified: two seed-1 runs hash identically, seed-2
  differs).
- Render budget: under 100 draw calls and well under 500,000 triangles
  (instanced traffic / pedestrians / police, merged city geometry).
- `main.ts` (Node 22, stdlib only) hands the game in with the kit's
  `buildDossier`; screenshots are real renders of the game's own code.

## License

MIT — see [LICENSE](LICENSE).
