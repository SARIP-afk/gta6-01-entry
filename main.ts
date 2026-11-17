// Solmarina, a gta6-01 entry (Node 22, standard library only): the game is this
// directory's game/ folder, plain static files a desktop browser loads offline
// (game/index.html and its ES modules, three.js vendored under game/vendor/, no library
// loaded over the network and no network request at all), and the program hands it in.
// It copies game/ and screenshots/ from beside this file to /output and writes
// /output/dossier.json, the summary the judge reads, with the vendored make.fun library.
// Rio, a courier-turned-wheelman, drives and walks a sun-soaked coastal city: seeded
// procedural streets and districts, an arcade car to steal and drive, enter and exit
// on foot, a marina channel with bridges, a pier and a lighthouse. Build the open world
// further in game/src/ (city, world, render, input, shots); put 3 or 4 PNG or JPEG
// screenshots in screenshots/ (the first by name is the cover) and run it.
//
// Phase 1 (v1-city-drives): the 3D city + driving + on-foot are in and verified —
// Solmarina (12x12 blocks, downtown/marina/suburb, tower, stadium, channel + bridge,
// pier + lighthouse), arcade driving with speed-capped steering, E to enter/exit the
// car, camera-relative walking, three.js r160 vendored, deterministic seeded build.
// Phase 2 (v2-cover-reads): the HUD + live minimap + cover chase are in — wanted
// stars, cash, objective banner, speed, health, in-game clock, start screen with a
// best-run record and a staged ?shot=cover (police cruisers + traffic around the
// player's car, wanted 3, all real game state). Phase 3 (v3-police-wanted): the city
// lives — traffic and pedestrians on the road grid, a live wanted level, police
// cruisers that chase, ram, bust, lose the player, search and give up. Phase 3.5
// (v3.5-visual-pass): shadows + ACES tone mapping, four-face window grids, roof
// variants, wider district palettes, procedural textures, detailed cars and Rio,
// and a re-framed cover shot. Phase 3.6 (v3.6-city-look): bolder palettes (~50%
// strong colour), more roof variants + rooftop landmarks, dense ground-floor
// facades, street props — chasing the reference city's colour and detail density.
// Batch 1 (v3.7-sharp): quick visual wins, no gameplay change — anisotropy 8 on
// every procedural texture, hemisphere 1.15 + a high east fill light 0.7 (two
// measured iterations; the worst-case shadowed street frame improves 46.7% to
// 39.2% near-black but does not reach 15% — that needs structural Batch 2 work),
// asphalt texture 256 to 512 px (same seeded pattern, layout byte-identical),
// antialiasing on + 2x supersampled capture for cover/play (PR2 downscaled),
// JPEG quality 90. Node S0-S7 byte-identical to v3.6; dossier byte-identical
// across two runs.
// Later phases add missions, combat/activities/save/sound, then polish. This file itself only copies the game and writes the
// dossier; the game lives in game/src/.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all, or a path under game/ over 1000 bytes: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
