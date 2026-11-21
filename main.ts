// Solmarina hand-in — the program that packages the entry.
//
// It mirrors game/ and screenshots/ out of this repository into the
// hand-in directory, then asks the kit library to write the dossier
// from what landed there. Node 22, standard library only: nothing is
// installed, built or fetched, so the grader can run it twice in a
// bare container and get the same bytes both times.
import { buildDossier } from './vendor/makefun-game.ts';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The repository root is wherever this file sits; the game and the
// screenshots are read from there, never from the working directory.
const repoRoot = dirname(fileURLToPath(import.meta.url));

// Outside the grader MAKEFUN_OUTPUT_DIR stands in for /output.
const handInDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

// The caps the bounty gate grades against: the dossier text budget,
// the screenshot count and size, and the game tree limits.
const dossierCaps = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};

// Start from a clean hand-in directory so a stale file from an
// earlier run can never leak into the dossier.
if (existsSync(handInDir)) rmSync(handInDir, { recursive: true, force: true });
mkdirSync(handInDir, { recursive: true });

for (const tree of ['game', 'screenshots']) {
  const from = join(repoRoot, tree);
  if (!existsSync(from)) throw new Error(`hand-in: ${tree}/ is missing from the repository`);
  cpSync(from, join(handInDir, tree), { recursive: true });
}

// The dossier is built from the copied trees, not from the repo, so
// what the scorer re-derives later is exactly what we wrote here.
const dossier = buildDossier(handInDir, dossierCaps);
writeFileSync(join(handInDir, 'dossier.json'), dossier);
console.log(`hand-in written to ${handInDir} (${dossier.length} byte dossier)`);
