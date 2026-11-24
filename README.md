[![gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/c/gta6-01)
[![Rank](https://make.fun/badge/gta6-01/SARIP-afk/gta6-01-entry/rank.svg)](https://make.fun/bounty/gta6-01)
[![Reward](https://make.fun/badge/gta6-01/SARIP-afk/gta6-01-entry/reward.svg)](https://make.fun/bounty/gta6-01)

# Solmarina — open-world action-adventure (fresh build)

*A courier. A debt. A city that never slows down.*

Solmarina is a complete open-world crime game in the spirit of GTA 6, built
from scratch for [make.fun's **Make GTA 6** bounty](https://make.fun/c/gta6-01)
($1,666, top 100 paid). Rio, a courier who became a wheelman, owes the fixer
**DANTE** four jobs — and the city, its police, and its streets all answer back.

This is a fresh build, written from zero against the visual bar of two
reference frames (a night market and a beach chase): **blocky but DETAILED,
never flat colours**. Every surface carries a second layer — window mullions
and shopfronts on the towers, striped stall awnings with goods and string
lights in the Old Pasaru night market, two-ring palms and segmented
umbrellas on Palm Beach, sculpted cars with sloped glass, a helicopter that
reads as a machine, and street props everywhere in between.

Play it: serve `game/` with any static server (`node serve.ts`, then
http://localhost:8080) and open `game/index.html` in desktop Chrome. Keyboard
and mouse, no install, no network requests — every script, texture and sound
is a file under `game/` or a `data:` URI.

## The story — four jobs

| # | Mission | Job | Reward |
|---|---|---|---|
| M1 | **FIRST DROP** | Pick up a package downtown, deliver it to the pier | $500 |
| M2 | **THE HANDOFF** | Meet SANA at the stadium — on foot — then drop at the marina | $800 |
| M3 | **TAIL THE VAN** | Stay on Dante's gold van from downtown to the marina | $1,200 |
| M4 | **LOSE THE HEAT** | Wanted 3 out of nowhere — lose the cordon, then run the pier in 120 s | $2,000 + the title **WHEELMAN** |

Every mission has two named stages, a par time, and a gold / silver / bronze
rating. Dialogue from DANTE, SANA, MIRA, LIO and KIKI carries the story.

## What is in the city

- **A living coastal city** — a deterministic procedural grid (same seed, same
  streets), 150+ towers with mullioned windows, lit shopfronts and rooftop
  signs, the Old Pasaru night market (striped stalls, goods piles, lanterns,
  string lights), Palm Beach (two-ring palms, segmented umbrellas, towels,
  beach balls), the marina and the pier, all under a 24-hour sun/sky cycle.
- **Driving and walking** — arcade car handling with boost and damage, enter
  and exit any car with E, steal parked traffic cars (the police notice).
- **Traffic and pedestrians** — 30 cars (sedans, vans, taxis with roof signs,
  scooters) and 48 walkers with individual skin, hair, shirt and pants, all
  respawning near the player so the streets stay alive where you are.
- **Wanted and police** — six tiers (CLEAR to MAXIMUM FORCE), cruisers that
  pursue, ram, lose the trail and give up, a helicopter at wanted 4+ with a
  rotor disc, nav lights and searchlight, a dispatch panel naming each unit
  and its live distance, and a crime feed.
- **Combat** — pistol (SOL-9) with mouse aim, gunmen in the M4 trap, health
  and armour, crew abilities on Z/X/C (swap plates, quick fix, eyes out).
- **HUD and minimap** — mission banner with live distance and timer, wanted
  stars, cash, health, ammo, speed, car name and damage, district standing,
  a 132 px square minimap with a gold objective diamond and a gold-ringed van;
  click it to fast-travel.
- **Pause manager** — MAP / STORY / STATS / SAVE tabs, and three save slots.
- **Radio** — three procedural WebAudio stations (SOL 98.1 Coast FM, BASS 94.6
  Harbor, LO-FI 88.9 Tide), cycled with T.
- **Side content** — 20 golden shells to find, district standing that turns
  FRIENDLY and helps you hide, a safehouse that cools the heat.

## Controls

WASD drive / walk · Shift run / boost · Space brake · E enter & exit cars ·
Mouse aim, click shoot · R reload · T radio · Z/X/C crew · M map · P pause.

## Tech

- Three.js r160, vendored under `game/vendor/` (the only library).
- Fixed 1/60 s sim, seeded RNG everywhere — the same seed and the same inputs
  always give the same trace.
- Render budget: under 100 draw calls and under 500,000 triangles (instanced
  traffic / pedestrians / windows / palms, merged city geometry).
- `main.ts` (Node 22, stdlib only) hands the game in with the kit's
  `buildDossier`; screenshots are real renders of the game's own code.
- Quality tiers: LOW 0.75× / MED 1× / HIGH 1.5× render scale.

## License

MIT — see [LICENSE](LICENSE).
