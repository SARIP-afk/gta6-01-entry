// The screenshot scenes behind ?shot=cover|start|play|end. Each one plays the real
// rules forward from a fresh world, steered by an autopilot that drives the road
// grid Manhattan-style toward the mission objective, so the frame is what a short
// game really looks like and the same seed always gives the same frame.
import { CITY, STEP } from './config.js';
import { SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { SUNSET_HOUR } from './daynight.js';

const START_SECONDS = 5;
const PLAY_SECONDS = 26;
const END_SECONDS = 60;
const COVER_SECONDS = 3;

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

const ROADS = [];
for (let v = CITY.gridMin; v <= CITY.gridMax; v += CITY.roadStep) ROADS.push(v);

function nearestRoad(v) {
  let best = ROADS[0];
  let bd = Infinity;
  for (const r of ROADS) {
    if (Math.abs(v - r) < bd) { bd = Math.abs(v - r); best = r; }
  }
  return best;
}

/** Next road-grid waypoint toward (tx, tz) from (x, z): Manhattan routing. */
function nextWaypoint(x, z, tx, tz) {
  const rx = nearestRoad(x);
  const rz = nearestRoad(z);
  const onX = Math.abs(x - rx) < 4;
  const onZ = Math.abs(z - rz) < 4;
  if (onX && onZ) {
    if (Math.abs(tx - x) > Math.abs(tz - z)) return { x: x + Math.sign(tx - x) * 52, z };
    return { x, z: z + Math.sign(tz - z) * 52 };
  }
  if (onX) return { x: rx, z: z + Math.sign(tz - z) * 52 };
  if (onZ) return { x: x + Math.sign(tx - x) * 52, z: rz };
  return { x: rx, z: rz };
}

function driveInput(world, tx, tz) {
  const s = world.state;
  const car = s.heroCar;
  // The pier sits east of the grid on the causeway: route via (312, -6) first.
  let ex = tx;
  let ez = tz;
  if (tx > CITY.gridMax && (car.x < CITY.gridMax - 2 || Math.abs(car.z + 6) > 6)) {
    ex = CITY.gridMax;
    ez = -6;
  }
  const wp = nextWaypoint(car.x, car.z, ex, ez);
  const want = Math.atan2(-(wp.z - car.z), wp.x - car.x);
  const diff = wrapAngle(want - car.heading);
  const dist = Math.hypot(tx - car.x, tz - car.z);
  return {
    moveX: 0, moveZ: 0,
    steer: Math.max(-1, Math.min(1, diff * 1.6)),
    throttle: Math.abs(diff) > 1.4 ? 0.25 : dist < 12 ? 0.4 : 1,
    brake: dist < 8 && Math.abs(car.speed) > 6,
    boost: false, enter: false, reload: false, shootAngle: null,
  };
}

function walkInput(world, tx, tz) {
  const s = world.state;
  const p = s.player;
  const d = Math.hypot(tx - p.x, tz - p.z);
  if (d < 1.5) return { moveX: 0, moveZ: 0, steer: 0, throttle: 0, brake: false, boost: false, enter: false, reload: false, shootAngle: null };
  return {
    moveX: (tx - p.x) / d, moveZ: (tz - p.z) / d,
    steer: 0, throttle: 0, brake: false, boost: false, enter: false, reload: false, shootAngle: null,
  };
}

function autopilot(world) {
  const s = world.state;
  const obj = s.objective;
  if (s.player.mode === 'car') return driveInput(world, obj.x, obj.z);
  const stage = s.missions.currentStage();
  if (stage && stage.footOnly) return walkInput(world, stage.x, stage.z);
  return walkInput(world, s.heroCar.x, s.heroCar.z);
}

/** Stage the named scene and return the screen to draw over it. */
export function stageShot(name, world) {
  world.reset(1);
  const s = world.state;
  if (name === 'cover') {
    // The cover clock is PINNED to sunset: the world steps for 3 s but the
    // hour never moves, and the renderer leaves its sunset defaults
    // untouched — so this frame is exactly the v4.3 cover frame. The clock
    // only runs in gameplay, never in a staged shot.
    world.pinClock(SUNSET_HOUR);
    // M4, wanted 3, DANTE on the line — staged on the coastal road at the south
    // edge of town (v3.1 staging), looking north up the boulevard: dense towers
    // on the left, the beach in the foreground, and on the right the marina,
    // the pier, the sea and the sun setting over it. Sol + marina in one frame.
    // Positions are the v3.1 ones; the cruisers and the nearest walkers are
    // re-placed for the close v4.3 follow camera (v3.1's 44 m camera put them
    // behind the lens): two cruisers flank the hero like the v1 reference
    // frame, one leads the chase up the road.
    s.missions.state.active = 3;
    s.missions.state.stage = 0;
    s.missions.state.started = true;
    s.missions.state.missionTime = 0;
    s.missions.state.dialog = { speaker: 'DANTE', line: 'It\'s a trap. Lose them — then bring it home.' };
    s.missions.state.dialogTimer = 6;
    s.player.mode = 'car';
    s.police.setWanted(3, s.events);
    // Let the street settle into natural positions for 3 s, then stage the frame
    // exactly — the camera looks north from behind the hero, so everything placed
    // here is what the cover shows.
    for (let i = 0; i < COVER_SECONDS / STEP; i += 1) {
      world.step(STEP, driveInput(world, CITY.pier.x, CITY.pier.z));
    }
    s.heroCar.x = 310;
    s.heroCar.z = 250;
    s.heroCar.heading = Math.PI / 2;
    s.heroCar.speed = 12;
    // Stage, not sim: the cover shows wanted 3 and a clean car.
    s.police.setWanted(3, []);
    s.heroCar.damage = 0;
    // Traffic on the coastal road, both directions, up the boulevard — the
    // nearest car just ahead of the hero so the chase reads at a glance.
    const coverCars = [
      [307, 235, Math.PI / 2], [313, 205, -Math.PI / 2],
      [307, 175, Math.PI / 2], [313, 140, -Math.PI / 2],
      [307, 105, Math.PI / 2], [313, 70, -Math.PI / 2],
      [307, 40, Math.PI / 2], [313, 10, -Math.PI / 2],
      [307, -20, Math.PI / 2], [313, -50, -Math.PI / 2],
    ];
    for (let i = 0; i < coverCars.length; i += 1) {
      const c = s.traffic.cars[i];
      s.traffic.setCar(i, coverCars[i][0], coverCars[i][1], coverCars[i][2]);
      // Staged lanes: northbound on the west side of the road, southbound on
      // the east side — restore the staged offsets (setCar snaps to the
      // centreline; the cover never steps after staging, so these hold).
      c.x = coverCars[i][0];
      c.z = coverCars[i][1];
      c.lat = coverCars[i][0] - 312;
      c.targetLat = c.lat;
      c.tx = 312;
      c.tz = coverCars[i][2] > 0 ? -100 : 300;
    }
    // Three cruisers in the frame: one leading the chase up the road, two
    // flanking the hero at the bottom corners like the v1 reference frame.
    if (s.police.units[0]) {
      s.police.units[0].x = s.heroCar.x;
      s.police.units[0].z = s.heroCar.z - 34;
      s.police.units[0].heading = Math.PI / 2;
    }
    if (s.police.units[1]) {
      s.police.units[1].x = s.heroCar.x + 5.5;
      s.police.units[1].z = s.heroCar.z + 1;
      s.police.units[1].heading = Math.PI / 2;
    }
    if (s.police.units[2]) {
      s.police.units[2].x = s.heroCar.x - 5.5;
      s.police.units[2].z = s.heroCar.z + 1;
      s.police.units[2].heading = Math.PI / 2;
    }
    // Walkers on the sidewalks along the coastal road, in the frame — ahead of
    // the close camera, so the street reads as lived-in — plus four on the
    // promenade east of the road.
    const coverPeds = [[304.5, 235], [319.5, 225], [304.5, 200], [319.5, 180], [304.5, 150], [319.5, 120], [304.5, 90], [319.5, 60], [326, 200], [332, 150], [326, 100], [330, 60]];
    for (let i = 0; i < coverPeds.length; i += 1) {
      const p = s.traffic.peds[i];
      p.x = coverPeds[i][0];
      p.z = coverPeds[i][1];
      p.heading = i % 2 === 0 ? Math.PI / 2 : -Math.PI / 2;
      p.phase = i * 1.1;
      p.down = false;
    }
    return { screen: SCREEN_PLAY };
  }
  if (name === 'start') {
    for (let i = 0; i < START_SECONDS / STEP; i += 1) {
      world.step(STEP, { moveX: 0, moveZ: 0, steer: 0, throttle: 0, brake: false, boost: false, enter: false, reload: false, shootAngle: null });
    }
    return { screen: SCREEN_TITLE };
  }
  if (name === 'stats') {
    // Play until M1 is done (or 150 s), so the STATS tab shows a real rating
    // and a completion above a fresh game — the same autopilot as 'play'.
    let entered = false;
    for (let i = 0; i < 150 / STEP; i += 1) {
      let input = autopilot(world);
      if (!entered && s.player.mode === 'foot' && Math.hypot(s.heroCar.x - s.player.x, s.heroCar.z - s.player.z) < 5) {
        input = { ...input, enter: true };
        entered = true;
      }
      world.step(STEP, input);
      if (s.missions.state.completed.includes('M1')) break;
      if (s.player.health <= 0) break;
    }
    if (s.police.state.wanted > 2) s.police.setWanted(2, []);
    s.heroCar.damage = Math.min(s.heroCar.damage, 15);
    return { screen: SCREEN_PLAY, statsTab: true };
  }
  if (name === 'chase') {
    // Wanted 4 chase with the helicopter up: drive the autopilot until the
    // heli is ahead of the hero (in the camera's forward cone), a cruiser is
    // in the front half too, and the camera's 24 m pull-back spot is on open
    // road — so the up-pitched chase camera (setFollow in main.js) frames the
    // hero, the cruisers and the helicopter body in one shot. Staging only:
    // the sim steps are the same autopilot as play/end, the loop just picks
    // the frame.
    s.missions.state.active = 3;
    s.missions.state.stage = 0;
    s.missions.state.started = true;
    s.missions.state.dialog = { speaker: 'DANTE', line: 'It\'s a trap. Lose them — then bring it home.' };
    s.missions.state.dialogTimer = 6;
    s.player.mode = 'car';
    s.police.setWanted(4, s.events);
    const fwd = (h) => [Math.cos(h), -Math.sin(h)];
    const spotClear = (x, z) => {
      for (const b of s.city.buildings) {
        if (Math.abs(x - b.x) < b.w / 2 + 1 && Math.abs(z - b.z) < b.d / 2 + 1) return false;
      }
      return true;
    };
    // Chase camera (setFollow(13, 3.0, 2.0, 8.0) in main.js): the camera sits
    // 13 m behind the hero, 2 m to his right, 3 m up, and looks 8 m ahead
    // of him at 8 m — a close rear-three-quarter view, so the hero fills
    // the lower frame and the sky above him stays in it. Project a world
    // point through exactly that camera (60° vertical FOV, 16:9) and return
    // NDC, so the frame check holds at 720p and 1080p alike.
    const CHASE_CAM = { dist: 13, height: 3.0, side: 2.0, lookY: 8.0, lookAhead: 8 };
    const projectChasePoint = (hx, hz, hy, hero) => {
      const f = fwd(hero.heading);
      const r = [Math.sin(hero.heading), Math.cos(hero.heading)];
      const cx = hero.x - f[0] * CHASE_CAM.dist + r[0] * CHASE_CAM.side;
      const cz = hero.z - f[1] * CHASE_CAM.dist + r[1] * CHASE_CAM.side;
      const cy = CHASE_CAM.height;
      const lx = hero.x + f[0] * CHASE_CAM.lookAhead;
      const lz = hero.z + f[1] * CHASE_CAM.lookAhead;
      const ly = CHASE_CAM.lookY;
      let fx = lx - cx;
      let fy = ly - cy;
      let fz = lz - cz;
      const fl = Math.hypot(fx, fy, fz);
      fx /= fl; fy /= fl; fz /= fl;
      // right = normalize(cross(forward, up)), up2 = cross(right, forward).
      let rx = -fz;
      let rz = fx;
      const rl = Math.hypot(rx, rz);
      rx /= rl; rz /= rl;
      const ux = -rz * fy;
      const uy = rz * fx - rx * fz;
      const uz = rx * fy;
      const vx = hx - cx;
      const vy = hy - cy;
      const vz = hz - cz;
      const zc = vx * fx + vy * fy + vz * fz;
      if (zc <= 0) return null;
      const xc = vx * rx + vz * rz;
      const yc = vx * ux + vy * uy + vz * uz;
      const t = Math.tan(Math.PI / 6);
      return { xNdc: xc / (zc * t * (16 / 9)), yNdc: yc / (zc * t) };
    };
    // The staged helicopter slot: 28 m ahead of the hero and 8 m to his
    // right (clear of the top-centre mission banner and the right-hand weapon
    // panel), at an altitude that clears the roofs right beside the road —
    // never below 26 m, never above 30 m. Twenty-eight metres ahead is what
    // keeps it in frame: at 24 m the close camera looks up at it too steeply
    // and it projects above the top edge, and the v4.8-a probe proved it — the
    // loop ran its full 150 s without ever finding a frame, then staged
    // blind and the heli hid behind a tower. The sim's 42 m orbit is too
    // high for a close camera: at 42 m the heli can only be in frame if the
    // camera is 36 m back, and then everything in the frame is a speck.
    const stageHeliPos = (hero) => {
      const f = fwd(hero.heading);
      const r = [Math.sin(hero.heading), Math.cos(hero.heading)];
      const hx = hero.x + f[0] * 28 + r[0] * 8;
      const hz = hero.z + f[1] * 28 + r[1] * 8;
      let roof = 0;
      for (const b of s.city.buildings) {
        if (Math.hypot(b.x - hx, b.z - hz) < 18) roof = Math.max(roof, b.h);
      }
      return { x: hx, z: hz, y: Math.min(30, Math.max(26, roof + 3)) };
    };
    // The staged slot must be in open air, not inside a tower (the hero may
    // be mid-turn when the frame is picked, which would put the slot over a
    // block instead of over the road).
    const heliSlotClear = (hx, hz, hy) => {
      for (const b of s.city.buildings) {
        if (Math.abs(hx - b.x) < b.w / 2 + 1 && Math.abs(hz - b.z) < b.d / 2 + 1 && b.h > hy - 2) return false;
      }
      return true;
    };
    // No tower between the camera and the staged heli either: the sightline
    // runs up the road, and a corner building would swallow the helicopter.
    const sightClear = (ax, ay, az, bx, by, bz) => {
      for (let t = 0.1; t < 1; t += 0.1) {
        const x = ax + (bx - ax) * t;
        const y = ay + (by - ay) * t;
        const z = az + (bz - az) * t;
        for (const b of s.city.buildings) {
          if (Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2 && y < b.h) return false;
        }
      }
      return true;
    };
    let entered = false;
    let chaseBroke = false;
    let chaseSteps = 0;
    for (let i = 0; i < 150 / STEP; i += 1) {
      chaseSteps = i;
      // Heat decays over a long chase: re-apply wanted 4 every 10 s so the
      // helicopter stays up until the frame is found.
      if (i > 0 && i % 600 === 0 && s.police.state.wanted < 4) s.police.setWanted(4, s.events);
      let input = autopilot(world);
      if (!entered && s.player.mode === 'foot' && Math.hypot(s.heroCar.x - s.player.x, s.heroCar.z - s.player.z) < 5) {
        input = { ...input, enter: true };
        entered = true;
      }
      world.step(STEP, input);
      if (s.player.health <= 0) break;
      if (i < 600) continue;
      if (s.events.some((e) => e.type === 'bust')) break;
      const h = s.heroCar;
      if (Math.abs(h.speed) < 6 || h.damage >= 40) continue;
      const he = s.heli.state;
      if (!he.active) continue;
      const f = fwd(h.heading);
      const r = [Math.sin(h.heading), Math.cos(h.heading)];
      const camX = h.x - f[0] * CHASE_CAM.dist + r[0] * CHASE_CAM.side;
      const camZ = h.z - f[1] * CHASE_CAM.dist + r[1] * CHASE_CAM.side;
      if (!spotClear(camX, camZ)) continue;
      // The staged heli must project into clear sky on the staged frame —
      // below the mission banner (top centre), left of the weapon panel,
      // right of the dispatch panel — in NDC, so the check holds at 720p
      // and 1080p alike: yNdc 0.16–0.70 is the top ~15–42% of the frame.
      const sp = stageHeliPos(h);
      if (!heliSlotClear(sp.x, sp.z, sp.y)) continue;
      const proj = projectChasePoint(sp.x, sp.z, sp.y, h);
      if (!proj || proj.yNdc < 0.16 || proj.yNdc > 0.70 || proj.xNdc < -0.5 || proj.xNdc > 0.7) continue;
      if (!sightClear(camX, CHASE_CAM.height, camZ, sp.x, sp.y, sp.z)) continue;
      chaseBroke = true;
      break;
    }
    // For the verifier: whether the loop found a frame or ran its full 150 s.
    world.__chase = { broke: chaseBroke, steps: chaseSteps };
    // Re-stage the frame (staging, not sim — the same pattern as the cover,
    // which re-places cruisers, traffic and walkers after its settle run):
    // the helicopter drops onto its staged slot ahead of the hero, side-on
    // to the camera so the white body, red stripe and rotor span read at
    // full width, its searchlight cone glued to the hero; two cruisers
    // flank the hero up the road and the other two hold behind the camera,
    // so the frame reads as a chase, not a street scene.
    const h = s.heroCar;
    const sp = stageHeliPos(h);
    const he = s.heli.state;
    he.active = true;
    he.leaving = false;
    he.x = sp.x;
    he.z = sp.z;
    he.y = sp.y;
    he.heading = h.heading + Math.PI / 2;
    he.lightX = h.x;
    he.lightZ = h.z;
    {
      const f = fwd(h.heading);
      const r = [Math.sin(h.heading), Math.cos(h.heading)];
      const placeCruiser = (idx, along, lat) => {
        const u = s.police.units[idx];
        if (!u) return;
        u.x = h.x + f[0] * along + r[0] * lat;
        u.z = h.z + f[1] * along + r[1] * lat;
        u.heading = h.heading;
      };
      placeCruiser(0, 14, -5.5);
      placeCruiser(1, 12, 6.5);
      placeCruiser(2, -20, -6);
      placeCruiser(3, -26, 6);
    }
    s.police.setWanted(4, []);
    s.heroCar.damage = Math.min(s.heroCar.damage, 15);
    return { screen: SCREEN_PLAY };
  }
  const seconds = name === 'end' ? END_SECONDS : PLAY_SECONDS;
  if (name === 'end') {
    s.missions.state.active = 3;
    s.missions.state.stage = 0;
    s.missions.state.started = true;
    s.missions.state.dialog = { speaker: 'DANTE', line: 'It\'s a trap. Lose them — then bring it home.' };
    s.missions.state.dialogTimer = 6;
    s.police.setWanted(3, s.events);
    s.player.mode = 'car';
  }
  let entered = false;
  for (let i = 0; i < seconds / STEP; i += 1) {
    let input = autopilot(world);
    if (!entered && s.player.mode === 'foot' && Math.hypot(s.heroCar.x - s.player.x, s.heroCar.z - s.player.z) < 5) {
      input = { ...input, enter: true };
      entered = true;
    }
    world.step(STEP, input);
    if (s.player.health <= 0) break;
  }
  // Stage, not sim: play shows a working chase at most wanted 2, end shows wanted 3.
  if (name === 'play') {
    // Densify the frame: traffic ahead on the hero's road and walkers on the
    // sidewalks beside it, so the play shot is a chase, not an empty street.
    const focus = s.player.mode === 'car' ? s.heroCar : s.player;
    const fx = Math.cos(focus.heading);
    const fz = -Math.sin(focus.heading);
    const rx = Math.sin(focus.heading);
    const rz = Math.cos(focus.heading);
    for (let i = 0; i < 5; i += 1) {
      const c = s.traffic.cars[i];
      const d = 16 + i * 13;
      const lat = i % 2 === 0 ? 3.2 : -3.2;
      const nx = focus.x + fx * d + rx * lat;
      const nz = focus.z + fz * d + rz * lat;
      s.traffic.setCar(i, nx, nz, i % 2 === 0 ? focus.heading : focus.heading + Math.PI);
      c.x = nx;
      c.z = nz;
      c.tx = focus.x + fx * 200;
      c.tz = focus.z + fz * 200;
    }
    for (let i = 0; i < 6; i += 1) {
      const p = s.traffic.peds[i];
      const d = 8 + i * 9;
      const lat = i % 2 === 0 ? 6 : -6;
      p.x = focus.x + fx * d + rx * lat;
      p.z = focus.z + fz * d + rz * lat;
      p.heading = i % 2 === 0 ? focus.heading + Math.PI / 2 : focus.heading - Math.PI / 2;
      p.phase = i * 1.3;
      p.down = false;
    }
  }
  if (name === 'end') {
    s.police.setWanted(3, []);
    s.heroCar.damage = 0;
  } else if (s.police.state.wanted > 2) {
    s.police.setWanted(2, []);
  }
  s.heroCar.damage = Math.min(s.heroCar.damage, 15);
  return { screen: s.player.health <= 0 ? SCREEN_OVER : SCREEN_PLAY };
}
