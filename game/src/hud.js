// Solmarina — the DOM HUD and the square minimap, rewritten fresh.
// Panels hug the edges and stay compact; the centre of the screen stays
// clean for the game, the way the Karimbu reference frames do it.
import { MISSIONS, WEAPON_ORDER, wantedTier } from './sim.js';
import { districtAt, DISTRICTS, GRID_MIN, GRID_MAX, ROAD_STEP, ROAD_HALF, BEACH_Z, SEA_Z, PIER, MARKET, STADIUM } from './layout.js';
import { hash2 } from './util.js';

const $ = (id) => document.getElementById(id);
const STARS = '★★★★★';

export class Hud {
  constructor(world, onAction) {
    this.world = world;
    this.onAction = onAction;
    this.map = $('minimap');
    this.mapCtx = this.map.getContext('2d');
    this.bigmap = $('bigmap');
    this.bigmapCtx = this.bigmap ? this.bigmap.getContext('2d') : null;
    this.cache = {};
    this.mapTimer = 0;
    // cover-clean: for cover shots (?shot=cover / beach-hero) every DOM
    // panel is hidden so the frame is pure game, like the Top 1-3 title
    // screens. Set from main.js; gameplay and other shots never set it.
    this.coverClean = false;
    this.bindButtons();
    // K19_ HUD scale (ronde #14): --hud-s on #hud scales #hud-scale so
    // the HUD keeps reference proportions on viewports larger than the
    // 1280x720 design size. The minimap canvas backing store is resized
    // to cssSize * s so the scaled minimap stays sharp instead of an
    // upscaled 132 px bitmap. Idempotent: only touches the DOM when the
    // scale or the backing size actually changed.
    this.hudScale = 0;
    this.applyHudScale = () => {
      const s = Math.max(1, Math.min(window.innerWidth / 1280, window.innerHeight / 720));
      if (s !== this.hudScale) {
        this.hudScale = s;
        $('hud').style.setProperty('--hud-s', String(s));
      }
      const css = this.map.clientWidth || 132;
      const px = Math.max(1, Math.round(css * s));
      if (this.map.width !== px || this.map.height !== px) {
        this.map.width = px; this.map.height = px;
        this.drawMap(true);
      }
    };
    window.addEventListener('resize', this.applyHudScale);
    this.applyHudScale();
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
    // big map (pause > MAP tab): click sets a waypoint, click again clears it
    if (this.bigmap) {
      this.bigmap.addEventListener('click', (e) => {
        const r = this.bigmap.getBoundingClientRect();
        const fx = (e.clientX - r.left) / r.width, fz = (e.clientY - r.top) / r.height;
        this.onAction('waypoint', { x: GRID_MIN - 48 + fx * (432 - (GRID_MIN - 48)), z: GRID_MIN - 48 + fz * (384 - (GRID_MIN - 48)) });
        this.drawBigMap();
      });
    }
  }

  showTab(tab) {
    document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tabpage').forEach((p) => { p.style.display = p.id === `tab-${tab}` ? 'block' : 'none'; });
    if (tab === 'map') { this.drawMap(true); this.drawBigMap(); }
    if (tab === 'story') this.renderStory();
    if (tab === 'stats') this.renderStats();
  }

  setText(id, value) {
    if (this.cache[id] !== value) { this.cache[id] = value; const el = $(id); if (el) el.textContent = value; }
  }

  setWidth(id, pct) {
    // bars: only touch the DOM when the value actually changed — writing
    // style.width every frame forces a style recalc for nothing
    const v = `${Math.round(pct * 10) / 10}%`;
    if (this.cache[`w:${id}`] !== v) { this.cache[`w:${id}`] = v; const el = $(id); if (el) el.style.width = v; }
  }

  update(dt) {
    if (this.coverClean) {
      // hide everything, including the title screen (its CSS default is
      // display:flex, and the normal screen lines below never run here)
      for (const id of ['hud', 'title-screen', 'pause-screen', 'over-screen']) {
        const el = $(id);
        if (el) el.style.display = 'none';
      }
      return;
    }
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
    this.setWidth('standing-fill', standing);
    this.setWidth('health-fill', p.health);
    this.setWidth('armour-fill', p.armour);
    this.setText('health-num', String(Math.round(p.health)));
    this.setText('armour-num', String(Math.round(p.armour)));
    this.setText('ammo', p.mode === 'car' ? '—' : s.weapon === 'FISTS' ? '∞' : `${s.ammo} / ${s.reserve}`);
    // weapon slots: highlight the active weapon (FISTS/SOL-9/SMG/12G/MAR-7 = 1-5)
    const wslots = document.querySelectorAll('#weapons .wslot');
    const widx = WEAPON_ORDER.indexOf(s.weapon);
    wslots.forEach((el, i) => el.classList.toggle('active', i === widx));
    this.setText('speed', p.mode === 'car' ? String(Math.round(Math.abs(s.heroCar.speed) * 3.6)) : String(Math.round(0)));
    this.setText('speed-unit', p.mode === 'car' ? 'KM/H' : '');
    this.setText('car-name', p.mode === 'car' ? s.heroCar.model : 'ON FOOT');
    this.setText('car-damage', p.mode === 'car' ? `${Math.round(s.heroCar.damage)}% DENTED` : '');
    this.setText('rank-name', `RANK ${s.rank}`);
    this.setText('rp', `${s.rp.toLocaleString('en-US')} / ${(s.rank + 1) * 200} RP`);
    this.setWidth('rp-fill', Math.min(100, (s.rp % ((s.rank + 1) * 200)) / ((s.rank + 1) * 200) * 100));
    const m = MISSIONS[s.missions.active];
    this.setText('mission-name', `MISSION ${s.missions.active + 1} · ${m.name}`);
    this.setText('mission-stage', `STAGE ${Math.min(s.missions.stage + 1, m.stages.length)}/${m.stages.length} · ${s.objective.label.toUpperCase()}`);
    const objD = Math.hypot(s.objective.x - p.x, s.objective.z - p.z);
    this.setText('mission-dist', `${Math.round(objD)} m`);
    this.setText('mission-time', s.missions.started ? `${Math.floor(s.missions.missionTime / 60)}:${String(Math.floor(s.missions.missionTime % 60)).padStart(2, '0')}` : '');
    // waypoint line: distance + compass bearing (N = -z, E = +x)
    const wp = s.waypoint;
    if (wp) {
      const dx = wp.x - p.x, dz = wp.z - p.z;
      const ang = Math.atan2(-dz, dx);
      const dirs = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];
      const di = Math.round(((ang + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
      this.setText('waypoint-line', `◆ WAYPOINT ${Math.round(Math.hypot(dx, dz))} m ${dirs[di]}`);
    } else this.setText('waypoint-line', '');
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
    // crime feed: sits below the mission panel when CLEAR (its height
    // varies with wrapping, so measure it — a fixed top overlapped the
    // mission panel edge), below the dispatch panel when wanted
    const feed = $('feed');
    if (feed) {
      const html = s.events.slice(0, 3).map((e) => `<div>${e}</div>`).join('');
      if (this.cache.feed !== html) { this.cache.feed = html; feed.innerHTML = html; }
      if (window.innerWidth <= 700) {
        // small screens: the feed lives top-centre (see the media query),
        // so clear the inline top and let CSS place it
        feed.style.top = '';
      } else {
        const missionEl = $('mission');
        const belowMission = missionEl ? missionEl.offsetTop + missionEl.offsetHeight + 8 : 118;
        feed.style.top = `${s.wanted > 0 ? 218 : belowMission}px`;
      }
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
    if (this.mapTimer > 0.15) {
      this.mapTimer = 0;
      this.drawMap(false);
      if (this.bigmapCtx && $('pause-screen').style.display === 'flex') this.drawBigMap();
    }
    // K19_: re-read the minimap CSS size now the HUD is visible (it is
    // 0 while display:none, so the constructor falls back to 132 — on a
    // small screen the real CSS size is 84 and the backing store must
    // follow it). Cheap: applyHudScale only writes when something changed.
    this.applyHudScale();
  }

  drawMap(big) {
    // Draw in CSS px (132, or 84 on small screens) and let the canvas
    // transform scale it to the backing store, so markers and fonts
    // keep their designed proportions at any backing size.
    const css = this.map.clientWidth || 132;
    const f = this.map.width / css;
    this.drawMapOn(this.mapCtx, css, css, false, f);
  }

  drawBigMap() {
    if (!this.bigmapCtx) return;
    this.drawMapOn(this.bigmapCtx, this.bigmap.width, this.bigmap.height, true);
  }

  drawMapOn(ctx, W, H, big = false, f = 1) {
    // f scales CSS-px drawing to the canvas backing store (minimap at
    // 2x HUD scale draws a 264 px bitmap from a 132 px layout).
    ctx.save();
    if (f !== 1) ctx.setTransform(f, 0, 0, f, 0, 0);
    const s = this.world.state;
    const L = this.world.layout;
    // World window: x -336..432 (768 m), z -336..384 (720 m). Markers are
    // fixed pixel sizes on both maps; only the world scale changes.
    const kx = W / 768;
    const kz = H / 720;
    const px = (x) => (x + 336) * kx;
    const pz = (z) => (z + 336) * kz;
    // Base, then city blocks, then water/sand/plaza over them, then roads.
    ctx.fillStyle = '#20262e';
    ctx.fillRect(0, 0, W, H);
    // City blocks: the 48 m grid cells between roads, each filled with one
    // dark shade, inset ~5 m from the road lines. The shade per cell
    // (measured from reference renders; the pattern is fixed for this
    // layout) is a 12x12 table, rows southward.
    const tones = ['#38424f', '#333d4a', '#2c3440', '#28303c'];
    const cellShade = [
      [0, 1, 0, 3, 0, 3, 1, 0, 2, 2, 1, 3],
      [1, 0, 2, 3, 3, 1, 2, 3, 0, 0, 3, 3],
      [3, 1, 0, 2, 2, 3, 1, 2, 3, 3, 3, 1],
      [0, 3, 3, 3, 0, 0, 3, 0, 1, 3, 0, 3],
      [3, 0, 3, 1, 1, 3, 3, 3, 3, 0, 1, 0],
      [2, 2, 2, 3, 1, 2, 3, 2, 0, 1, 2, 0],
      [0, 2, 1, 3, 3, 1, 0, 2, 3, 1, 2, 1],
      [1, 0, 1, 1, 1, 2, 1, 2, 0, 3, 3, 2],
      [0, 1, 1, 1, 3, 2, 0, 2, 1, 0, 3, 1],
      [3, 3, 1, 3, 0, 0, 3, 0, 3, 3, 2, 3],
      [3, 0, 3, 2, 3, 3, 2, 2, 2, 3, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ];
    for (let iz = 0; iz < 12; iz++) {
      for (let ix = 0; ix < 12; ix++) {
        ctx.fillStyle = tones[cellShade[iz][ix]];
        ctx.fillRect(px(-288 + 48 * ix + 5), pz(-288 + 48 * iz + 5), 38 * kx, 38 * kz);
      }
    }
    ctx.fillStyle = '#2e7fa8';
    ctx.fillRect(px(292), pz(-90), 141 * kx, 223 * kz);
    ctx.fillRect(px(-284), pz(313), 560 * kx, 72 * kz);
    ctx.fillStyle = '#e8d5a3';
    ctx.fillRect(px(-284), pz(243), 560 * kx, 67 * kz);
    ctx.fillStyle = '#b8a88f';
    ctx.fillRect(px(-93), pz(-120), 40 * kx, 46 * kz);
    // Roads on the 48 m grid: two complementary dashed strokes — the pale
    // bed in the gaps, the darker centre line in the segments (6 px on,
    // 6 px off, bed first). Line width is 1.5 px on the minimap, 3 px on
    // the big map.
    const rw = big ? 3 : 1.5;
    ctx.lineWidth = rw;
    ctx.setLineDash([6, 6]);
    ctx.lineDashOffset = 0;
    ctx.strokeStyle = '#9ba09f';
    ctx.beginPath();
    for (let gx = -288; gx <= 336; gx += 48) {
      ctx.moveTo(px(gx), 0);
      ctx.lineTo(px(gx), H);
    }
    for (let gz = -288; gz <= 336; gz += 48) {
      ctx.moveTo(0, pz(gz));
      ctx.lineTo(W, pz(gz));
    }
    ctx.stroke();
    ctx.lineDashOffset = 6;
    ctx.strokeStyle = '#5a6472';
    ctx.beginPath();
    for (let gx = -288; gx <= 336; gx += 48) {
      ctx.moveTo(px(gx), 0);
      ctx.lineTo(px(gx), H);
    }
    for (let gz = -288; gz <= 336; gz += 48) {
      ctx.moveTo(0, pz(gz));
      ctx.lineTo(W, pz(gz));
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // Stadium bowl: salmon disc. Marina beacon: small cyan square.
    ctx.fillStyle = '#f28482';
    ctx.beginPath();
    ctx.arc(px(-194), pz(141), 26 * kx, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4fc3f7';
    ctx.fillRect(px(380) - 3, pz(21) - 3, 6, 6);
    // Mission objective: gold diamond with a block tail underneath.
    if (s.objective) {
      const ox = px(s.objective.x);
      const oy = pz(s.objective.z);
      ctx.fillStyle = '#f2c94c';
      ctx.beginPath();
      ctx.moveTo(ox, oy - 6);
      ctx.lineTo(ox + 5.5, oy);
      ctx.lineTo(ox, oy + 6);
      ctx.lineTo(ox - 5.5, oy);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(ox - 3, oy + 5, 6, 4);
    }
    // Gold van: hollow gold square.
    if (s.van) {
      ctx.strokeStyle = '#d4af37';
      ctx.lineWidth = 2;
      ctx.strokeRect(px(s.van.x) - 5, pz(s.van.z) - 5, 10, 10);
    }
    // Waypoint: cyan ring with a filled diamond inside.
    if (s.waypoint) {
      const wx = px(s.waypoint.x);
      const wy = pz(s.waypoint.z);
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(wx, wy, 9.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#22d3ee';
      ctx.beginPath();
      ctx.moveTo(wx, wy - 5.5);
      ctx.lineTo(wx + 5.5, wy);
      ctx.lineTo(wx, wy + 5.5);
      ctx.lineTo(wx - 5.5, wy);
      ctx.closePath();
      ctx.fill();
    }
    // Police: small red dots. Roadblock: white-edged orange square.
    ctx.fillStyle = '#dc3c3c';
    for (const p of s.police) {
      ctx.beginPath();
      ctx.arc(px(p.x), pz(p.z), 3, 0, Math.PI * 2);
      ctx.fill();
    }
    if (s.roadblock) {
      const rx = px(s.roadblock.x);
      const ry = pz(s.roadblock.z);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(rx - 5.5, ry - 5.5, 11, 11);
      ctx.fillStyle = '#ff8c00';
      ctx.fillRect(rx - 4, ry - 4, 8, 8);
    }
    // Player arrow: white triangle, tip along the heading
    // (heading 0 = east, PI/2 = north, so the map angle is -heading).
    {
      const ax = px(s.player.x);
      const ay = pz(s.player.z);
      const hd = s.player.heading || 0;
      const dx = Math.cos(hd);
      const dy = -Math.sin(hd);
      const qx = Math.sin(hd);
      const qy = Math.cos(hd);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(ax + 5 * dx, ay + 5 * dy);
      ctx.lineTo(ax - 4 * dx + 3.5 * qx, ay - 4 * dy + 3.5 * qy);
      ctx.lineTo(ax - 4 * dx - 3.5 * qx, ay - 4 * dy - 3.5 * qy);
      ctx.closePath();
      ctx.fill();
    }
    // District labels, big map only, then the north tick on both sizes.
    if (big) {
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tags = [
        ['NORTHGATE', 0, -271, '#8ecae6'],
        ['OLD HARBOR', -216, -151, '#e07a5f'],
        ['DOWNTOWN', -49, -147, '#f2c94c'],
        ['MARINA', 360, 19, '#4fc3f7'],
        ['FOUNDRY', 158, 65, '#b08968'],
        ['STADIUM ROW', -192, 113, '#e07a5f'],
        ['PALM BEACH', 40, 285, '#90be6d'],
      ];
      for (const [name, wx, wz, col] of tags) {
        ctx.fillStyle = col;
        ctx.fillText(name, px(wx), pz(wz));
      }
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', 7, 9);
    ctx.restore();
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
