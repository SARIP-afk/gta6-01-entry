// Solmarina hand-in: gathers the finished game and its screenshots into the
// output folder the grader reads, then asks the kit library to describe them.
//
// Run it from the repository root (or anywhere — it finds its own folder):
//   MAKEFUN_OUTPUT_DIR=/tmp/out node main.ts
// Without MAKEFUN_OUTPUT_DIR it writes to /output, the grader's folder.
// Only the Node standard library is used, and running it twice in a row
// must produce byte-identical files both times.

import { buildDossier } from './vendor/makefun-game.ts';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The folder this file lives in is the repository root: game/ and
// screenshots/ sit next to it.
const repoRoot = dirname(fileURLToPath(import.meta.url));

// The grader hands us /output; a local run can point somewhere else.
const outRoot = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

// Limits straight from the bounty gate: the dossier text cap, at most four
// screenshots of at most 256 KiB each, and the game tree caps.
const dossierCaps = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};

// Copy one tree into another, entry by entry in sorted order so the result
// does not depend on the order the filesystem hands entries back.
function mirrorTree(fromDir: string, toDir: string): void {
  mkdirSync(toDir, { recursive: true });
  const names = readdirSync(fromDir).sort();
  for (const name of names) {
    const from = join(fromDir, name);
    const to = join(toDir, name);
    if (statSync(from).isDirectory()) {
      mirrorTree(from, to);
    } else {
      copyFileSync(from, to);
    }
  }
}

// Fresh output every run: drop the two trees we own, then mirror them in.
for (const tree of ['game', 'screenshots']) {
  const target = join(outRoot, tree);
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  mirrorTree(join(repoRoot, tree), target);
}

// The dossier is built from what we just wrote, never from the repo, so
// the file the grader checks is exactly the file that describes /output.
const dossier = buildDossier(outRoot, dossierCaps);
writeFileSync(join(outRoot, 'dossier.json'), dossier);

console.log(`wrote ${outRoot}/dossier.json (${dossier.length} bytes)`);
