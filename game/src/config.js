// Every tuning number, name and colour in one place. Solmarina is a sun-soaked coastal
// Finishing (v3.8-structural, recording #4): file re-written in this session; gates re-run on this exact content — see BATCH2-FINISH-REPORT.md.
// city: golden-hour light, warm walls, a marina and a pier on the east sea edge.
// The city is a 12x12 block grid (52 m pitch) centred on the origin; roads are the gaps.
// All randomness comes from the seeded generator, so the same seed builds the same city.

export const GAME = {
  title: 'Solmarina',
  city: 'Solmarina',
  hero: 'Rio',
  tagline: 'A courier. A debt. A city that never slows down.',
};

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** Default seed when the URL gives none; ?seed=N fixes the city and the staged shots. */
export const DEFAULT_SEED = 1;

export const CITY = {
  blocks: 12,
  block: 40,
  road: 12,
  pitch: 52,
  half: 312,
  sidewalk: 3,
  // East of this x the land ends: promenade, then the sea.
  seaX: 336,
  // The marina channel: water cut east-west along z in [-10, 10], from x 200 to the sea.
  channel: { x0: 200, x1: 336, z0: -10, z1: 10 },
  // The one bridge over the channel: a deck spanning it along the east-west road at
  // z -6 (the road the car spawns on, facing east toward the bridge). It overlaps both
  // banks by 2 m so the road reads as continuous; the water north of the deck still
  // blocks cars and feet. (Phase 1 fix: the first build put two short slabs across
  // the channel that touched neither bank, so the car could never cross.)
  bridge: { x0: 198, x1: 338, z: -6, width: 12 },
  // Landmarks, by block centre.
  tower: { bx: 5, bz: 1, height: 112 },
  stadium: { bx: 2, bz: 9, radius: 42 },
  pier: { x0: 336, x1: 430, z: -6, width: 12 },
};

/** Districts, by block column/row: downtown towers north-centre, marina east, suburbs elsewhere. */
export function districtOf(bx, bz) {
  if (bx >= 4 && bx <= 7 && bz <= 3) return 'downtown';
  if (bx >= 8) return 'marina';
  return 'suburb';
}

export const CAR = {
  length: 4.4,
  width: 1.9,
  wheelbase: 2.8,
  accel: 16,
  brake: 30,
  reverseAccel: 10,
  maxSpeed: 34,
  maxReverse: 10,
  drag: 0.35,
  steerMax: 0.55,
  // Cap on the yaw rate (rad/s) at speed: full lock at low speed, but the wheel
  // angle shrinks as speed grows so the car never spins at 30+ m/s. (Phase 1 fix:
  // the old linear falloff still let the car yaw ~2.8 rad/s at 31 m/s.)
  steerYawCap: 1.4,
  handbrakeDecel: 22,
  // Colour of the player's car: coral red, so it reads in a screenshot.
  color: 0xe8543f,
  cabinColor: 0x2a3140,
  wheelColor: 0x14161a,
  // Phase 3.5 visual pass: real glass (light, not the old solid dark cabin),
  // dark trim for bumpers/grille, bright hubs so the wheels read on black asphalt.
  glassColor: 0x8fb8cc,
  glassBright: 0xc8e2f0,
  trimColor: 0x2a2f36,
  hubColor: 0xc8ccd2,
  tailColor: 0xd8382a,
};

export const PLAYER = {
  radius: 0.55,
  height: 1.8,
  walkSpeed: 5,
  runSpeed: 9,
  accel: 40,
  color: 0xf2c94c,
  shirtColor: 0x2f6fb2,
  pantsColor: 0x33302a,
  // Phase 3.5 visual pass: shoes + a yellow jacket panel over the shirt, so Rio
  // reads as a person (not three boxes) at close range.
  shoeColor: 0x2a2622,
  jacketColor: 0xf2c94c,
};

export const CAMERA = {
  driveDistance: 11,
  driveHeight: 4.6,
  // F1 (L9): narrower + further cover, lower/slower on-foot — less
  // toy-like. coverDistance/coverFov only affect ?shot=cover; live
  // play keeps driveDistance/driveHeight above.
  footDistance: 6,
  footHeight: 3.0,
  fovBase: 60,
  fovSpeed: 10,
  smoothing: 5,
  // Cover shot only (Phase 3.5 visual pass): closer and lower than live play,
  // narrower FOV, so the car fills ~15% of the frame instead of ~5%. Live play
  // keeps driveDistance/driveHeight above — the cover override lives in
  // shots.js (world.state.cameraOverride) and never touches live play.
  // F1 (L9) — REVERT SELEKTIF 18 Nov: coverFov/coverDistance kembali ke
  // v3.8 (A/B: cover lebih buruk — 5.1 pita tetap 22,4% -> 0,6%, mobil
  // lebih kecil di frame; kontras arah pindah ke atas frame). Nilai
  // on-foot (footDistance 6, footHeight 3.0) DIPERTAHANKAN — A/B: Rio
  // ~195 px -> ~260 px, framing jalan kaki jelas lebih baik.
  coverDistance: 8.5,
  coverHeight: 4.0,
  coverFov: 55,
};

/**
 * Lighting (Batch 1, v3.7-sharp): the blur diagnosis measured street frames at
 * 46.6% near-black (luminance <32) vs 0.6% in the reference — hemisphere 0.85
 * could not lift the shadowed side after ACES. Hemi 1.15 + a weak east fill
 * (0.45, no shadow map) lift the shadows without touching exposure or the sun,
 * so contrast and depth survive. Targets (measured on re-rendered frames):
 * facade frame near-black <15%, cover <10%.
 */
export const LIGHT = {
  sunIntensity: 2.4,
  // Batch 2, Phase D (pass 5): back to Batch 1 levels (1.15/0.7). Pass 1's
  // lift (1.25/0.9) pushed the red hero car over ACES's knee — the red
  // channel clipped and desaturated to pink (proven by the diagnostic: plain
  // Standard, no clearcoat, no env was still pink). The facade gate is
  // carried by the lifted asphalt albedo, not by the light, so the light
  // reverts and the gate is re-measured.
  // F1 (L2) + kompensasi §9-G tuas (b) langkah 2: hemi 1,10 -> 1,15
  // (langkah 1 hanya memulihkan ke 16,37% — gate masih gagal).
  // F2 (§9-G tuas (b) langkah 3): hemi 1,15 -> 1,20 — gate fasad F2
  // 15,78% (>15% keras); diagnosis: jalanan berbayang F1+F3 sudah
  // 27,81% di baseline merge, gutter F2 menambah +4,03 poin; tuas (a)
  // pada gutter tidak mampu (di bayangan, albedo hanya menggeser
  // ~3 level — tidak membalik piksel <32 tanpa merusak baca gutter).
  hemiIntensity: 1.20,
  fillIntensity: 0.45,
  fillColor: '#cfe0f2',
  // F1 (L8): exposure 1,15 -> 1,20 — hanya setelah L2: total cahaya di
  // bayangan sudah turun, jadi exposure naik mengembalikan mid-tone
  // tanpa mendorong merah ke clip.
  exposure: 1.20,
};

/**
 * HUD + minimap (Phase 2). Phase 3: the wanted level is LIVE — the HUD stars
 * follow world.state.wanted, which the police system raises on crimes and lowers
 * when the player stays clean and unseen. The objective is the story thread the
 * banner and the minimap waypoint point at; missions (Phase 4) will replace it
 * with per-mission objectives.
 */
export const HUD = {
  wantedMax: 5,
  // The in-game clock starts at golden hour and runs one game minute per 2 real seconds.
  clockStartMinutes: 17 * 60 + 40,
  clockMinutesPerSecond: 0.5,
  healthMax: 100,
  // First story objective: Rio's first job ends at the marina pier.
  objective: { text: 'Reach the marina pier', x: 400, z: -6 },
};

/** Staged chase values for ?shot=cover: a real game state, scripted, not a mockup. */
export const COVER = {
  wanted: 3,
  cash: 1250,
  objective: { text: 'Lose the cops — reach the pier', x: 400, z: -6 },
  driveSeconds: 6,
};

/** Visual-only cars for the cover shot (no AI until Phase 3): police cruisers and traffic. */
export const EXTRA_CAR = {
  policeBody: 0x22303f,
  policeRoof: 0xf2ede2,
  policeLightRed: 0xff2a1e,
  policeLightBlue: 0x2a6bff,
  trafficColors: [0x9aa0a6, 0xd8c9a8, 0x5a7a9a, 0xb8b0a0],
  cabinColor: 0x2a3140,
  wheelColor: 0x14161a,
};

/**
 * Police siren glow (S0–S2, visual-only). All values here are VISUAL
 * constants — no sim parameter lives in this block. S0 (white door panels)
 * was already fixed by F4 V1 in car.js, so this block only carries S1 (lens
 * contrast) + S2 (halo + pool sprites). Opacities are tuning knobs: changing
 * them tunes the glow without touching logic. Calibration (mockup, proposal
 * §12): halo peak 120, pool peak 110, spill peak 12, lens ON add
 * (60,150,140), lens OFF x0.42 — the red/blue spill asymmetry on sunlit warm
 * surfaces (additive clipping) was accepted by the Game Director 12:58 WIB;
 * do not chase it by changing scene lighting.
 */
export const SIREN = {
  // S1 — lens contrast: ON emissive / OFF emissive / OFF diffuse colour scale.
  // Tuning 18 Nov (allowed: SIREN constants): offColorScale 0.35 -> 0.25 ->
  // 0.12. At 0.35 the OFF lens measured 100-103 lum (gate OFF <= 90); at 0.25
  // it measured 93-96 — the bulk of the OFF lens (not just its sunlit top
  // face) sits ~95, driven by the diffuse under sun 2.4 plus the phase halo
  // spilling over the bar. Slope measured: ~7 lum per 0.10 of scale, so 0.12
  // lands the OFF lens at ~83-87 — about the mockup's OFF level (71-76) —
  // while the lens stays readable as a dark lens. ON values are untouched.
  onEmissive: 2.2,
  offEmissive: 0.05,
  offColorScale: 0.12,
  // S2 — halo billboard over the light bar + pool ellipse on the asphalt.
  haloOpacity: 0.55,
  poolOpacity: 0.35,
  haloSize: 2.2,
  // Pool footprint in metres: [length along the car, width across].
  poolSize: [6.4, 4.0],
  // Distance fade (cruiser–camera): full up to fadeNear, zero at fadeFar.
  fadeNear: 40,
  fadeFar: 90,
  // Flash rate — documents the 2 Hz already in render.js flash().
  flashHz: 2,
};

/** Minimap: a 2D canvas, north-up, drawn from the city's map data. */
export const MINIMAP = {
  size: 180,
  // World bounds drawn: x -340..334, z -340..340.
  minX: -340,
  maxX: 334,
  minZ: -340,
  maxZ: 340,
};

/**
 * Traffic + pedestrians (Phase 3). Cars follow the road grid, keep their lane,
 * brake for the car ahead, and turn at intersections; pedestrians walk the
 * sidewalks and flee danger. Everything is seeded, so the same seed gives the
 * same city traffic.
 */
export const TRAFFIC = {
  count: 8,
  pedCount: 14,
  // Cruise speeds of traffic cars (m/s): slower than Rio's 34, so the player
  // can overtake — and so a chase can outrun them.
  speedMin: 8,
  speedMax: 14,
  // Lane offset from the road centre: right-hand side for the direction of travel.
  lane: 3,
  // A car ahead closer than this makes a traffic car brake.
  brakeDistance: 14,
  // A car that wants to move but sits still this long is stuck: respawn it.
  stuckSeconds: 8,
  // Pedestrians walk the sidewalk strip just outside the asphalt (road half-width
  // 6 m); they run at this speed when they flee danger.
  sidewalkOffset: 7.5,
  pedWalkMin: 1.2,
  pedWalkMax: 2,
  pedFleeSpeed: 4.5,
  // A pedestrian this close to a moving car runs away from it.
  pedFleeDistance: 9,
  pedFleeSeconds: 2,
};

/**
 * Wanted + police (Phase 3). Crimes raise the wanted level; staying clean and
 * unseen lowers it. The police chase on the road grid, ram the player's car,
 * and can LOSE the player: out of sight long enough and they search, then give
 * up — and only then does the wanted level start to decay. Escaping is always
 * possible: police top speed (30 m/s) is below Rio's (34 m/s).
 *
 * Crimes (each +1 star, per-kind cooldown so one incident is one star):
 * - hit-ped: the player's car hits a pedestrian.
 * - hit-traffic: the player's car hits a traffic car.
 * - hit-police: the player's car hits a police cruiser at over 15 m/s.
 * Stealing a car is not a crime here: Rio's red car is his own.
 */
export const POLICE = {
  // Police on the road per wanted level (index = stars): 1 star brings 1 cruiser.
  capByWanted: [0, 1, 2, 2, 3, 3],
  maxSpeed: 30,
  accel: 14,
  // A cruiser sees the player this far, and only with a clear line of sight
  // (buildings block it — hiding behind a block is real).
  sightRange: 90,
  // Out of every cruiser's sight this long: they switch to searching.
  loseSeconds: 6,
  // Searching this long without regaining sight: they give up and leave.
  searchSeconds: 12,
  // How often each cruiser re-checks line of sight (seconds of game time).
  losCheckSeconds: 0.25,
  // A ram lands this close; each cruiser waits this long between rams.
  ramDistance: 3.6,
  ramCooldown: 1.5,
  ramDamage: 5,
  // Busted: the player (car or on foot) sits still this long with a cruiser
  // this close — cash is lost and Rio respawns at the start.
  bustDistance: 8,
  bustSeconds: 3,
  // Clean time (no crime, unseen) that burns one star.
  decaySeconds: 15,
  // One incident of one kind is one star: a kind cannot fire again this soon.
  crimeCooldown: 3,
  // Cruisers spawn in this distance band from the player (metres).
  spawnMinDistance: 60,
  spawnMaxDistance: 100,
};

export const PALETTE = {
  skyTop: '#6ea8dd',
  skyHorizon: '#ffd9a0',
  // Phase 3.5 visual pass: fog is cool blue-grey now, not warm cream — the city
  // gets depth instead of drowning in a beige haze.
  fog: '#b8c8d8',
  sun: '#ffb46b',
  groundSand: '#d9b380',
  // Batch 2, Phase D: the asphalt base is lifted (was #4a4642) so the road in
  // building shadow stops rendering near-black — the facade gate. Still a
  // warm worn grey, not concrete; the speckle/crack colours in
  // makeAsphaltTexture are lifted to match.
  // F3 (S1): base goes neutral-cool #4c4e55 (was #5d5850, R-G +13) — the
  // warm base was half of the road's +20 R-G in render. The darker base
  // costs facade-gate headroom, so the gate is re-measured every pass.
  // F3 pass 2: the first S1 tile (#4c4e55, R-G -1.8) still rendered +10
  // R-G in the sunlit cover patch and pushed the facade gate to 14.24%
  // (road region 22.42%) — the tile was too warm AND too dark. Base is
  // now #505961 (R-G -9, lum ~89): colder to land the render inside
  // +/-6, lighter to give the gate back its headroom. Material lever
  // (a) of the gate protocol; the gate is re-measured after this change.
  asphalt: '#505961',
  // F3: sidewalk base goes neutral #c9bda6 (was #cfc3ab, R-G +12).
  sidewalk: '#c9bda6',
  crosswalk: '#f5efe0',
  laneDash: '#f2c94c',
  sea: '#2e7fa8',
  seaDeep: '#1f5f86',
  pierWood: '#8a6a4a',
  // Phase 3.5 visual pass: each district keeps its warm base, but gains cooler /
  // stronger entries so the three districts read apart at a glance. The accent
  // lists are picked ~22% of the time (city.js) for buildings that break the
  // beige monopoly: glass blue downtown, teal/white marina, terracotta suburb.
  // Phase 3.6 (visual pass 2): the bold colours move INTO the base lists too —
  // the reference city is ~half strong colour, not a beige city with a few
  // accents. Accent chance in city.js is now ~50%, and the base lists carry
  // glass blue, brick orange, sage green and clean white alongside the warm
  // bases, so no street reads as one beige wall.
  buildingDowntown: ['#e8dcc8', '#d9c9a8', '#5a8ab0', '#3a6a9a', '#e8e8e8', '#8fa8c0', '#c96a4a', '#6a8ab0'],
  buildingDowntownAccent: ['#2a5a8a', '#1a4a7a', '#d84a35', '#f2f6f2', '#e8a83a'],
  buildingMarina: ['#f2e6d0', '#e8cfae', '#2e8a9a', '#f2f6f2', '#d84a35', '#cfe0dc', '#e8a83a', '#9fc4c8'],
  buildingMarinaAccent: ['#1a7a8a', '#d84a35', '#f2c94c', '#2e8a9a'],
  buildingSuburb: ['#f5ead6', '#e8d5b0', '#c96a4a', '#7a9a5a', '#b85a3a', '#a8b89a', '#e8e8e8', '#d9c39a'],
  buildingSuburbAccent: ['#a84a2a', '#5a8a4a', '#c94a3a', '#3a6a9a'],
  roof: '#8a6a4a',
  roofColors: ['#8a6a4a', '#6a5a4a', '#a8a88a', '#7a6a5a', '#b85a3a', '#4a6a8a'],
  // Phase 3.6: striped-shop colours for the awnings over ground-floor doors.
  awningColors: ['#c94a3a', '#2a6a9a', '#3a7a4a', '#e8a83a', '#f2f6f2'],
  window: '#2a3547',
  // F1: unlit window panes move to the glass blue, so the Standard swap in
  // render.js reflects the sky instead of rendering near-black Lambert.
  windowGlass: '#4a6a8a',
  windowLit: '#ffd27a',
  palmTrunk: '#7a5a3a',
  palmLeaf: '#3f7a3a',
  lampPole: '#3a3f46',
  lampGlow: '#ffd27a',
  // Pedestrian shirts: a few muted colours so walkers read as different people.
  pedShirts: [0xc96a5a, 0x5a7a9a, 0x7a9a5a, 0x9a7ab8, 0xd8c9a8, 0x8a6a4a],
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Where the best drive is kept between visits (this browser only). */
export const BEST_KEY = 'solmarina.best';
