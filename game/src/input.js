// Keyboard and mouse input. Held keys are read every frame; one-shot presses
// (start, pause, enter/exit, reload, radio, map) are queued as bit flags and taken
// once by the loop, so a press between two frames is never lost or counted twice.
// The mouse gives an aim point; the loop turns it into a world angle.
export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_ENTER = 4;
export const ACTION_RELOAD = 8;
export const ACTION_RADIO = 16;
export const ACTION_MAP = 32;
export const ACTION_WEAPON_1 = 64;
export const ACTION_WEAPON_2 = 128;
export const ACTION_WEAPON_3 = 256;
export const ACTION_WEAPON_4 = 512;
export const ACTION_CREW_1 = 1024;
export const ACTION_CREW_2 = 2048;
export const ACTION_CREW_3 = 4096;
export const ACTION_HOLSTER = 8192;

const CONFIRM = new Set(['Space', 'Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const ENTER = new Set(['KeyE']);
const RELOAD = new Set(['KeyR']);
const RADIO = new Set(['KeyT']);
const MAP = new Set(['KeyM']);
const WEAPON_1 = new Set(['Digit1']);
const WEAPON_2 = new Set(['Digit2']);
const WEAPON_3 = new Set(['Digit3']);
const WEAPON_4 = new Set(['Digit4']);
const CREW_1 = new Set(['KeyZ']);
const CREW_2 = new Set(['KeyX']);
const CREW_3 = new Set(['KeyC']);
const HOLSTER = new Set(['KeyQ']);

export function createInput(target) {
  const held = new Set();
  let actions = 0;
  const mouse = { x: 0, y: 0, down: false };

  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    held.add(event.code);
    if (CONFIRM.has(event.code)) actions |= ACTION_CONFIRM;
    else if (PAUSE.has(event.code)) actions |= ACTION_PAUSE;
    else if (ENTER.has(event.code)) actions |= ACTION_ENTER;
    else if (RELOAD.has(event.code)) actions |= ACTION_RELOAD;
    else if (RADIO.has(event.code)) actions |= ACTION_RADIO;
    else if (MAP.has(event.code)) actions |= ACTION_MAP;
    else if (WEAPON_1.has(event.code)) actions |= ACTION_WEAPON_1;
    else if (WEAPON_2.has(event.code)) actions |= ACTION_WEAPON_2;
    else if (WEAPON_3.has(event.code)) actions |= ACTION_WEAPON_3;
    else if (WEAPON_4.has(event.code)) actions |= ACTION_WEAPON_4;
    else if (CREW_1.has(event.code)) actions |= ACTION_CREW_1;
    else if (CREW_2.has(event.code)) actions |= ACTION_CREW_2;
    else if (CREW_3.has(event.code)) actions |= ACTION_CREW_3;
    else if (HOLSTER.has(event.code)) actions |= ACTION_HOLSTER;
    else return;
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    held.delete(event.code);
  });
  window.addEventListener('blur', () => {
    held.clear();
    mouse.down = false;
  });
  window.addEventListener('mousemove', (event) => {
    mouse.x = event.clientX;
    mouse.y = event.clientY;
  });
  target.addEventListener('mousedown', (event) => {
    if (event.button === 0) {
      mouse.down = true;
      mouse.x = event.clientX;
      mouse.y = event.clientY;
    }
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) mouse.down = false;
  });
  target.addEventListener('contextmenu', (event) => event.preventDefault());

  function axis() {
    // Camera-space drive/walk axes: +forward is W, +right is D.
    const f = (held.has('KeyW') || held.has('ArrowUp') ? 1 : 0) - (held.has('KeyS') || held.has('ArrowDown') ? 1 : 0);
    const r = (held.has('KeyD') || held.has('ArrowRight') ? 1 : 0) - (held.has('KeyA') || held.has('ArrowLeft') ? 1 : 0);
    return { forward: f, right: r };
  }

  return {
    held,
    mouse,
    axis,
    run: () => held.has('ShiftLeft') || held.has('ShiftRight'),
    boost: () => held.has('ShiftLeft') || held.has('ShiftRight'),
    brake: () => held.has('Space'),
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}
