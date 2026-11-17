// Keyboard and pointer input. Held keys give the driving/walking direction; one-shot
// presses (start, enter/exit car, handbrake is held, pause) are queued as bit flags and
// taken once by the loop, so a press between two frames is never lost or counted twice.
// A key released while the tab is hidden never sends keyup: blur lets go of everything,
// including any press queued while hidden, so a stale Enter can never fire later.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_ENTER = 4;

const FORWARD = new Set(['ArrowUp', 'KeyW']);
const BACK = new Set(['ArrowDown', 'KeyS']);
const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const CONFIRM = new Set(['Space', 'Enter']);
const ENTER = new Set(['KeyE']);
const PAUSE = new Set(['KeyP', 'Escape']);
const RUN = new Set(['ShiftLeft', 'ShiftRight']);

export function createInput(target) {
  let forward = false;
  let back = false;
  let left = false;
  let right = false;
  let handbrake = false;
  let run = false;
  let actions = 0;

  window.addEventListener('keydown', (event) => {
    if (FORWARD.has(event.code)) forward = true;
    else if (BACK.has(event.code)) back = true;
    else if (LEFT.has(event.code)) left = true;
    else if (RIGHT.has(event.code)) right = true;
    else if (CONFIRM.has(event.code)) {
      if (event.code === 'Space') handbrake = true;
      if (!event.repeat) actions |= ACTION_CONFIRM;
    } else if (ENTER.has(event.code)) {
      if (!event.repeat) actions |= ACTION_ENTER;
    } else if (PAUSE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PAUSE;
    } else if (RUN.has(event.code)) run = true;
    else return;
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    if (FORWARD.has(event.code)) forward = false;
    else if (BACK.has(event.code)) back = false;
    else if (LEFT.has(event.code)) left = false;
    else if (RIGHT.has(event.code)) right = false;
    else if (event.code === 'Space') handbrake = false;
    else if (RUN.has(event.code)) run = false;
  });
  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => {
    forward = false;
    back = false;
    left = false;
    right = false;
    handbrake = false;
    run = false;
    actions = 0;
  });
  target.addEventListener('pointerdown', () => {
    actions |= ACTION_CONFIRM;
  });

  return {
    /** The held driving/walking input, as the world step() reads it. */
    read() {
      return { forward, back, left, right, handbrake, run, enter: false };
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}
