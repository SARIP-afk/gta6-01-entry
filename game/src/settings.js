// Settings: two knobs the player can actually change — radio volume and
// graphics quality. Stored in localStorage, loaded at boot, applied by main.js
// (volume reaches the radio, quality reaches the renderer). Plain data, no DOM
// and no sim: a setting never changes a mission, a roll or a trace hash.
const KEY = 'solmarina.settings';

function readStored() {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? '{}') || {};
  } catch {
    return {};
  }
}

export function loadSettings() {
  const s = readStored();
  const volume = typeof s.volume === 'number' ? Math.max(0, Math.min(1, s.volume)) : 0.7;
  const quality = s.quality === 'low' ? 'low' : 'high';
  return { volume, quality };
}

export function saveSettings(settings) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage can be off: settings then last this visit only.
  }
}
