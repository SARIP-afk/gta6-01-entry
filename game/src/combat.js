// Combat: one pistol, three gunmen at most, and the feedback that makes a shot read
// — damage numbers that float up, health bars over enemies, tracers, and a wanted
// bump for firing in the street. Enemies stand their ground and trade shots; they
// never chase across the map. Pure sim: positions and numbers only.
import { WEAPON, ENEMY } from './config.js';

export function createCombat(random) {
  const state = {
    ammo: WEAPON.mag,
    reserve: WEAPON.reserve,
    cooldown: 0,
    reloadTimer: 0,
    reloading: false,
    enemies: [],
    shots: [], // tracers: {x0,z0,x1,z1,life}
    numbers: [], // damage numbers: {x,z,y,value,life}
  };

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
      state.numbers.push({ x: e.x, z: e.z, y: 2.2, value: WEAPON.damage, life: 0.9 });
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
    for (const n of state.numbers) {
      n.life -= dt;
      n.y += dt * 1.4;
    }
    state.numbers = state.numbers.filter((n) => n.life > 0);
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
    state.numbers = [];
  }

  return { state, spawnEnemies, clearEnemies, shoot, reload, step, reset };
}
