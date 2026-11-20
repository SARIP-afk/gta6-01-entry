// The armoury: four slots on keys 1-4. Fists are always there and cost nothing;
// the pistol is Rio's from the start; the SMG and the shotgun are earned with
// rank, so a new player grows into the louder tools instead of starting with
// them. A loadout is plain numbers — ammo per slot, which slot is live, which
// slots rank has opened — so the world can save it and the HUD can read it.
// Pure data + tiny helpers: no THREE, no DOM, no Math.random.
export const WEAPONS = [
  {
    id: 'fists', name: 'FISTS', key: '1',
    mag: Infinity, reserve: Infinity,
    damage: 0, range: 0, fireInterval: 0.4, reloadTime: 0, spread: 0, pellets: 0,
    unlockRank: 0,
    blurb: 'NO AMMO · GET CLOSE',
  },
  {
    id: 'pistol', name: 'SOL-9 PISTOL', key: '2',
    mag: 12, reserve: 48,
    damage: 34, range: 70, fireInterval: 0.22, reloadTime: 1.1, spread: 0.012, pellets: 1,
    unlockRank: 0,
    blurb: '34 DMG · 70 M RANGE',
  },
  {
    id: 'smg', name: 'SOL-7 SMG', key: '3',
    mag: 30, reserve: 90,
    damage: 18, range: 55, fireInterval: 0.09, reloadTime: 1.4, spread: 0.03, pellets: 1,
    unlockRank: 1,
    blurb: '18 DMG · 55 M RANGE · RAPID',
  },
  {
    id: 'shotgun', name: 'SOL-12 SHOTGUN', key: '4',
    mag: 6, reserve: 24,
    damage: 16, range: 35, fireInterval: 0.9, reloadTime: 1.6, spread: 0.09, pellets: 5,
    unlockRank: 2,
    blurb: '16 DMG × 5 PELLETS · 35 M RANGE',
  },
];

export function createLoadout() {
  return {
    active: 1, // the pistol: what Rio holds when a game starts
    ammo: WEAPONS.map((w) => w.mag),
    reserve: WEAPONS.map((w) => w.reserve),
    unlocked: WEAPONS.map((w) => w.unlockRank === 0),
  };
}

/** The weapon in Rio's hands right now. */
export function activeWeapon(loadout) {
  return WEAPONS[loadout.active];
}

/** Open every slot whose rank requirement the player now meets. Returns the names just opened. */
export function unlockForRank(loadout, rankLevel) {
  const opened = [];
  for (let i = 0; i < WEAPONS.length; i += 1) {
    if (!loadout.unlocked[i] && WEAPONS[i].unlockRank <= rankLevel) {
      loadout.unlocked[i] = true;
      opened.push(WEAPONS[i].name);
    }
  }
  return opened;
}

/**
 * Try to switch to slot `index`. Returns 'ok', 'locked' (rank too low) or
 * 'same' (already holding it). Switching never spends ammo or time.
 */
export function selectWeapon(loadout, index, rankLevel) {
  if (index < 0 || index >= WEAPONS.length) return 'same';
  if (index === loadout.active) return 'same';
  if (!loadout.unlocked[index] && WEAPONS[index].unlockRank > rankLevel) return 'locked';
  loadout.active = index;
  return 'ok';
}

/** Plain snapshot for the save slot, and the way back. */
export function loadoutSnapshot(loadout) {
  return {
    active: loadout.active,
    ammo: loadout.ammo.slice(),
    reserve: loadout.reserve.slice(),
    unlocked: loadout.unlocked.slice(),
  };
}

export function loadoutApply(loadout, snap) {
  if (!snap) return;
  if (Number.isInteger(snap.active) && snap.active >= 0 && snap.active < WEAPONS.length) loadout.active = snap.active;
  if (Array.isArray(snap.ammo)) {
    for (let i = 0; i < WEAPONS.length; i += 1) {
      if (Number.isFinite(snap.ammo[i])) loadout.ammo[i] = snap.ammo[i];
    }
  }
  if (Array.isArray(snap.reserve)) {
    for (let i = 0; i < WEAPONS.length; i += 1) {
      if (Number.isFinite(snap.reserve[i])) loadout.reserve[i] = snap.reserve[i];
    }
  }
  if (Array.isArray(snap.unlocked)) {
    for (let i = 0; i < WEAPONS.length; i += 1) {
      if (typeof snap.unlocked[i] === 'boolean') loadout.unlocked[i] = snap.unlocked[i];
    }
  }
}
