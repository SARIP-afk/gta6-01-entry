// Solmarina day/night: one 24-hour clock, driven only by sim steps.
// The clock never reads the wall clock: game hours are a pure function of the
// sim step count, so the same seed and the same inputs always give the same
// sky. One sim minute is one game hour (60 sim seconds per game hour), so a
// mission that takes about a minute of play visibly moves the sun, and a few
// minutes of play carry the city from sunset into night.
//
// The game opens at 17:30 — sunset over the marina, the hour the cover was
// staged at — and the light then slides through dusk into night and back
// through dawn. The cover itself is pinned (see world.pinClock): while the
// pin is set the clock does not advance and the renderer leaves its sunset
// defaults untouched, so the staged cover frame is exactly the v4.4 frame.
//
// Pure data in, pure data out: no THREE, no DOM, no randomness. The renderer
// turns a sample into lights and shader uniforms; the HUD turns the hour
// into HH:MM text. Both are deterministic functions of the step count.

export const START_HOUR = 17.5;
export const HOURS_PER_SIM_SECOND = 1 / 60;
export const SUNSET_HOUR = 17.5;

/** Game hours (0..24) after `stepCount` fixed steps. */
export function hoursAt(stepCount) {
  const h = START_HOUR + stepCount * (1 / 60) * HOURS_PER_SIM_SECOND;
  return h - Math.floor(h / 24) * 24;
}

/** HH:MM for an hour value. */
export function formatClock(hours) {
  const hh = Math.floor(hours) % 24;
  const mm = Math.floor((hours - Math.floor(hours)) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Phase name for the HUD clock: DAWN, DAY, SUNSET, DUSK or NIGHT. */
export function phaseAt(hours) {
  if (hours >= 5.5 && hours < 7.5) return 'DAWN';
  if (hours >= 7.5 && hours < 16.5) return 'DAY';
  if (hours >= 16.5 && hours < 18.5) return 'SUNSET';
  if (hours >= 18.5 && hours < 20.5) return 'DUSK';
  return 'NIGHT';
}

function hex(rgb) {
  return [((rgb >> 16) & 255) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255];
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerp3(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

// One keyframe per phase of the day. Colours are the v4.3 sunset values at
// 17:30 — top/mid/bot sky, fog, sun and hemisphere light are exactly what
// the renderer already used — and darker, cooler values at night, with the
// sun low over the sea in the morning, high at noon, and gone after dusk.
// sunPos is where the sun disc sits; sunDir is the sky shader's sun
// direction (kept as the v4.3 vector at sunset, so the glow sits on the disc).
// night is 0 by day and 1 in deep night: it drives the street lamps and the
// headlights. elev is the sun's elevation in degrees; below -3 the disc is
// hidden and the moon is up instead.
const KEYS = [
  {
    h: 0, top: 0x060a18, mid: 0x0d1526, bot: 0x1a2233,
    sunCol: 0x8899bb, sunI: 0.4, sunDir: [0.96, -0.42, 0.06], sunPos: [760, -355, 51],
    hemiSky: 0x1a2438, hemiGround: 0x0a0c10, hemiI: 0.5,
    fillCol: 0x5a6a8a, fillI: 0.2, fog: 0x0d1526, fogNear: 200, fogFar: 900,
    night: 1, elev: -30,
  },
  {
    h: 5, top: 0x0a1226, mid: 0x16233a, bot: 0x232c40,
    sunCol: 0x8899bb, sunI: 0.45, sunDir: [0.97, -0.3, 0.06], sunPos: [800, -260, 51],
    hemiSky: 0x223050, hemiGround: 0x0c0e12, hemiI: 0.55,
    fillCol: 0x5a6a8a, fillI: 0.25, fog: 0x141c2e, fogNear: 220, fogFar: 950,
    night: 0.9, elev: -18,
  },
  {
    h: 6, top: 0x3a5a8a, mid: 0xc98a6a, bot: 0xff9a5a,
    sunCol: 0xffb37a, sunI: 0.9, sunDir: [0.99, 0.04, 0.06], sunPos: [844, 30, 51],
    hemiSky: 0x9ab4d6, hemiGround: 0x6a5a44, hemiI: 0.6,
    fillCol: 0xffc9a0, fillI: 0.45, fog: 0xd9a887, fogNear: 300, fogFar: 1100,
    night: 0.35, elev: 2,
  },
  {
    h: 8, top: 0x2b7cd3, mid: 0x8ec9ee, bot: 0xffd9a0,
    sunCol: 0xfff2cc, sunI: 2.0, sunDir: [0.9, 0.42, 0.06], sunPos: [765, 358, 51],
    hemiSky: 0xbfdfff, hemiGround: 0x8a6a4a, hemiI: 0.9,
    fillCol: 0xffe0b3, fillI: 0.7, fog: 0xe8d9b8, fogNear: 360, fogFar: 1350,
    night: 0, elev: 25,
  },
  {
    h: 12, top: 0x1f6fd0, mid: 0x7ec3ef, bot: 0xcfe8f5,
    sunCol: 0xffffff, sunI: 3.0, sunDir: [0.35, 0.93, 0.06], sunPos: [300, 785, 51],
    hemiSky: 0xcfe8ff, hemiGround: 0x9a7a55, hemiI: 1.15,
    fillCol: 0xfff0d0, fillI: 0.9, fog: 0xdfe9ee, fogNear: 380, fogFar: 1400,
    night: 0, elev: 68,
  },
  {
    h: 16, top: 0x2b7cd3, mid: 0x8ec9ee, bot: 0xffc46b,
    sunCol: 0xfff2cc, sunI: 2.6, sunDir: [0.86, 0.5, 0.06], sunPos: [730, 423, 51],
    hemiSky: 0xbfdfff, hemiGround: 0x8a6a4a, hemiI: 1.05,
    fillCol: 0xffe0b3, fillI: 0.85, fog: 0xefd9b8, fogNear: 380, fogFar: 1400,
    night: 0, elev: 30,
  },
  {
    h: 17.5, top: 0x2b7cd3, mid: 0x8ec9ee, bot: 0xffc46b,
    sunCol: 0xfff2c0, sunI: 2.6, sunDir: [582, 135, 51], sunPos: [833, 139, 51],
    hemiSky: 0xbfdfff, hemiGround: 0x8a6a4a, hemiI: 1.05,
    fillCol: 0xffe0b3, fillI: 0.85, fog: 0xefd9b8, fogNear: 380, fogFar: 1400,
    night: 0, elev: 9.5,
  },
  {
    h: 19, top: 0x2a3a6a, mid: 0xb06a7a, bot: 0xff7a4a,
    sunCol: 0xff9a5a, sunI: 1.2, sunDir: [0.99, -0.03, 0.06], sunPos: [844, -28, 51],
    hemiSky: 0x6a7aa0, hemiGround: 0x4a3a30, hemiI: 0.7,
    fillCol: 0xd9a080, fillI: 0.5, fog: 0xc99a7a, fogNear: 300, fogFar: 1100,
    night: 0.25, elev: -2,
  },
  {
    h: 21, top: 0x0a1024, mid: 0x16233a, bot: 0x2a2a44,
    sunCol: 0xaabbcc, sunI: 0.45, sunDir: [0.97, -0.36, 0.06], sunPos: [780, -310, 51],
    hemiSky: 0x223050, hemiGround: 0x0c0e12, hemiI: 0.55,
    fillCol: 0x5a6a8a, fillI: 0.25, fog: 0x141c2e, fogNear: 220, fogFar: 950,
    night: 0.9, elev: -25,
  },
  {
    h: 24, top: 0x060a18, mid: 0x0d1526, bot: 0x1a2233,
    sunCol: 0x8899bb, sunI: 0.4, sunDir: [0.96, -0.42, 0.06], sunPos: [760, -355, 51],
    hemiSky: 0x1a2438, hemiGround: 0x0a0c10, hemiI: 0.5,
    fillCol: 0x5a6a8a, fillI: 0.2, fog: 0x0d1526, fogNear: 200, fogFar: 900,
    night: 1, elev: -30,
  },
];

/** Interpolated lighting for an hour value: colours as [r, g, b] 0..1. */
export function sampleDayNight(hours) {
  let i = 0;
  while (i < KEYS.length - 2 && hours >= KEYS[i + 1].h) i += 1;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = Math.max(0, Math.min(1, (hours - a.h) / (b.h - a.h)));
  const dir = lerp3(a.sunDir, b.sunDir, t);
  const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  return {
    top: lerp3(hex(a.top), hex(b.top), t),
    mid: lerp3(hex(a.mid), hex(b.mid), t),
    bot: lerp3(hex(a.bot), hex(b.bot), t),
    sunCol: lerp3(hex(a.sunCol), hex(b.sunCol), t),
    sunI: lerp(a.sunI, b.sunI, t),
    sunDir: [dir[0] / dl, dir[1] / dl, dir[2] / dl],
    sunPos: lerp3(a.sunPos, b.sunPos, t),
    hemiSky: lerp3(hex(a.hemiSky), hex(b.hemiSky), t),
    hemiGround: lerp3(hex(a.hemiGround), hex(b.hemiGround), t),
    hemiI: lerp(a.hemiI, b.hemiI, t),
    fillCol: lerp3(hex(a.fillCol), hex(b.fillCol), t),
    fillI: lerp(a.fillI, b.fillI, t),
    fog: lerp3(hex(a.fog), hex(b.fog), t),
    fogNear: lerp(a.fogNear, b.fogNear, t),
    fogFar: lerp(a.fogFar, b.fogFar, t),
    night: lerp(a.night, b.night, t),
    elev: lerp(a.elev, b.elev, t),
    sunUp: lerp(a.elev, b.elev, t) > -3,
    moonUp: lerp(a.night, b.night, t) > 0.5,
  };
}
