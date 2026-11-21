// Solmarina — staged screenshot scenes. Each one plays the real rules
// forward from a fresh world, steered by an autopilot that drives the
// road grid Manhattan-style toward the objective, so the frame is what
// short play really looks like and the same seed always gives the same
// frame.
import { STEP } from './sim.js';
import { GRID_MIN, GRID_MAX, ROAD_STEP, MARKET, PIER } from './layout.js';
import { wrapAngle } from './util.js';

const ROAD_LINES = [];
for (let v = GRID_MIN; v <= GRID_MAX; v += ROAD_STEP) ROAD_LINES.push(v);
function closestRoadLine(v) {
  let best = ROAD_LINES[0], bd = Infinity;
  for (const r of ROAD_LINES) { const d = Math.abs(v - r); if (d < bd) { bd = d; best = r; } }
  return best;
}
function pickWaypoint(x, z, tx, tz) {
  const rx = closestRoadLine(x), rz = closestRoadLine(z);
  const onX = Math.abs(x - rx) < 4, onZ = Math.abs(z - rz) < 4;
  const leg = (d) => Math.min(ROAD_STEP, Math.abs(d));
  if (onX && onZ) {
    if (Math.abs(tx - x) > 6) return { x: x + Math.sign(tx - x) * leg(tx - x), z };
    return { x, z: z + Math.sign(tz - z) * leg(tz - z) };
  }
  if (onX) return { x: rx, z: z + Math.sign(tz - z) * leg(tz - z) };
  if (onZ) {
    if (Math.abs(tx - x) > 6) return { x: x + Math.sign(tx - x) * leg(tx - x), z: rz };
    return { x: rx, z: rz }; // aligned in x: drive to the intersection, then turn
  }
  // off-grid: drive axis-aligned to the nearer road line, never diagonally
  return Math.abs(x - rx) < Math.abs(z - rz) ? { x: rx, z } : { x, z: rz };
}
function driveToward(world, tx, tz) {
  const s = world.state;
  const car = s.heroCar;
  let ex = tx, ez = tz;
  if (tx > GRID_MAX && (car.x < GRID_MAX - 2 || Math.abs(car.z - 24) > 6)) { ex = GRID_MAX; ez = 24; }
  const dist = Math.hypot(tx - car.x, tz - car.z);
  // navigate to the road-aligned target; inside 40 m drive straight at the
  // real target (it may sit mid-block, e.g. a building front). The pier is
  // reached via the causeway at z = 24, not the nearest road line.
  let navTx = closestRoadLine(ex), navTz = closestRoadLine(ez);
  if (tx > GRID_MAX) { navTx = GRID_MAX; navTz = 24; }
  const wp = dist < 40 ? { x: ex, z: ez } : pickWaypoint(car.x, car.z, navTx, navTz);
  const want = Math.atan2(-(wp.z - car.z), wp.x - car.x);
  const diff = wrapAngle(want - car.heading);
  const wpDist = Math.hypot(wp.x - car.x, wp.z - car.z);
  return {
    moveX: 0, moveZ: 0, steer: Math.max(-1, Math.min(1, diff * 1.6)),
    throttle: Math.abs(diff) > 1.4 ? 0.25 : dist < 12 ? 0.4 : 0.6,
    brake: (dist < 8 && Math.abs(car.speed) > 6) || (wpDist < 18 && Math.abs(diff) > 0.4 && Math.abs(car.speed) > 8),
    boost: false, enter: false, reload: false, shootAngle: null,
  };
}
function walkToward(world, tx, tz) {
  const s = world.state;
  const p = s.player;
  const d = Math.hypot(tx - p.x, tz - p.z);
  if (d < 1.5) return { moveX: 0, moveZ: 0, steer: 0, throttle: 0, brake: false, boost: false, enter: false, reload: false, shootAngle: null };
  return { moveX: (tx - p.x) / d, moveZ: (tz - p.z) / d, steer: 0, throttle: 0, brake: false, boost: false, enter: false, reload: false, shootAngle: null };
}
function autoDrive(world) {
  const s = world.state;
  if (s.player.mode === 'car') return driveToward(world, s.objective.x, s.objective.z);
  return walkToward(world, s.heroCar.x, s.heroCar.z);
}
function advance(world, seconds, inputFn) {
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i++) world.step(STEP, inputFn ? inputFn(world) : autoDrive(world));
}

/** Stage a scene; returns the screen the HUD should draw over it. */
export function stageShot(name, world, renderer) {
  world.reset(1);
  const s = world.state;
  s.screen = 'play';
  const pointCam = (x, y, z, lx, ly, lz) => renderer.setCamOverride(
    { x, y, z }, { x: lx, y: ly, z: lz },
  );
  if (name === 'cover') {
    // Concept A — Sunset Chase. The hero car sits BIG in the foreground,
    // shot from a low three-quarter angle behind and right of him; the
    // heli hangs ahead-left over the sea, scaled up, with a bright
    // searchlight cone; the low sun is in frame; two cruisers stage the
    // cordon ahead; marina boats, the lighthouse and the sea fill the
    // left, pastel facades line the right. Clock 18.3 is peak sunset.
    // The HUD is hidden by cover-clean mode.
    world.pinClock(18.3);
    s.missions.active = 3; s.missions.stage = 0; s.missions.started = true;
    s.missions.dialog = { speaker: 'DANTE', line: "It's a trap. Lose them — then bring it home." };
    s.missions.dialogTimer = 9;
    s.objective = { x: -72, z: 48, label: 'Lose the cordon — get CLEAR' };
    s.player.mode = 'car';
    const heroSpot = { x: 0, z: 240, heading: Math.PI, speed: 16 };
    Object.assign(s.heroCar, heroSpot);
    s.player.x = 0; s.player.z = 240; s.player.heading = Math.PI;
    s.wanted = 3;
    const heliSpot = { x: -24, z: 247, alt: 11, angle: -Math.PI / 2, scale: 1.5 };
    Object.assign(s.heli, { active: true, staged: true }, heliSpot);
    s.smokeFx = true; // pooled drift smoke behind the hero car
    for (let i = 0; i < 2; i++) {
      s.police.push({ x: 16 + i * 12, z: (i % 2 ? 236.5 : 243.5), heading: Math.PI, speed: 14, search: 0, siren: i });
    }
    advance(world, 2, () => driveToward(world, -120, 240));
    // Re-pin everything the sim moved: the hero back to the staged spot,
    // the heli frozen big ahead-left, and exactly 2 cruisers in frame.
    // The road is straight and the chase camera looks west, so anything
    // east of the hero — genuinely behind him — sits behind the lens and
    // can never be in frame. The 2 cruisers are therefore staged AHEAD
    // as the cordon the mission is about ("Lose the cordon", "It's a
    // trap"): a roadblock pair facing the hero, headlights on, mid-frame
    // up the road. The sim tops police up to wanted+1 = 4 during the
    // drive and may form its own roadblock — both are cleared, and the
    // sim is frozen after staging so nothing moves again.
    Object.assign(s.heroCar, heroSpot);
    s.player.x = 0; s.player.z = 240;
    // The heli is turned side-on to the cover camera (nose south): the
    // boom, fin and skids read, instead of a foreshortened nose-on box.
    Object.assign(s.heli, { active: true, staged: true }, heliSpot);
    s.smokeFx = true;
    s.roadblock = null; s.roadblockCooldown = 45;
    s.police.length = 0;
    s.police.push(
      { x: -30, z: 237, heading: 0, speed: 0, search: 0, siren: 0 },
      { x: -42, z: 243.5, heading: 0, speed: 0, search: 0, siren: 1 },
    );
    // Life on the road ahead: a taxi and a sedan facing the hero, their
    // headlights toward the camera, so the asphalt ahead is not empty.
    s.traffic.push(
      { x: -68, z: 237.5, heading: 0, speed: 0, kind: 'taxi', color: '#f1c40f' },
      { x: -88, z: 243, heading: 0, speed: 0, kind: 'sedan', color: '#2980b9' },
    );
    // Low three-quarter camera, 9.3 m out and 45° off the car's axis, so
    // the hero shows his side and rear big in the foreground — a camera
    // dead behind the car foreshortens him to a 2 m-wide rear — looking
    // WSW so the sun, lighthouse and sea sit left of frame and the pastel
    // row lines the right edge; a palm at (7.4, 253.7) frames the left
    // edge. The car sits at the right third. The look point is raised
    // (2.4) so the marina and sunset fill more of the frame and the
    // asphalt less.
    pointCam(7.8, 2.7, 245.8, -22, 2.4, 240);
    return 'play';
  }
  if (name === 'beach-hero') {
    // Concept B — Beach Hero. The hero stands on the sand, back to the
    // camera, looking SSW at the pier and the neon SOLMARINA sign; the
    // sun and lighthouse sit left, beachgoers and umbrellas fill the
    // mid-frame, the sea is the foreground. The HUD is hidden by
    // cover-clean mode, the same as the cover — this is the second
    // cover variant.
    world.pinClock(18.2);
    s.player.mode = 'walk';
    // The hero stands SOUTH of the beach road (asphalt runs z 282-294),
    // on the sand at z = 306, so the road stays behind the camera and
    // the frame reads as a beach, not a street.
    const heroPose = { x: 14, z: 306, heading: -2.85 };
    Object.assign(s.player, heroPose);
    s.heroCar.x = 24; s.heroCar.z = 234; s.heroCar.heading = -Math.PI / 2;
    // Five seeded beachgoers, repositioned to fixed spots around the
    // hero (deterministic literals, slow stroll) so the beach reads
    // inhabited without upstaging him — all inside the view cone
    // (south-west of the camera), clear of the pier deck.
    const goers = [
      [-2, 309, Math.PI, 0.5],
      [4, 311, Math.PI, 0.6],
      [-12, 308, Math.PI, 0.4],
      [-20, 310, Math.PI, 0.5],
      [8, 309, Math.PI, 0.6],
    ];
    goers.forEach(([x, z, h, sp], i) => {
      const pd = s.peds[i];
      pd.x = x; pd.z = z; pd.heading = h; pd.speed = sp; pd.alive = true;
    });
    advance(world, 3, () => walkToward(world, 14, 306));
    Object.assign(s.player, heroPose);
    // The camera sits dead on the hero's facing axis, 4.5 m behind him
    // and low (y 2.4), so the hero is bottom-centre, about a third of
    // frame height, back to camera, with the sign and sun dead ahead on
    // the same axis. The look point drops to y -2.0, pitching the camera
    // about 10° down: the sea horizon now sits ~30% from the top instead
    // of ~46%, so the top of the frame is no longer empty sky.
    pointCam(18.3, 2.4, 304.7, -6, -2.0, 312);
    return 'play';
  }
  if (name === 'start') {
    world.pinClock(17.5);
    s.player.mode = 'walk';
    s.player.x = -48; s.player.z = 52; s.player.heading = Math.PI / 2;
    s.heroCar.x = -48; s.heroCar.z = 42;
    pointCam(-48, 4.5, 62, -48, 1.5, 10);
    return 'play';
  }
  if (name === 'play') {
    world.pinClock(17.5);
    advance(world, 20);
    renderer.setCamOverride(null);
    renderer.snapFollow();
    return 'play';
  }
  if (name === 'end') {
    world.pinClock(18.6);
    s.missions.active = 3; s.missions.stage = 1; s.missions.started = true;
    s.missions.dialog = { speaker: 'DANTE', line: 'Pier run — 120 seconds. Go, Rio.' };
    s.missions.dialogTimer = 9;
    s.objective = { x: PIER.x, z: PIER.z, label: 'Run the pier in 120 seconds' };
    s.player.mode = 'car';
    s.heroCar.x = 300; s.heroCar.z = 24; s.heroCar.heading = 0; s.heroCar.speed = 0;
    s.player.x = 300; s.player.z = 24;
    s.wanted = 0;
    advance(world, 4, () => driveToward(world, PIER.x, PIER.z));
    s.heroCar.x = 330; s.heroCar.z = 24; s.heroCar.heading = 0;
    pointCam(306, 5.5, 40, 384, 2, 24);
    return 'play';
  }
  if (name === 'market') {
    world.pinClock(17.5);
    s.player.mode = 'walk';
    s.player.x = MARKET.x - 6; s.player.z = MARKET.z + 20; s.player.heading = Math.PI / 2;
    advance(world, 3, () => walkToward(world, MARKET.x, MARKET.z));
    s.player.x = MARKET.x - 6; s.player.z = MARKET.z + 16; s.player.heading = Math.PI / 2;
    // camera shifted east + look west so the hero sits at the left third,
    // not dead-centre with his back to the lens blocking the stalls
    pointCam(MARKET.x - 2, 3.2, MARKET.z + 22, MARKET.x - 8, 2, MARKET.z - 12);
    return 'play';
  }
  if (name === 'nightmarket') {
    world.pinClock(21.5);
    s.player.mode = 'walk';
    s.player.x = MARKET.x - 6; s.player.z = MARKET.z + 20; s.player.heading = Math.PI / 2;
    advance(world, 3, () => walkToward(world, MARKET.x, MARKET.z));
    s.player.x = MARKET.x - 6; s.player.z = MARKET.z + 16; s.player.heading = Math.PI / 2;
    // same off-centre hero as the day market
    pointCam(MARKET.x - 2, 3.2, MARKET.z + 22, MARKET.x - 8, 2, MARKET.z - 12);
    return 'play';
  }
  if (name === 'beach') {
    // sunset on the sand: hero on foot ON the sand among the
    // northern umbrella row, camera just east of him looking
    // west-southwest — sun + lighthouse + sea at the left, umbrellas +
    // towels + beachgoers big in the foreground, sand underfoot. The
    // z = 288 road runs parallel to any westward view, so the trick is
    // distance: from the northern strip (camera z = 260) the road is
    // 22 m+ away and reads as a midground band, while the southern
    // strip (camera z = 300) put the lens 12 m from it and the
    // road filled half the frame; the first try (hero z = 284) stood
    // ON the road itself.
    world.pinClock(18.2);
    s.player.mode = 'walk';
    s.player.x = -17; s.player.z = 266; s.player.heading = -2.7;
    s.heroCar.x = 24; s.heroCar.z = 234; s.heroCar.heading = -Math.PI / 2;
    // beachgoers on the sand: reposition 5 seeded peds to fixed spots
    // WEST of the hero (deterministic literals, slow stroll west along
    // the beach) so no bystander upstages him — the hero at 23 m is the
    // biggest figure in frame
    const goers = [
      [-48, 270, Math.PI, 0.5],
      [-58, 262, Math.PI, 0.6],
      [-64, 272, Math.PI, 0.4],
      [-40, 276, Math.PI, 0.5],
      [-70, 266, Math.PI, 0.6],
    ];
    goers.forEach(([x, z, h, sp], i) => {
      const pd = s.peds[i];
      pd.x = x; pd.z = z; pd.heading = h; pd.speed = sp; pd.alive = true;
    });
    advance(world, 3, () => walkToward(world, -17, 266));
    s.player.x = -17; s.player.z = 266; s.player.heading = -2.7;
    // camera closer + lower (9.8 m from the hero, was 13.5 m) so the
    // hero reads at thumbnail size; sun + lighthouse stay left of frame
    pointCam(-8, 4.2, 262, -75, 2, 280);
    return 'play';
  }
  if (name === 'chase') {
    // coastal sunset chase: westbound on the beach road at 18:00,
    // sun low ahead-left over the sea, skyline right, palms lining the
    // road, heli ahead over the water, police closing from behind
    world.pinClock(18.0);
    s.player.mode = 'car';
    s.heroCar.x = -40; s.heroCar.z = 240; s.heroCar.heading = Math.PI; s.heroCar.speed = 18;
    s.player.x = -40; s.player.z = 240;
    s.wanted = 4; s.heli.active = true; s.heli.staged = true; s.heli.x = -54; s.heli.z = 247; s.heli.alt = 13;
    for (let i = 0; i < 4; i++) {
      s.police.push({ x: -24 + i * 10, z: (i % 2 ? 236 : 244), heading: Math.PI, speed: 16, search: 0, siren: i });
    }
    advance(world, 3, () => driveToward(world, -200, 240));
    s.heroCar.x = -40; s.heroCar.z = 240; s.heroCar.heading = Math.PI;
    // heli big ahead-left over the sea, frozen by the staged flag — the
    // first orbit put it at alt ~48, a small speck clipped at the frame
    // edge; the first staged try (-48, 248, 12) was 22 m out and the
    // rotor disc clipped the top edge, so it sits 28 m out now
    s.heli.active = true; s.heli.staged = true; s.heli.x = -54; s.heli.z = 247; s.heli.alt = 13;
    pointCam(-28, 4.6, 242, -95, 2, 238);
    return 'play';
  }
  // default: plain play
  world.pinClock(17.5);
  advance(world, 10);
  renderer.setCamOverride(null);
  return 'play';
}
