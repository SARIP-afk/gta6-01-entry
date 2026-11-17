// The screenshot scenes behind ?shot=start|play|end. Each one plays the real rules
// forward from a fresh world for a fixed number of steps, steered by the autopilot,
// so the frame is what a short game really looks like and the same seed always gives
// the same frame. Start is the title over the avenue; play is the car mid-drive;
// end is Rio on foot by the marina, the car parked behind him.
import { STEP } from './config.js';
import { SCREEN_PLAY, SCREEN_TITLE } from './render.js';

// The title camera is fixed to the car and nothing moves before play starts, so two
// idle seconds stage exactly what five did; the shorter wait only speeds the shots up.
const START_SECONDS = 2;
const PLAY_SECONDS = 24;
const END_WALK_SECONDS = 6;

/**
 * Set `world` to the named scene (start, play or end; any other name is start) and
 * return the screen to draw over it.
 */
export function stageShot(name, world) {
  world.reset();
  if (name !== 'play' && name !== 'end') {
    // Title: idle briefly so the first painted frame is a settled one.
    for (let index = 0; index < START_SECONDS / STEP; index += 1) {
      world.step(STEP, { forward: false, back: false, left: false, right: false, handbrake: false, run: false, enter: false }, 0);
    }
    return { screen: SCREEN_TITLE };
  }
  if (name === 'end') {
    // On foot by the marina: park the car on the promenade, Rio steps out and walks
    // toward the pier, the lighthouse and the sea ahead of him.
    world.state.car.x = 300;
    world.state.car.z = -6;
    world.state.car.heading = Math.PI / 2;
    world.state.car.speed = 0;
    world.state.mode = 'foot';
    world.state.player.x = 296;
    world.state.player.z = -2;
    world.state.player.heading = Math.PI / 2;
    for (let index = 0; index < END_WALK_SECONDS / STEP; index += 1) {
      world.step(STEP, { forward: true, back: false, left: false, right: false, handbrake: false, run: false, enter: false }, world.state.player.heading);
    }
    return { screen: SCREEN_PLAY };
  }
  // Play: the autopilot drives the route for twenty-four seconds.
  for (let index = 0; index < PLAY_SECONDS / STEP; index += 1) {
    const drive = world.autopilot();
    world.step(STEP, {
      forward: drive.throttle > 0,
      back: drive.brake,
      left: false,
      right: false,
      steer: drive.steer,
      handbrake: false,
      run: false,
      enter: false,
    }, 0);
  }
  return { screen: SCREEN_PLAY };
}
