// Settings: two knobs the player can actually change — radio volume and
// graphics quality. Stored in localStorage, loaded at boot, applied by main.js
// (volume reaches the radio, quality reaches the renderer). Plain data, no DOM
// and no sim: a setting never changes a mission, a roll or a trace hash.
//
// Quality tiers (v4.7): 'auto' (default — detect once at boot, see
// resolveQuality), 'low' | 'med' | 'high' (manual, stored verbatim).
// Old saves stored 'low'/'high' only; both still mean the same tier.
const KEY = 'solmarina.settings';

export const QUALITIES = ['auto', 'low', 'med', 'high'];

function readStored() {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? '{}') || {};
  } catch {
    return {};
  }
}

/** Auto-detect: desktop-class hardware gets HIGH, thin hardware MED/LOW.
 * Pure capability sniffing (cores / memory / DPR) — no FPS sampling here,
 * so the boot tier is stable and never flips on its own. */
export function detectQuality() {
  const cores = navigator.hardwareConcurrency || 1;
  const mem = navigator.deviceMemory || 8;
  const dpr = window.devicePixelRatio || 1;
  if (cores >= 4 && mem >= 4) return 'high';
  if (cores >= 2 || dpr >= 1.5) return 'med';
  return 'low';
}

/** Stored value -> effective tier. 'auto' resolves through detectQuality. */
export function resolveQuality(stored) {
  if (stored === 'low' || stored === 'med' || stored === 'high') return stored;
  return detectQuality();
}

export function loadSettings() {
  const s = readStored();
  const volume = typeof s.volume === 'number' ? Math.max(0, Math.min(1, s.volume)) : 0.7;
  const quality = QUALITIES.includes(s.quality) ? s.quality : 'auto';
  return { volume, quality };
}

export function saveSettings(settings) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage can be off: settings then last this visit only.
  }
}
