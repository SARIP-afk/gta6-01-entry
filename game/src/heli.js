// Air support: at wanted 4 and 5 a police helicopter works the sky over Rio.
// It circles overhead, keeps its searchlight on him, and pulls away when the
// heat drops. AI only — nobody flies it, it never lands, and it never shoots —
// so it can never break the driving, the missions, or the trace. The orbit is
// a clock (angle advances on the fixed step), never a random walk, so a replay
// with the same inputs puts the helicopter in the same sky. Pure sim.
export const HELI_MIN_WANTED = 4;
export const HELI_HEIGHT = 42;
export const HELI_ORBIT_RADIUS = 26;
export const HELI_ORBIT_SPEED = 0.22; // radians per second around Rio
export const HELI_LEAVE_SPEED = 26; // metres per second, straight out to sea

export function createHeli(random) {
  return {
    random,
    state: {
      active: false,
      leaving: false,
      x: 0, z: 0, y: HELI_HEIGHT,
      heading: 0,
      orbitAngle: 0,
      lightX: 0, lightZ: 0, // where the searchlight points on the ground
      rotor: 0,
    },
  };
}

function spawn(heli, px, pz) {
  const st = heli.state;
  const a = heli.random() * Math.PI * 2;
  st.x = px + Math.cos(a) * 90;
  st.z = pz + Math.sin(a) * 90;
  st.y = HELI_HEIGHT;
  st.orbitAngle = Math.atan2(-(pz - st.z), px - st.x);
  st.leaving = false;
  st.active = true;
  st.lightX = px;
  st.lightZ = pz;
}

/** One fixed step. `wanted` is the live level; (px, pz) is Rio, car or foot. */
export function stepHeli(heli, dt, px, pz, wanted, events) {
  const st = heli.state;
  st.rotor += dt * 22;
  if (!st.active && wanted >= HELI_MIN_WANTED) {
    spawn(heli, px, pz);
    if (events) events.push({ type: 'heli' });
    return;
  }
  if (!st.active) return;
  if (wanted < HELI_MIN_WANTED) st.leaving = true;
  if (st.leaving) {
    // Out to sea, climbing: east, away from the city, then gone.
    st.x += HELI_LEAVE_SPEED * dt;
    st.y = Math.min(HELI_HEIGHT + 30, st.y + 8 * dt);
    st.lightX = st.x;
    st.lightZ = st.z;
    if (st.x > 560 || st.y >= HELI_HEIGHT + 30) {
      st.active = false;
      st.leaving = false;
    }
    return;
  }
  // Orbit Rio: the angle walks around him, the helicopter eases onto the ring.
  st.orbitAngle += HELI_ORBIT_SPEED * dt;
  const tx = px + Math.cos(st.orbitAngle) * HELI_ORBIT_RADIUS;
  const tz = pz - Math.sin(st.orbitAngle) * HELI_ORBIT_RADIUS;
  st.x += (tx - st.x) * Math.min(1, 1.4 * dt);
  st.z += (tz - st.z) * Math.min(1, 1.4 * dt);
  st.y += (HELI_HEIGHT - st.y) * Math.min(1, 2 * dt);
  st.heading = Math.atan2(-(pz - st.z), px - st.x);
  // The searchlight stays glued to Rio, lagging a little behind his movement.
  st.lightX += (px - st.lightX) * Math.min(1, 3 * dt);
  st.lightZ += (pz - st.lightZ) * Math.min(1, 3 * dt);
}

export function resetHeli(heli) {
  const st = heli.state;
  st.active = false;
  st.leaving = false;
  st.x = 0;
  st.z = 0;
  st.y = HELI_HEIGHT;
  st.heading = 0;
  st.orbitAngle = 0;
  st.lightX = 0;
  st.lightZ = 0;
  st.rotor = 0;
}
