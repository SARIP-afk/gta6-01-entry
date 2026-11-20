// Solmarina (fresh build) — the DOM HUD and the square minimap.
// Panels hug the edges and stay compact; the centre of the screen stays
// clean for the game, the way the Karimbu reference frames do it.
import { MISSIONS, wantedTier } from './sim.js';
import { districtAt, GRID_MIN, GRID_MAX, ROAD_STEP, BEACH_Z, SEA_Z, PIER, MARKET, STADIUM } from './layout.js';

const $ = (id) => document.getElementById(id);
const STARS = '★★★★★';

export class Hud {
  constructor(world, onAction) {
    this.world = world;
    this.onAction = onAction;
    this.map = $('minimap');
    this.mapCtx = this.map.getContext('2d');
    this.cache = {};
    this.mapTimer = 0;
    this.bindButtons();
    this.drawMap(true);
  }

  bindButtons() {
    const bind = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
    bind('btn-start', () => this.onAction('start'));
    bind('btn-continue', () => this.onAction('start'));
    bind('btn-resume', () => this.onAction('resume'));
    bind('btn-quit-title', () => this.onAction('quit-title'));
    bind('btn-quit-title2', () => this.onAction('quit-title'));
    bind('btn-restart', () => this.onAction('restart'));
    document.querySelectorAll('[data-tab]').forEach((b) => {
      b.addEventListener('click', () => this.showTab(b.dataset.tab));
    });
    document.querySelectorAll('[data-save]').forEach((b) => {
      b.addEventListener('click', () => this.onAction('save', Number(b.dataset.save)));
    });
    document.querySelectorAll('[data-load]').forEach((b) => {
      b.addEventListener('click', () => this.onAction('load', Number(b.dataset.load)));
    });
    document.querySelectorAll('[data-station]').forEach((b) => {
      b.addEventListener('click', () => this.onAction('station', Number(b.dataset.station)));
    });
    $('minimap').addEventListener('click', (e) => {
      const r = $('minimap').getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width, fz = (e.clientY - r.top) / r.height;
      this.onAction('map-click', { x: GRID_MIN - 48 + fx * (432 - (GRID_MIN - 48)), z: GRID_MIN - 48 + fz * (384 - (GRID_MIN - 48)) });
    });
  }

  showTab(tab) {
    document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tabpage').forEach((p) => { p.style.display = p.id === `tab-${tab}` ? 'block' : 'none'; });
    if (tab === 'map') this.drawMap(true);
    if (tab === 'story') this.renderStory();
    if (tab === 'stats') this.renderStats();
  }

  setText(id, value) {
    if (this.cache[id] !== value) { this.cache[id] = value; const el = $(id); if (el) el.textContent = value; }
  }

  update(dt) {
    const s = this.world.state;
    const p = s.player;
    const hour = Math.floor(s.hour), min = Math.floor((s.hour % 1) * 60);
    this.setText('clock', `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
    this.setText('cash', `$${s.cash.toLocaleString('en-US')}`);
    this.setText('stars', STARS.slice(0, s.wanted) + '☆'.repeat(5 - s.wanted));
    $('stars').style.color = s.wanted === 0 ? '#9aa5b1' : s.wanted >= 4 ? '#ff3b30' : '#ffb347';
    this.setText('wanted-label', s.wanted === 0 ? '' : `${wantedTier(s.wanted)} · ${s.police.length} UNIT${s.police.length === 1 ? '' : 'S'} RESPONDING`);
    const d = districtAt(p.x, p.z);
    this.setText('district', d.name);
    this.setText('district-tag', d.tag);
    const standing = s.standing[d.name] ?? 58;
    this.setText('standing', `${standing >= 70 ? 'FRIENDLY' : standing >= 40 ? 'NEUTRAL' : 'HOSTILE'} · ${standing}`);
    $('standing-fill').style.width = `${standing}%`;
    $('health-fill').style.width = `${p.health}%`;
    $('armour-fill').style.width = `${p.armour}%`;
    this.setText('health-num', String(Math.round(p.health)));
    this.setText('armour-num', String(Math.round(p.armour)));
    this.setText('ammo', p.mode === 'car' ? '—' : `${s.ammo} / ${s.reserve}`);
    this.setText('speed', p.mode === 'car' ? String(Math.round(Math.abs(s.heroCar.speed) * 3.6)) : String(Math.round(0)));
    this.setText('speed-unit', p.mode === 'car' ? 'KM/H' : '');
    this.setText('car-name', p.mode === 'car' ? s.heroCar.model : 'ON FOOT');
    this.setText('car-damage', p.mode === 'car' ? `${Math.round(s.heroCar.damage)}% DENTED` : '');
    this.setText('rank-name', `RANK ${s.rank}`);
    this.setText('rp', `${s.rp.toLocaleString('en-US')} / ${(s.rank + 1) * 200} RP`);
    $('rp-fill').style.width = `${Math.min(100, (s.rp % ((s.rank + 1) * 200)) / ((s.rank + 1) * 200) * 100)}%`;
    const m = MISSIONS[s.missions.active];
    this.setText('mission-name', `MISSION ${s.missions.active + 1} · ${m.name}`);
    this.setText('mission-stage', `STAGE ${Math.min(s.missions.stage + 1, m.stages.length)}/${m.stages.length} · ${s.objective.label.toUpperCase()}`);
    const objD = Math.hypot(s.objective.x - p.x, s.objective.z - p.z);
    this.setText('mission-dist', `${Math.round(objD)} m`);
    this.setText('mission-time', s.missions.started ? `${Math.floor(s.missions.missionTime / 60)}:${String(Math.floor(s.missions.missionTime % 60)).padStart(2, '0')}` : '');
    // dispatch panel
    const disp = $('dispatch');
    if (disp) {
      const rows = s.police.slice(0, 4).map((pc, i) => {
        const dd = Math.hypot(pc.x - p.x, pc.z - p.z);
        return `<div class="drow"><span class="unit">KPD-${100 + i}</span><span>${dd < 60 ? 'IN PURSUIT' : 'RESPONDING'}</span><span class="dist">${Math.round(dd)} m</span></div>`;
      }).join('');
      const html = s.wanted > 0 ? `<div class="dhead">KPD RESPONSE · ${s.police.length} UNITS</div>${rows}` : '';
      if (this.cache.dispatch !== html) { this.cache.dispatch = html; disp.innerHTML = html; disp.style.display = html ? 'block' : 'none'; }
    }
    // crime feed
    const feed = $('feed');
    if (feed) {
      const html = s.events.slice(0, 3).map((e) => `<div>${e}</div>`).join('');
      if (this.cache.feed !== html) { this.cache.feed = html; feed.innerHTML = html; }
      feed.style.top = `${s.wanted > 0 ? 218 : 118}px`;
    }
    // dialog
    const dlg = $('dialog');
    if (dlg) {
      const show = s.missions.dialog && s.missions.dialogTimer > 0;
      dlg.style.display = show ? 'flex' : 'none';
      if (show) {
        this.setText('dialog-speaker', s.missions.dialog.speaker);
        this.setText('dialog-line', s.missions.dialog.line);
      }
    }
    // crew cooldowns
    this.setText('crew-mira', s.crew.mira > 0 ? `${Math.ceil(s.crew.mira)}s` : 'READY');
    this.setText('crew-lio', s.crew.lio > 0 ? `${Math.ceil(s.crew.lio)}s` : 'READY');
    this.setText('crew-kiki', s.crew.kiki > 0 ? `${Math.ceil(s.crew.kiki)}s` : 'READY');
    // shells
    this.setText('shells', `${s.shellsFound}/20 SHELLS`);
    // screens
    $('title-screen').style.display = s.screen === 'title' ? 'flex' : 'none';
    $('pause-screen').style.display = s.screen === 'pause' ? 'flex' : 'none';
    $('over-screen').style.display = s.screen === 'over' ? 'flex' : 'none';
    $('hud').style.display = s.screen === 'play' ? 'block' : 'none';
    if (s.screen === 'over') {
      this.setText('over-title', s.won ? 'WHEELMAN' : 'BUSTED');
      this.setText('over-sub', s.won ? 'All four jobs done. Solmarina is yours.' : 'The KPD got you. The city keeps your cash — half of it, anyway.');
    }
    this.mapTimer += dt;
    if (this.mapTimer > 0.15) { this.mapTimer = 0; this.drawMap(false); }
  }

  drawMap(big) {
    const ctx = this.mapCtx;
    const W = this.map.width, H = this.map.height;
    const x0 = GRID_MIN - 48, x1 = 432, z0 = GRID_MIN - 48, z1 = 384;
    const px = (x) => ((x - x0) / (x1 - x0)) * W;
    const pz = (z) => ((z - z0) / (z1 - z0)) * H;
    ctx.fillStyle = '#20262e';
    ctx.fillRect(0, 0, W, H);
    // districts
    ctx.fillStyle = '#2c3440';
    ctx.fillRect(px(-288), pz(-288), px(288) - px(-288), pz(240) - pz(-288));
    ctx.fillStyle = '#e8d5a3';
    ctx.fillRect(px(-288), pz(BEACH_Z), px(288) - px(-288), pz(SEA_Z) - pz(BEACH_Z));
    ctx.fillStyle = '#2e7fa8';
    ctx.fillRect(px(-288), pz(SEA_Z), px(288) - px(-288), pz(384) - pz(SEA_Z));
    // roads
    ctx.strokeStyle = '#5a6472';
    ctx.lineWidth = 1.5;
    for (let v = GRID_MIN; v <= GRID_MAX; v += ROAD_STEP) {
      ctx.beginPath(); ctx.moveTo(px(v), 0); ctx.lineTo(px(v), H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, pz(v)); ctx.lineTo(W, pz(v)); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(px(288), pz(24)); ctx.lineTo(px(PIER.x), pz(24)); ctx.stroke();
    // market + stadium + pier markers
    ctx.fillStyle = '#f2c94c';
    ctx.fillRect(px(MARKET.x) - 3, pz(MARKET.z) - 3, 6, 6);
    ctx.fillStyle = '#f28482';
    ctx.beginPath(); ctx.arc(px(STADIUM.x), pz(STADIUM.z), 4, 0, 7); ctx.fill();
    ctx.fillStyle = '#4fc3f7';
    ctx.fillRect(px(PIER.x) - 3, pz(PIER.z) - 3, 6, 6);
    const s = this.world.state;
    // police dots
    ctx.fillStyle = '#ff3b30';
    for (const pc of s.police) { ctx.beginPath(); ctx.arc(px(pc.x), pz(pc.z), 2.5, 0, 7); ctx.fill(); }
    // van ring
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px(s.van.x), pz(s.van.z), 5, 0, 7); ctx.stroke();
    // objective diamond
    const ox = px(s.objective.x), oz = pz(s.objective.z);
    ctx.fillStyle = '#f2c94c';
    ctx.beginPath();
    ctx.moveTo(ox, oz - 6); ctx.lineTo(ox + 5, oz); ctx.lineTo(ox, oz + 6); ctx.lineTo(ox - 5, oz);
    ctx.closePath(); ctx.fill();
    // player arrow
    const p = s.player;
    ctx.fillStyle = '#fff';
    ctx.save();
    ctx.translate(px(p.x), pz(p.z));
    ctx.rotate(-p.heading);
    ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px system-ui';
    ctx.fillText('N', 4, 12);
  }

  renderStory() {
    const s = this.world.state;
    const el = $('story-list');
    if (!el) return;
    el.innerHTML = MISSIONS.map((m, i) => {
      const done = s.missions.done[i];
      const cur = s.missions.active === i && s.missions.started;
      return `<div class="story-row ${done ? 'done' : ''} ${cur ? 'cur' : ''}">
        <b>M${i + 1} · ${m.name}</b><span>${done ? 'DONE' : cur ? 'IN PROGRESS' : 'LOCKED'}</span>
        <i>$${m.reward} · par ${Math.floor(m.par / 60)}:${String(m.par % 60).padStart(2, '0')}</i></div>`;
    }).join('');
  }

  renderStats() {
    const s = this.world.state;
    const el = $('stats-list');
    if (!el) return;
    const rows = [
      ['Cash', `$${s.cash.toLocaleString('en-US')}`],
      ['Rank', `${s.rank} · ${s.rp.toLocaleString('en-US')} RP`],
      ['Missions done', `${s.missions.done.filter(Boolean).length} / 4`],
      ['Distance driven', `${(s.distanceDriven / 1000).toFixed(1)} km`],
      ['Cars stolen', String(s.carsStolen)],
      ['Shots fired', String(s.shotsFired)],
      ['Shells', `${s.shellsFound} / 20`],
      ['Exports', `${s.exportsDone} / 5`],
      ['Time played', `${Math.floor(s.time / 60)}:${String(Math.floor(s.time % 60)).padStart(2, '0')}`],
    ];
    el.innerHTML = rows.map(([k, v]) => `<div class="stat-row"><span>${k}</span><b>${v}</b></div>`).join('');
  }
}
