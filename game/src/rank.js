// Rank: the long ladder Rio climbs. XP comes from doing the work — missions,
// gunmen dropped, cars exported, shells found — and each rank opens something
// concrete: a weapon, a faster crew, better pay. Nothing here touches the
// renderer or the DOM; the world feeds it XP and reads the multipliers back.
// Pure numbers, so a replay with the same inputs climbs the same ladder.
export const RANKS = [
  { name: 'NEW ARRIVAL', xp: 0, unlock: 'Fists and the SOL-9 — earn your name' },
  { name: 'STREET RUNNER', xp: 300, unlock: 'SOL-7 SMG unlocked' },
  { name: 'COURIER', xp: 900, unlock: 'SOL-12 SHOTGUN unlocked' },
  { name: 'HUSTLER', xp: 1800, unlock: 'Crew cooldowns ×0.8' },
  { name: 'FIXER', xp: 3200, unlock: 'Crew cooldowns ×0.6' },
  { name: 'SHOT CALLER', xp: 5200, unlock: 'Exports pay double' },
  { name: 'HARBOUR BOSS', xp: 8000, unlock: 'Mission pay +25%' },
  { name: 'KING OF SOLMARINA', xp: 12000, unlock: 'The city is yours' },
];

export const XP_MISSION = { M1: 500, M2: 600, M3: 800, M4: 1200 };
export const XP_ENEMY_DOWN = 50;
export const XP_EXPORT = 150;
export const XP_SHELL = 10;

export function createRank() {
  return { state: { xp: 0, level: 0 } };
}

export function rankName(rank) {
  return RANKS[rank.state.level].name;
}

export function rankProgress(rank) {
  const st = rank.state;
  const cur = RANKS[st.level];
  const next = RANKS[st.level + 1] || null;
  return {
    level: st.level,
    name: cur.name,
    xp: st.xp,
    nextXp: next ? next.xp : null,
    nextName: next ? next.name : null,
    nextUnlock: next ? next.unlock : null,
  };
}

/** Crew cooldown multiplier at this rank: the crew trusts Rio more as he climbs. */
export function cooldownMult(rank) {
  const l = rank.state.level;
  if (l >= 4) return 0.6;
  if (l >= 3) return 0.8;
  return 1;
}

/** Mission pay multiplier at this rank. */
export function missionMult(rank) {
  return rank.state.level >= 6 ? 1.25 : 1;
}

/** Export pay multiplier at this rank. */
export function exportMult(rank) {
  return rank.state.level >= 5 ? 2 : 1;
}

/**
 * Add XP. Returns the ranks just climbed (usually none, at most a few) so the
 * world can open their unlocks and announce them — the rank itself never
 * reaches into weapons or the HUD.
 */
export function addXp(rank, amount) {
  const climbed = [];
  rank.state.xp += amount;
  while (rank.state.level + 1 < RANKS.length && rank.state.xp >= RANKS[rank.state.level + 1].xp) {
    rank.state.level += 1;
    climbed.push({ level: rank.state.level, name: RANKS[rank.state.level].name, unlock: RANKS[rank.state.level].unlock });
  }
  return climbed;
}

export function resetRank(rank) {
  rank.state.xp = 0;
  rank.state.level = 0;
}
