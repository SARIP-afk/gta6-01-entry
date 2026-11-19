// Combat: one pistol, three gunmen at most, and the feedback that makes a shot read
// — blood that bursts from the wound, a splatter that stays on the ground, tracers,
// and a wanted bump for firing in the street. Enemies stand their ground and trade
// shots; they never chase across the map. Pure sim: positions and numbers only.
import { WEAPON, ENEMY, BLOOD } from './config.js';

export function createCombat(random) {
  const state = {
    ammo: WEAPON.mag,
    reserve: WEAPON.reserve,
    cooldown: 0,
    reloadTimer: 0,
    reloading: false,
    enemies: [],
    shots: [], // tracers: {x0,z0,x1,z1,life}
    blood: [], // blood particles: {x,y,z,vx,vy,vz,life,maxLife}
    decals: [], // ground splatters: {x,z,life,size}
  };

  /** Red burst at the wound plus a splatter on the ground beneath it. */
  function spawnBlood(x, y, z, dirX, dirZ, big) {
    const n = big ? BLOOD.particles * 2 : BLOOD.particles;
    for (let i = 0; i < n; i += 1) {
      if (state.blood.length >= BLOOD.maxParticles) state.blood.shift();
      const a = random() * Math.PI * 2;
      const sp = 1.5 + random() * 3.5;
      state.blood.push({
        x, y, z,
        vx: Math.cos(a) * sp + dirX * 1.5,
        vy: 1 + random() * 2.5,
        vz: Math.sin(a) * sp + dirZ * 1.5,
        life: BLOOD.life * (0.7 + random() * 0.5),
        maxLife: BLOOD.life,
      });
    }
    state.decals.push({ x, z, life: BLOOD.decalLife, size: (big ? 1.6 : 1.1) + random() * 0.7 });
    if (state.decals.length > BLOOD.maxDecals) state.decals.shift();
  }

  function spawnEnemies(near) {
    state.enemies = [];
    for (let i = 0; i < 3; i += 1) {
      state.enemies.push({
        x: near.x + (random() - 0.5) * 24,
        z: near.z + (random() - 0.5) * 24,
        health: ENEMY.health,
        shootTimer: 1 + random(),
        alive: true,
        hitFlash: 0,
      });
    }
  }

  function clearEnemies() {
    state.enemies = [];
  }

  /**
   * Fire one round from (ox, oz) along `angle` (radians, world space). `hitTest` is
   * the world's callback: it answers the nearest thing the bullet meets, so combat
   * never has to know about buildings or traffic itself.
   */
  function shoot(ox, oz, angle, hitTest, events) {
    if (state.cooldown > 0 || state.reloading) return false;
    if (state.ammo <= 0) {
      reload();
      return false;
    }
    state.ammo -= 1;
    state.cooldown = WEAPON.fireInterval;
    const jitter = (random() - 0.5) * WEAPON.spread;
    const a = angle + jitter;
    const hit = hitTest(ox, oz, a, WEAPON.range);
    const ex = ox + Math.cos(a) * (hit ? hit.dist : WEAPON.range);
    const ez = oz - Math.sin(a) * (hit ? hit.dist : WEAPON.range);
    state.shots.push({ x0: ox, z0: oz, x1: ex, z1: ez, life: 0.12 });
    if (hit && hit.kind === 'enemy') {
      const e = hit.enemy;
      e.health -= WEAPON.damage;
      e.hitFlash = 0.15;
      // Blood straight out of the wound, spraying along the shot.
      spawnBlood(ox + Math.cos(a) * hit.dist, 1.4, oz - Math.sin(a) * hit.dist, Math.cos(a), -Math.sin(a), e.health <= 0);
      if (e.health <= 0) {
        e.alive = false;
        if (events) events.push({ type: 'enemy-down', reward: ENEMY.reward, x: e.x, z: e.z });
      }
    } else if (hit && hit.kind === 'ped') {
      if (events) events.push({ type: 'crime', cause: 'shots fired', wanted: 0 });
    }
    return true;
  }

  function reload() {
    if (state.reloading || state.reserve <= 0 || state.ammo === WEAPON.mag) return;
    state.reloading = true;
    state.reloadTimer = WEAPON.reloadTime;
  }

  function step(dt, player, events) {
    if (state.cooldown > 0) state.cooldown -= dt;
    if (state.reloading) {
      state.reloadTimer -= dt;
      if (state.reloadTimer <= 0) {
        const need = WEAPON.mag - state.ammo;
        const take = Math.min(need, state.reserve);
        state.ammo += take;
        state.reserve -= take;
        state.reloading = false;
      }
    }
    for (const s of state.shots) s.life -= dt;
    state.shots = state.shots.filter((s) => s.life > 0);
    // Blood flies, falls, and sticks where it lands; splatters fade out.
    for (const p of state.blood) {
      p.life -= dt;
      p.vy -= BLOOD.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.06) {
        p.y = 0.06;
        p.vx = 0;
        p.vy = 0;
        p.vz = 0;
      }
    }
    state.blood = state.blood.filter((p) => p.life > 0);
    for (const d of state.decals) d.life -= dt;
    state.decals = state.decals.filter((d) => d.life > 0);
    // Enemies trade shots while the player is in range and on their feet.
    for (const e of state.enemies) {
      if (!e.alive) continue;
      if (e.hitFlash > 0) e.hitFlash -= dt;
      e.shootTimer -= dt;
      const d = Math.hypot(player.x - e.x, player.z - e.z);
      if (e.shootTimer <= 0 && d < ENEMY.range && player.mode === 'foot') {
        e.shootTimer = ENEMY.shootInterval;
        state.shots.push({ x0: e.x, z0: e.z, x1: player.x, z1: player.z, life: 0.12 });
        if (events) events.push({ type: 'player-hit', damage: ENEMY.damage });
      }
    }
    state.enemies = state.enemies.filter((e) => e.alive || e.health > -50);
  }

  function reset() {
    state.ammo = WEAPON.mag;
    state.reserve = WEAPON.reserve;
    state.cooldown = 0;
    state.reloadTimer = 0;
    state.reloading = false;
    state.enemies = [];
    state.shots = [];
    state.blood = [];
    state.decals = [];
  }

  return { state, spawnEnemies, clearEnemies, shoot, reload, step, reset };
}
