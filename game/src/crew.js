// Rio's crew: three people on the radio, each with one ability on a key.
// The crew works over the radio — nobody walks the streets beside Rio, so an
// ability is a button with a cooldown, not a companion to pathfind, feed or
// keep alive. That keeps the system cheap (DOM only) and deterministic (every
// timer runs on the fixed step). Cooldowns shrink as rank grows: the crew
// trusts Rio more the higher he climbs. Pure sim: positions and numbers only.
export const CREW = [
  {
    id: 'sana', name: 'SANA', role: 'DRIVER', ability: 'SWAP PLATES', key: 'Z',
    cooldown: 80, needsCar: true,
    desc: 'Fresh plates — the heat clears',
  },
  {
    id: 'bex', name: 'BEX', role: 'MECHANIC', ability: 'QUICK FIX', key: 'X',
    cooldown: 55, needsCar: true,
    desc: 'Patch the car back to pristine',
  },
  {
    id: 'nia', name: 'NIA', role: 'LOOKOUT', ability: 'EYES OUT', key: 'C',
    cooldown: 70, duration: 20, needsCar: false,
    desc: 'Police marked on the map for 20 s',
  },
];

export function createCrew() {
  return {
    state: {
      cooldowns: CREW.map(() => 0),
      eyesOut: 0, // seconds of marked police left
      used: 0, // abilities fired, for the pause STATS tab
    },
  };
}

/**
 * Fire a crew ability. `api` is the world: clearWanted(), fixCar(), inCar().
 * `cooldownMult` comes from rank (1, then 0.8, then 0.6). Returns 'ok',
 * 'cooling' (with seconds left), or 'need-car'. Effects land through events
 * so the HUD feed can name them.
 */
export function useAbility(crew, index, api, events, cooldownMult) {
  const def = CREW[index];
  if (!def) return 'same';
  const st = crew.state;
  if (st.cooldowns[index] > 0) return 'cooling';
  if (def.needsCar && !api.inCar()) return 'need-car';
  if (def.id === 'sana') api.clearWanted();
  else if (def.id === 'bex') api.fixCar();
  else if (def.id === 'nia') st.eyesOut = def.duration;
  st.cooldowns[index] = def.cooldown * cooldownMult;
  st.used += 1;
  if (events) events.push({ type: 'crew', ability: def.ability, name: def.name });
  return 'ok';
}

export function stepCrew(crew, dt) {
  const st = crew.state;
  for (let i = 0; i < st.cooldowns.length; i += 1) {
    if (st.cooldowns[i] > 0) st.cooldowns[i] = Math.max(0, st.cooldowns[i] - dt);
  }
  if (st.eyesOut > 0) st.eyesOut = Math.max(0, st.eyesOut - dt);
}

export function resetCrew(crew) {
  crew.state.cooldowns = CREW.map(() => 0);
  crew.state.eyesOut = 0;
  crew.state.used = 0;
}
