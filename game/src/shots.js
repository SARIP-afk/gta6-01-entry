// The screenshot scenes behind ?shot=start|play|end|cover. Each one plays the real rules
// forward from a fresh world for a fixed number of steps, steered by the autopilot,
// so the frame is what a short game really looks like and the same seed always gives
// the same frame. Start is the title over the avenue; play is the car mid-drive;
// end is Rio on foot by the marina, the car parked behind him.
// Cover (Phase 2) is the chase: the autopilot drives the avenue east for six seconds,
// then two police cruisers (visual-only, no AI until Phase 3) are staged flanking
// behind the car and three traffic cars ahead of it, wanted is set to 3 stars, and
// the objective banner reads the escape. Everything in the frame is real game state
// — the same world, the same renderer, the same HUD — with the chase staged around
// where the autopilot actually drove, not a mockup pasted on top.
import { COVER, STEP } from './config.js';
import { SCREEN_PLAY, SCREEN_TITLE } from './render.js';

// The title camera is fixed to the car and nothing moves before play starts, so two
// idle seconds stage exactly what five did; the shorter wait only speeds the shots up.
const START_SECONDS = 2;
const PLAY_SECONDS = 24;
const END_WALK_SECONDS = 6;

/** Drive the car with the autopilot for `seconds` of game time. */
function driveFor(world, seconds) {
  for (let index = 0; index < seconds / STEP; index += 1) {
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
}

/**
 * Set `world` to the named scene (start, play, end or cover; any other name is
 * start) and return the screen to draw over it.
 */
export function stageShot(name, world) {
  world.reset();
  if (name === 'cover') {
    // Six seconds of real driving east on the avenue: the car is mid-avenue at
    // ~30 m/s, heading east toward the marina, the bridge and the sea.
    driveFor(world, COVER.driveSeconds);
    const car = world.state.car;
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    // Lateral offsets are perpendicular to the heading (right = (fz, -fx)).
    const rx = fz;
    const rz = -fx;
    const place = (along, lateral, heading) => ({
      x: car.x + fx * along + rx * lateral,
      z: car.z + fz * along + rz * lateral,
      heading,
    });
    // Two police cruisers flanking just behind the car — close enough to stay in
    // front of the chase camera (11 m back), far enough not to hide Rio's car.
    // Three traffic cars ahead: two in the flow, one oncoming in the other lane.
    world.state.extras = [
      { kind: 'police', ...place(-4, -2.5, car.heading) },
      { kind: 'police', ...place(-5, 2.5, car.heading) },
      { kind: 'traffic', ...place(18, -2.5, car.heading) },
      { kind: 'traffic', ...place(32, 2.5, car.heading) },
      { kind: 'traffic', ...place(24, 5, car.heading + Math.PI) },
    ];
    world.state.wanted = COVER.wanted;
    world.state.cash = COVER.cash;
    world.state.objective = { ...COVER.objective };
    return { screen: SCREEN_PLAY };
  }
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
  driveFor(world, PLAY_SECONDS);
  return { screen: SCREEN_PLAY };
}
