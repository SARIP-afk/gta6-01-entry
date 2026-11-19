// Save: three slots in localStorage. A slot keeps cash, the mission chain, shells,
// district standing, the player's place in the city, health and the clock — enough
// that loading a slot drops Rio back into Solmarina where he left it, wanted clean.
// Nothing here runs in the sim; the world hands it a plain snapshot and takes one back.
import { SAVE_KEY } from './config.js';

function readAll() {
  try {
    return JSON.parse(window.localStorage.getItem(SAVE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function writeAll(slots) {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(slots));
  } catch {
    // Storage can be off: saves then last the visit only.
  }
}

export function listSlots() {
  const all = readAll();
  return [0, 1, 2].map((i) => all[`slot${i}`] ?? null);
}

export function saveSlot(index, snapshot) {
  const all = readAll();
  all[`slot${index}`] = { ...snapshot, savedAt: new Date().toISOString() };
  writeAll(all);
  return all[`slot${index}`];
}

export function loadSlot(index) {
  return readAll()[`slot${index}`] ?? null;
}

export function clearSlot(index) {
  const all = readAll();
  delete all[`slot${index}`];
  writeAll(all);
}
