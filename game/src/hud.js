// The HUD: every DOM panel the player reads. Panels hug the edges and stay
// small, so the middle of the screen is the city, not the interface: mission
// banner top-centre, cash and clock top-right, weapon slots and crew
// mid-right, speed bottom-right, minimap and health bottom-left, dialog
// bottom-centre. The pause menu is seven tabs (MAP / STORY / STATS / CREW /
// SETTINGS / CONTROLS / SAVE) and the minimap opens a full-city map overlay.
// All of it is DOM, so it costs zero draw calls.
import { CITY, DISTRICTS, MISSIONS, WANTED_TIERS, CAR_MODELS } from './config.js';
import { WEAPONS } from './weapons.js';
import { CREW } from './crew.js';
import { RANKS, rankProgress } from './rank.js';
import { formatClock, phaseAt } from './daynight.js';

const TABS = ['map', 'story', 'stats', 'crew', 'settings', 'controls', 'save'];

function el(id) {
  return document.getElementById(id);
}

function drawPortrait(canvas, speaker) {
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, 72, 72);
  g.fillStyle = speaker === 'DANTE' ? '#2c313a' : '#5a3a4a';
  g.fillRect(0, 0, 72, 72);
  // Face.
  g.fillStyle = '#d9a986';
  g.beginPath();
  g.arc(36, 38, 20, 0, Math.PI * 2);
  g.fill();
  // Hair.
  g.fillStyle = speaker === 'DANTE' ? '#1d1a16' : '#3a2418';
  if (speaker === 'DANTE') {
    g.fillRect(16, 14, 40, 12);
    g.fillRect(14, 40, 8, 18); // sideburn
    g.fillRect(50, 40, 8, 18);
    g.fillStyle = '#1d1a16';
    g.fillRect(24, 52, 24, 6); // beard
  } else {
    g.fillRect(14, 10, 44, 30);
    g.fillRect(14, 30, 8, 34);
    g.fillRect(50, 30, 8, 34);
  }
  // Eyes.
  g.fillStyle = '#14181d';
  g.fillRect(26, 36, 5, 3);
  g.fillRect(41, 36, 5, 3);
  // Shoulders.
  g.fillStyle = speaker === 'DANTE' ? '#3a4a3a' : '#7a4a5a';
  g.fillRect(10, 60, 52, 12);
}

export function createHud(callbacks) {
  const minimap = el('minimap');
  const mm = minimap.getContext('2d');
  const bigmap = el('bigmap');
  const bm = bigmap ? bigmap.getContext('2d') : null;
  const fullmap = el('bigmap-full');
  const fm = fullmap ? fullmap.getContext('2d') : null;
  const feedLines = [];
  let feedTimer = 0;
  let resultsTimer = 0;
  let waypoint = null; // {x, z} set by clicking the big map; display only
  let pauseTab = 'map';
  let settings = { volume: 0.7, quality: 'high' };

  // The city map: the sea is blue, every district is a solid
  // block in its own colour with a dark border, the streets are bright cream
  // lines on top, and the pier reaches into the sea on the east edge — so the
  // first glance reads as a coastal city, not a grid on black. The same
  // renderer paints the 110 px minimap, the 360 px stats map, the 560 px
  // pause map and the 640 px full map; only the label size changes.
  // Rendering only: districtAt / standing / waypoint logic is untouched.
  function drawMap(ctx, size, state, big) {
    const span = 760;
    const s = size / span;
    const toX = (x) => (x + span / 2) * s;
    const toZ = (z) => (z + span / 2) * s;
    ctx.clearRect(0, 0, size, size);
    // Sea first: everything off the landmass is water.
    ctx.fillStyle = '#17617f';
    ctx.fillRect(0, 0, size, size);
    // Land: the road grid plus the marina strip east of it.
    ctx.fillStyle = '#3a4a38';
    ctx.fillRect(toX(-312), toZ(-312), 624 * s, 624 * s);
    ctx.fillRect(toX(208), toZ(-104), 212 * s, 208 * s);
    // District blocks, each in its own colour — MARINA last, so it wins its
    // overlap with FOUNDRY the way districtDisplayAt says it should.
    for (const d of DISTRICTS) {
      ctx.fillStyle = d.color;
      ctx.globalAlpha = big ? 0.88 : 0.72;
      ctx.fillRect(toX(d.x0), toZ(d.z0), (d.x1 - d.x0) * s, (d.z1 - d.z0) * s);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(16, 22, 28, 0.75)';
      ctx.lineWidth = big ? 2 : 1;
      ctx.strokeRect(toX(d.x0), toZ(d.z0), (d.x1 - d.x0) * s, (d.z1 - d.z0) * s);
    }
    // Roads: bright cream lines on the coloured blocks. The avenue (z=0), the
    // coastal road (x=312) and the downtown cross street (x=0) are the main
    // roads — thicker, so the skeleton of the city reads at a glance.
    const mainRoad = (r) => r === 0 || r === CITY.gridMax;
    for (const r of state.city.roads) {
      ctx.strokeStyle = 'rgba(255, 246, 220, 0.92)';
      ctx.lineWidth = big ? (mainRoad(r) ? 4.5 : 2.5) : (mainRoad(r) ? 2.5 : 1.5);
      ctx.beginPath();
      ctx.moveTo(toX(r), 0);
      ctx.lineTo(toX(r), size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, toZ(r));
      ctx.lineTo(size, toZ(r));
      ctx.stroke();
    }
    // Causeway + pier deck: a bold gold route out to sea, with the deck drawn
    // as a plank so the pier reads as a place, not a line.
    ctx.fillStyle = '#8a6a3a';
    ctx.fillRect(toX(CITY.gridMax), toZ(-12), (CITY.pier.x - CITY.gridMax) * s, 12 * s);
    ctx.strokeStyle = '#f2c94c';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(toX(CITY.gridMax), toZ(-6));
    ctx.lineTo(toX(CITY.pier.x), toZ(-6));
    ctx.stroke();
    // Shells.
    ctx.fillStyle = '#f2c94c';
    for (const sh of state.city.shells) {
      if (!sh.taken) ctx.fillRect(toX(sh.x) - 1, toZ(sh.z) - 1, 2, 2);
    }
    // Player position, needed by the route line and the arrow below.
    const px = state.player.mode === 'car' ? state.heroCar.x : state.player.x;
    const pz = state.player.mode === 'car' ? state.heroCar.z : state.player.z;
    // Waypoint the player set by clicking the big map: a dashed gold route
    // from the player to the flag, so the line reads as a route, not a dot.
    if (waypoint) {
      ctx.strokeStyle = '#f2c94c';
      ctx.lineWidth = big ? 3 : 2;
      ctx.setLineDash([big ? 10 : 6, big ? 7 : 4]);
      ctx.beginPath();
      ctx.moveTo(toX(px), toZ(pz));
      ctx.lineTo(toX(waypoint.x), toZ(waypoint.z));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#f2c94c';
      ctx.beginPath();
      ctx.arc(toX(waypoint.x), toZ(waypoint.z), big ? 6 : 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1d2733';
      ctx.lineWidth = big ? 2 : 1.5;
      ctx.beginPath();
      ctx.arc(toX(waypoint.x), toZ(waypoint.z), big ? 11 : 7, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Objective diamond, with a dark outline so it reads on gold DOWNTOWN.
    const o = state.objective;
    if (o && o.dist > 0.1) {
      ctx.save();
      ctx.translate(toX(o.x), toZ(o.z));
      ctx.rotate(Math.PI / 4);
      const r = big ? 8 : 5;
      ctx.fillStyle = '#f2c94c';
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.strokeStyle = '#1d2733';
      ctx.lineWidth = 2;
      ctx.strokeRect(-r, -r, r * 2, r * 2);
      ctx.restore();
      // Mission letter on the diamond: which job the gold target belongs to.
      // Above-right of the diamond, so it never sits on the landmark label
      // below the target (STADIUM, when the target is the stadium).
      const cur = state.missions && state.missions.current ? state.missions.current() : null;
      if (cur && big) {
        ctx.fillStyle = '#f2c94c';
        ctx.font = `900 ${Math.max(11, Math.round(size / 34))}px system-ui, sans-serif`;
        ctx.textAlign = 'left';
        ctx.strokeStyle = 'rgba(16, 22, 28, 0.95)';
        ctx.lineWidth = 3;
        const lx = toX(o.x) + 12;
        const ly = toZ(o.z) - 12;
        ctx.strokeText(cur.id, lx, ly);
        ctx.fillText(cur.id, lx, ly);
      }
    }
    // Police blips — dark outline, so red reads on pink STADIUM ROW too.
    const eyes = state.crew.state.eyesOut > 0;
    for (const u of state.police.units) {
      ctx.beginPath();
      ctx.arc(toX(u.x), toZ(u.z), big ? (eyes ? 6 : 4) : (eyes ? 4 : 2.5), 0, Math.PI * 2);
      ctx.fillStyle = '#ff4a4a';
      ctx.fill();
      ctx.strokeStyle = 'rgba(16, 22, 28, 0.9)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // Helicopter ring, when air support is up.
    if (state.heli && state.heli.state.active) {
      ctx.strokeStyle = '#ff4a4a';
      ctx.lineWidth = big ? 3 : 2;
      ctx.beginPath();
      ctx.arc(toX(state.heli.state.x), toZ(state.heli.state.z), big ? 8 : 5, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Gold van ring.
    const van = state.traffic.van();
    if (van) {
      ctx.strokeStyle = '#f2c94c';
      ctx.lineWidth = big ? 3 : 2;
      ctx.beginPath();
      ctx.arc(toX(van.x), toZ(van.z), big ? 9 : 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Player arrow: gold, big, dark outline — the eye lands on it first.
    const heading = state.player.mode === 'car' ? state.heroCar.heading : state.player.heading;
    const arrow = big ? 12 : 8;
    ctx.save();
    ctx.translate(toX(px), toZ(pz));
    ctx.rotate(-heading);
    ctx.beginPath();
    ctx.moveTo(arrow, 0);
    ctx.lineTo(-arrow * 0.75, -arrow * 0.75);
    ctx.lineTo(-arrow * 0.75, arrow * 0.75);
    ctx.closePath();
    ctx.fillStyle = '#f2c94c';
    ctx.fill();
    ctx.strokeStyle = '#1d2733';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    // District labels on the small map too — the three a player navigates by.
    // Clamped inside the frame so MARINA, half off the east edge, still reads.
    // Dark outline under the white text, so the letters survive the bright grid.
    if (!big) {
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.font = 'bold 9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(16,22,28,0.95)';
      ctx.lineWidth = 3;
      for (const name of ['DOWNTOWN', 'MARINA', 'PALM BEACH']) {
        const d = DISTRICTS.find((dd) => dd.name === name);
        const cx = (d.x0 + d.x1) / 2;
        const cz = (d.z0 + d.z1) / 2;
        const lx = Math.max(24, Math.min(size - 26, toX(cx)));
        const ly = toZ(cz);
        ctx.strokeText(name, lx, ly);
        ctx.fillText(name, lx, ly);
      }
    }
    // District names on the big maps, so they read as a city, not a grid.
    // Labels are clamped inside the frame and skipped when they would collide
    // with a label already placed. Two anchors are shifted off their district
    // centre so the name clears the landmark drawn there: DOWNTOWN clears the
    // night-market row, MARINA clears the pier label. The standing line only
    // shows on the 560/640 maps — on the 360 stats map the names alone fit,
    // and the extra line is what used to collide OLD HARBOR into DOWNTOWN.
    if (big) {
      const fs = Math.max(12, Math.min(22, Math.round(size / 30)));
      const showStanding = size >= 500;
      ctx.textAlign = 'center';
      const placed = [];
      const label = (text, lx, ly, font, fill) => {
        ctx.font = font;
        const w = ctx.measureText(text).width + 8;
        // Clamp inside the frame: a label centred half off the east edge
        // (THE PIER) would otherwise render cut off.
        lx = Math.max(w / 2 + 4, Math.min(size - w / 2 - 4, lx));
        // Collision box follows the glyph ink (cap height above the baseline,
        // a quarter em below), not the full em: OLD HARBOR and DOWNTOWN sit
        // 14 px apart on the 360 map with a 12 px font, and full-em boxes
        // overlap by a hairline and drop OLD HARBOR entirely.
        const box = { x0: lx - w / 2, x1: lx + w / 2, y0: ly - fs * 0.75, y1: ly + fs * 0.25 };
        if (placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) return false;
        placed.push(box);
        ctx.strokeStyle = 'rgba(16,22,28,0.95)';
        ctx.lineWidth = 4;
        ctx.strokeText(text, lx, ly);
        ctx.fillStyle = fill;
        ctx.fillText(text, lx, ly);
        return true;
      };
      const anchor = { DOWNTOWN: [0, -30], MARINA: [0, -50] };
      const order = ['DOWNTOWN', 'MARINA', 'PALM BEACH', 'NORTHGATE', 'FOUNDRY', 'STADIUM ROW', 'OLD HARBOR'];
      for (const name of order) {
        const d = DISTRICTS.find((dd) => dd.name === name);
        if (!d) continue;
        const off = anchor[name] || [0, 0];
        const cx = (d.x0 + d.x1) / 2 + off[0];
        const cz = (d.z0 + d.z1) / 2 + off[1];
        const lx = Math.max(60, Math.min(size - 60, toX(cx)));
        const ly = toZ(cz);
        if (!label(name, lx, ly, `bold ${fs}px system-ui, sans-serif`, 'rgba(255,255,255,0.95)')) continue;
        if (showStanding) {
          const st = state.standing[DISTRICTS.indexOf(d)];
          const sub = st >= 60 ? `FRIENDLY ${st}` : st >= 40 ? `NEUTRAL ${st}` : `WARY ${st}`;
          ctx.font = `${Math.max(10, fs - 4)}px system-ui, sans-serif`;
          ctx.fillStyle = 'rgba(242,201,76,0.95)';
          ctx.strokeStyle = 'rgba(16,22,28,0.95)';
          ctx.lineWidth = 3;
          ctx.strokeText(sub, lx, ly + fs + 2);
          ctx.fillText(sub, lx, ly + fs + 2);
        }
      }
      // Landmark labels, smaller, placed after the district names so they
      // never push a district name out — a dropped landmark label is fine.
      const lfs = Math.max(10, fs - 5);
      label('STADIUM', toX(CITY.stadium.x), toZ(CITY.stadium.z) + 30 * s + lfs, `bold ${lfs}px system-ui, sans-serif`, 'rgba(255,255,255,0.9)');
      label('NIGHT MARKET', toX(-58), toZ(-120), `bold ${lfs}px system-ui, sans-serif`, 'rgba(255,255,255,0.9)');
      label('THE PIER', toX(372), toZ(26), `bold ${lfs}px system-ui, sans-serif`, 'rgba(255,255,255,0.9)');
    }
    // Landmark icons on the big maps: the stadium bowl and the market stalls.
    if (big) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2;
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.ellipse(toX(CITY.stadium.x), toZ(CITY.stadium.z), 16 * s, 11 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#f2c94c';
      for (const mx of [-104, -88, -72, -56, -40, -24]) {
        ctx.fillRect(toX(mx) - 3, toZ(-150) - 3, 6, 6);
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `bold ${big ? 14 : 10}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(16,22,28,0.95)';
    ctx.lineWidth = 3;
    ctx.strokeText('N', size / 2, big ? 16 : 11);
    ctx.fillText('N', size / 2, big ? 16 : 11);
  }

  function pushFeed(text) {
    feedLines.unshift(text);
    if (feedLines.length > 3) feedLines.pop();
    feedTimer = 6;
    el('crimefeed').innerHTML = feedLines.map((l) => `<div>${l}</div>`).join('');
  }

  function showResults(text, sub) {
    el('results-title').textContent = text;
    el('results-sub').textContent = sub;
    el('results').style.display = 'block';
    resultsTimer = 5;
  }

  function update(state, screen, ledger, project, time) {
    const s = state;
    const p = s.player;
    const wanted = s.police.state.wanted;
    const tier = WANTED_TIERS[wanted];

    // Banner: mission name, stage text, distance or timer — one slim bar.
    // Hidden while paused: the pause overlay has its own title at the same
    // spot, and the two centred headings collided on the STATS screenshot.
    el('banner').style.display = screen === 'paused' ? 'none' : '';
    const m = s.missions.current();
    const obj = s.objective;
    if (m) {
      const stage = s.missions.currentStage();
      el('banner-line1').textContent = `${m.id} · ${m.name}`;
      let line2 = stage ? stage.text : '';
      if (stage && stage.timeLimit !== undefined) {
        const left = Math.max(0, stage.timeLimit - s.missions.state.stageTime);
        line2 += ` — ${String(Math.floor(left / 60)).padStart(2, '0')}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
      } else if (obj.dist > 0.1) {
        line2 += ` — ${Math.round(obj.dist)} M`;
      }
      if (stage && stage.footOnly && p.mode !== 'foot') line2 += ' — GET OUT AND WALK';
      el('banner-line2').textContent = line2;
    } else {
      el('banner-line1').textContent = 'SOLMARINA — FREE ROAM';
      el('banner-line2').textContent = `Completion ${s.completionPct}% · Missions ${s.missions.state.completed.length}/4`;
    }

    // Wanted stars + tier, top right under the cash.
    el('wanted-stars').textContent = '★'.repeat(wanted) + '☆'.repeat(5 - wanted);
    el('wanted-tier').textContent = tier.label;
    el('wanted').style.display = wanted > 0 ? 'block' : 'none';

    el('cash').textContent = `$${s.cash.toLocaleString('en-US')}`;
    el('health-fill').style.width = `${Math.max(0, p.health)}%`;
    el('health-num').textContent = `${Math.round(p.health)}`;
    // Rank: number, name and XP to the next rung — one line, no wrap.
    const rp = rankProgress(s.rank);
    el('rank').textContent = rp.nextXp !== null
      ? `RANK ${rp.level + 1} · ${rp.name} — ${rp.xp}/${rp.nextXp} RP`
      : `RANK ${rp.level + 1} · ${rp.name} — ${rp.xp} RP · MAX RANK`;
    // Crew: one compact line per ability — key, ability, member, READY or seconds.
    el('crew').innerHTML = CREW.map((c, i) => {
      const cd = s.crew.state.cooldowns[i];
      const status = cd > 0 ? `${Math.ceil(cd)}s` : 'READY';
      return `<div><b>${c.key}</b> ${c.ability} · ${c.name} — ${status}</div>`;
    }).join('') + (s.crew.state.eyesOut > 0 ? `<div>EYES OUT — POLICE MARKED ${Math.ceil(s.crew.state.eyesOut)}s</div>` : '');
    // Weapon panel: four slot chips, the live one lit; holstered reads plainly.
    const loadout = s.combat.state.loadout;
    const w = WEAPONS[loadout.active];
    const holstered = !!loadout.holstered;
    el('weapon-name').textContent = holstered ? 'WEAPON HOLSTERED' : w.name;
    el('weapon-mag').textContent = holstered ? '—' : (w.pellets === 0 ? '∞' : `${loadout.ammo[loadout.active]}`);
    el('weapon-reserve').textContent = holstered ? '—' : (w.pellets === 0 ? '∞' : `${loadout.reserve[loadout.active]}`);
    el('weapon-sub').textContent = holstered ? 'Q — DRAW WEAPON' : w.blurb;
    el('weapon-slots').innerHTML = WEAPONS.map((sw, i) => {
      const locked = !loadout.unlocked[i];
      const label = locked ? 'LOCKED' : (sw.pellets === 0 ? '∞' : `${loadout.ammo[i]}/${loadout.reserve[i]}`);
      return `<span class="${i === loadout.active ? 'wslot-active' : ''}">${sw.key} ${sw.name.split(' ')[0]} ${label}</span>`;
    }).join(' ');
    el('weapon-hint').textContent = holstered
      ? 'Q — DRAW WEAPON'
      : 'Q — HOLSTER · 1-4 SWITCH · R RELOAD · CLICK FIRE';
    const speed = p.mode === 'car' ? Math.abs(s.heroCar.speed) * 3.6 : Math.abs(p.speed) * 3.6;
    el('speed').textContent = `${Math.round(speed)} KM/H`;
    // In-game clock: HH:MM plus the phase of day. Hidden while the clock is
    // pinned (cover staging) so the staged frame keeps the v4.3 HUD exactly.
    el('clock').textContent = `${formatClock(s.gameHour ?? 17.5)} · ${phaseAt(s.gameHour ?? 17.5)}`;
    el('clock').style.display = s.clockPin != null ? 'none' : '';
    const dmg = Math.round(s.heroCar.damage);
    const cond = dmg < 20 ? 'PRISTINE' : dmg < 50 ? 'DENTED' : dmg < 80 ? 'SMOKING' : 'WRECKED';
    el('carname').textContent = p.mode === 'car'
      ? `${CAR_MODELS[s.heroCar.model].name} · ${100 - dmg}% · ${cond}`
      : 'ON FOOT';
    const di = state.districtIndex;
    el('district').textContent = `${DISTRICTS[di].name} · ${s.standing[di] >= 60 ? 'FRIENDLY' : s.standing[di] >= 40 ? 'NEUTRAL' : 'WARY'} ${s.standing[di]}`;
    el('shells').textContent = `SHELLS ${s.shellsTaken}/20 · EXPORTS ${s.exportsDone.length}/5`;

    // Enter-car hint: on foot and near the hero car (or a stealable parked car).
    const hint = el('enter-hint');
    if (p.mode === 'foot') {
      const dCar = Math.hypot(s.heroCar.x - p.x, s.heroCar.z - p.z);
      if (dCar < 6) {
        hint.textContent = 'E — ENTER CAR';
        hint.style.display = 'block';
      } else {
        let steal = false;
        for (const c of s.traffic.cars) {
          if (Math.hypot(c.x - p.x, c.z - p.z) < 5 && Math.abs(c.speed) < 1) { steal = true; break; }
        }
        if (steal) {
          hint.textContent = 'E — STEAL CAR';
          hint.style.display = 'block';
        } else {
          hint.style.display = 'none';
        }
      }
    } else {
      hint.style.display = 'none';
    }

    // Dispatch panel: header counts the units, each line names the unit, its job
    // and its live distance.
    const disp = s.police.state.dispatch;
    el('dispatch').style.display = disp.length > 0 ? 'block' : 'none';
    el('dispatch-list').innerHTML = `<div><b>KPD RESPONSE · ${disp.length} UNIT${disp.length === 1 ? '' : 'S'}</b></div>` + disp.map((u) => `<div><b>${u.id}</b> · ${u.role} · ${u.dist} m</div>`).join('');
    // Dialog, bottom centre — never over the hero or the cruisers flanking him.
    const dlg = s.missions.state.dialog;
    if (dlg) {
      el('dialog').style.display = 'flex';
      el('dialog-name').textContent = dlg.speaker;
      el('dialog-line').textContent = dlg.line;
      drawPortrait(el('portrait'), dlg.speaker);
    } else {
      el('dialog').style.display = 'none';
    }

    // Minimap: square, 110 px, bottom left. Click it for the full-city map.
    drawMap(mm, 110, s, false);
    if (screen === 'paused' && bm) drawMap(bm, 560, s, true);
    if (screen === 'paused' && pauseTab === 'stats') {
      const sm = el('statsmap');
      if (sm) drawMap(sm.getContext('2d'), 360, s, true);
    }
    if (bigMapOpen() && fm) {
      drawMap(fm, 640, s, true);
      const info = el('bigmap-info');
      const px = p.mode === 'car' ? s.heroCar.x : p.x;
      const pz = p.mode === 'car' ? s.heroCar.z : p.z;
      info.textContent = waypoint
        ? `WAYPOINT ${Math.round(Math.hypot(waypoint.x - px, waypoint.z - pz))} M · ${DISTRICTS[di].name} · CLICK THE MAP TO MOVE IT · CLICK X OR PRESS ESC TO CLOSE`
        : `${DISTRICTS[di].name} · ${s.objective.text.toUpperCase()} · CLICK THE MAP TO SET A WAYPOINT · CLICK X OR PRESS ESC TO CLOSE`;
    }

    // Feed + results fade.
    if (feedTimer > 0) {
      feedTimer -= 1 / 60;
      if (feedTimer <= 0) el('crimefeed').innerHTML = '';
    }
    if (resultsTimer > 0) {
      resultsTimer -= 1 / 60;
      if (resultsTimer <= 0) el('results').style.display = 'none';
    }

    // Ledger line (only visible in the pause STATS tab). The element is built
    // by fillPause, so it does not exist on screens that never opened pause
    // (cover / title / play shots) — guard it instead of crashing update().
    if (ledger) {
      const ledgerEl = el('ledger');
      if (ledgerEl) ledgerEl.textContent = `RENDER ${ledger.calls} CALLS · ${ledger.triangles.toLocaleString('en-US')} TRI`;
    }
    void time;
  }

  /** Drain the world's event queue into feed lines, results and toasts. */
  function drainEvents(events) {
    for (const ev of events) {
      if (ev.type === 'crime') {
        pushFeed(`WANTED ${'★'.repeat(ev.wanted)} — ${ev.cause.toUpperCase()}`);
      } else if (ev.type === 'mission-complete') {
        showResults(`MISSION COMPLETE — ${ev.name}`, `+$${ev.reward} · ${ev.rating} · ${Math.round(ev.time)}s`);
      } else if (ev.type === 'stage-complete') {
        pushFeed(`STAGE COMPLETE — ${ev.id}`);
      } else if (ev.type === 'mission-fail') {
        pushFeed(`MISSION FAILED — ${ev.reason.toUpperCase()} · RESTARTING`);
      } else if (ev.type === 'bust') {
        showResults('BUSTED', `Lost $${ev.lost} · back at the safehouse`);
      } else if (ev.type === 'shell') {
        pushFeed(`GOLDEN SHELL ${ev.total}/20 — +$25`);
      } else if (ev.type === 'export') {
        showResults('EXPORT DELIVERED', `${ev.model} to the marina — +$${ev.reward}`);
      } else if (ev.type === 'enemy-down') {
        pushFeed(`GUNMAN DOWN — +$${ev.reward}`);
      } else if (ev.type === 'rank-up') {
        showResults(`RANK UP — ${ev.name}`, `${ev.unlock}${ev.opened && ev.opened.length ? ` · ${ev.opened.join(', ')} UNLOCKED` : ''}`);
      } else if (ev.type === 'crew') {
        pushFeed(`${ev.ability} — ${ev.name}`);
      } else if (ev.type === 'crew-cooling') {
        pushFeed(`${ev.ability} — COOLING ${ev.seconds}s`);
      } else if (ev.type === 'crew-need-car') {
        pushFeed(`${ev.ability} — NEED A CAR`);
      } else if (ev.type === 'weapon-locked') {
        pushFeed(`${ev.name} — NEEDS RANK ${ev.rank}`);
      } else if (ev.type === 'heli') {
        pushFeed('AIR UNIT DEPLOYED — HELICOPTER OVERHEAD');
      } else if (ev.type === 'holster') {
        pushFeed(ev.holstered ? 'WEAPON HOLSTERED — Q TO DRAW' : 'WEAPON DRAWN');
      } else if (ev.type === 'chain-complete') {
        showResults('WHEELMAN', 'All four jobs done. Solmarina is yours.');
      }
    }
    events.length = 0;
  }

  function showScreen(name) {
    for (const id of ['title', 'pause', 'gameover']) el(id).style.display = 'none';
    el('hud').style.display = name === 'play' || name === 'paused' ? 'block' : 'none';
    if (name !== 'play' && name !== 'paused') el(name).style.display = 'block';
    if (name === 'paused') el('pause').style.display = 'block';
  }

  function fmtTime(sec) {
    const m = Math.floor((sec || 0) / 60);
    const s = Math.floor((sec || 0) % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function slotCard(slot, i) {
    if (!slot) return `<b>SLOT ${i + 1} · EMPTY</b><span>New game — no save yet</span>`;
    const last = slot.missionUnlocked > 1
      ? `${MISSIONS[slot.missionUnlocked - 2].id} ${MISSIONS[slot.missionUnlocked - 2].name}`
      : 'NO MISSIONS YET';
    return `<b>SLOT ${i + 1} · ${slot.completion || 0}% COMPLETE</b><span>${last} · ${slot.district || ''}</span><span>$${(slot.cash || 0).toLocaleString('en-US')} · ${fmtTime(slot.time)} · ${(slot.savedAt || '').slice(0, 10)}</span>`;
  }

  function fillTitle(slots, best, st) {
    if (st) settings = st;
    el('best-line').textContent = best > 0 ? `BEST CASH $${best.toLocaleString('en-US')}` : '';
    const wrap = el('slots');
    wrap.innerHTML = '';
    slots.forEach((slot, i) => {
      const card = document.createElement('button');
      card.className = 'slot';
      card.innerHTML = slotCard(slot, i);
      card.addEventListener('click', () => callbacks.onSlot(i, slot));
      wrap.appendChild(card);
    });
    // CONTINUE loads the most recent save; LOAD GAME just spotlights the slots.
    let latest = -1;
    let latestAt = '';
    slots.forEach((slot, i) => {
      if (slot && slot.savedAt && slot.savedAt > latestAt) { latestAt = slot.savedAt; latest = i; }
    });
    const cont = el('continue-button');
    cont.disabled = latest < 0;
    cont.classList.toggle('dim', latest < 0);
    cont.onclick = () => { if (latest >= 0) callbacks.onContinue(latest); };
    el('load-button').onclick = () => {
      wrap.classList.add('flash');
      window.setTimeout(() => wrap.classList.remove('flash'), 900);
    };
    el('title-settings-button').onclick = () => {
      const panel = el('title-settings');
      panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    };
    const vol = el('vol-title');
    vol.value = String(Math.round(settings.volume * 100));
    el('vol-title-val').textContent = `${Math.round(settings.volume * 100)}%`;
    vol.oninput = () => {
      settings = { ...settings, volume: Number(vol.value) / 100 };
      el('vol-title-val').textContent = `${vol.value}%`;
      callbacks.onVolume(settings.volume);
    };
    for (const q of ['high', 'low']) {
      const btn = el(`quality-title-${q}`);
      btn.classList.toggle('active', settings.quality === q);
      btn.onclick = () => {
        settings = { ...settings, quality: q };
        for (const q2 of ['high', 'low']) el(`quality-title-${q2}`).classList.toggle('active', q2 === q);
        callbacks.onQuality(q);
      };
    }
  }

  function fillPause(state, slots, st) {
    if (st) settings = st;
    el('pause-missions').innerHTML = state.missionsList.map((mm) => (
      `<div class="prow"><b>${mm.id} · ${mm.name}</b><span>${mm.status}</span></div>`
    )).join('') + `<div class="prow"><b>RATINGS</b><span>${['M1', 'M2', 'M3', 'M4'].map((id) => `${id} ${state.ratings[id] || '—'}`).join(' · ')}</span></div>`
      + `<div class="prow"><b>PAR TIMES</b><span>M1 150s · M2 180s · M3 240s · M4 300s</span></div>`;
    // STATS tab: donut, checklist, mission ratings, career — all from live state.
    const friendly = state.standing.filter((v) => v >= 60).length;
    const gold = ['M1', 'M2', 'M3', 'M4'].filter((id) => state.ratings[id] === 'GOLD').length;
    const pct = state.completion;
    const circ = 2 * Math.PI * 60;
    const dash = (pct / 100) * circ;
    const bar = (done, total) => {
      const w = total > 0 ? Math.round((done / total) * 100) : 0;
      return `<span class="cbar"><span style="width:${w}%"></span></span>`;
    };
    const row = (label, done, total) => (
      `<div class="crow"><span>${label}</span>${bar(done, total)}<b>${done}/${total}</b></div>`
    );
    const ratingLetter = (id) => ({ GOLD: 'G', SILVER: 'S', BRONZE: 'B' })[state.ratings[id]] || '–';
    const ratingClass = (id) => (state.ratings[id] || 'none').toLowerCase();
    el('pause-stats').innerHTML = `
      <div class="stats-grid">
        <div class="stats-left">
          <div class="donut-wrap">
            <svg width="140" height="140" viewBox="0 0 140 140">
              <circle cx="70" cy="70" r="60" fill="none" stroke="#2c313a" stroke-width="12"/>
              <circle cx="70" cy="70" r="60" fill="none" stroke="#f2c94c" stroke-width="12"
                stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}" stroke-linecap="round"
                transform="rotate(-90 70 70)"/>
              <text x="70" y="66" text-anchor="middle" fill="#f5f0e6" font-size="26" font-weight="800">${pct}%</text>
              <text x="70" y="86" text-anchor="middle" fill="#f2c94c" font-size="11" font-weight="700" letter-spacing="2">COMPLETE</text>
            </svg>
          </div>
          <div class="checklist">
            ${row('Story missions', state.missionsDone, 4)}
            ${row('Golden Shells', state.shells, 20)}
            ${row('Export list', state.exports, 5)}
            ${row('Districts FRIENDLY', friendly, 7)}
            ${row('Crew recruited', 3, 3)}
            ${row('Gold mission ratings', gold, 4)}
          </div>
          <div class="ratings"><b>MISSION RATINGS</b><div class="rating-circles">
            ${['M1', 'M2', 'M3', 'M4'].map((id, i) => `<span class="rcircle ${ratingClass(id)}"><span class="rnum">${i + 1}</span><span class="rlet">${ratingLetter(id)}</span></span>`).join('')}
          </div></div>
          <div class="formula">Missions 45 · Shells 20 · Exports 15 · Friendly 15 · Crew 5</div>
        </div>
        <div class="stats-right">
          <div class="stats-map"><canvas id="statsmap" width="360" height="360"></canvas>
          <div class="stats-map-cap">SOLMARINA — GOLD: OBJECTIVE · RED: POLICE · CLICK MAP TAB FOR THE FULL MAP</div></div>
          <div class="career">
            <div class="prow"><b>RANK</b><span>${state.rank.level + 1} · ${RANKS[state.rank.level].name} · ${state.rank.xp} RP</span></div>
            <div class="prow"><b>CASH</b><span>$${state.cash.toLocaleString('en-US')}</span></div>
            <div class="prow"><b>DISTANCE</b><span>${(state.distance / 1000).toFixed(1)} km</span></div>
            <div class="prow"><b>CARS STOLEN</b><span>${state.carsStolen}</span></div>
            <div class="prow"><b>COPS ESCAPED</b><span>${state.copsEscaped}</span></div>
            <div class="prow"><b>SHOTS FIRED</b><span>${state.shots}</span></div>
            <div class="prow"><b>CREW ABILITIES USED</b><span>${state.crewUsed}</span></div>
          </div>
        </div>
      </div>
      <div id="ledger"></div>`;
    // CREW tab: the three crew members, ability, key, cooldown right now.
    el('pause-crew').innerHTML = CREW.map((c, i) => {
      const cd = state.crewCooldowns[i];
      const status = cd > 0 ? `COOLING — ${Math.ceil(cd)}s` : 'READY';
      return `<div class="prow"><b>${c.key} · ${c.name} — ${c.role}</b><span>${status}</span></div>`
        + `<div class="crow-sub">${c.ability} — ${c.desc}${c.needsCar ? ' · NEEDS A CAR' : ''}</div>`;
    }).join('') + `<div class="crow-sub">Abilities used this game: ${state.crewUsed}</div>`;
    // SETTINGS tab: volume + graphics quality, both live immediately.
    const vol = el('vol-pause');
    vol.value = String(Math.round(settings.volume * 100));
    el('vol-pause-val').textContent = `${Math.round(settings.volume * 100)}%`;
    vol.oninput = () => {
      settings = { ...settings, volume: Number(vol.value) / 100 };
      el('vol-pause-val').textContent = `${vol.value}%`;
      callbacks.onVolume(settings.volume);
    };
    for (const q of ['high', 'low']) {
      const btn = el(`quality-pause-${q}`);
      btn.classList.toggle('active', settings.quality === q);
      btn.onclick = () => {
        settings = { ...settings, quality: q };
        for (const q2 of ['high', 'low']) el(`quality-pause-${q2}`).classList.toggle('active', q2 === q);
        callbacks.onQuality(q);
      };
    }
    // SAVE tab.
    const wrap = el('pause-slots');
    wrap.innerHTML = '';
    slots.forEach((slot, i) => {
      const card = document.createElement('button');
      card.className = 'slot';
      card.innerHTML = slot
        ? `<b>SAVE SLOT ${i + 1}</b><span>${slot.completion || 0}% · $${(slot.cash || 0).toLocaleString('en-US')} · ${slot.district || ''} · ${fmtTime(slot.time)} · ${(slot.savedAt || '').slice(0, 10)}</span>`
        : `<b>SAVE SLOT ${i + 1} · EMPTY</b><span>Save here</span>`;
      card.addEventListener('click', () => callbacks.onSave(i));
      wrap.appendChild(card);
    });
  }

  function setPauseTab(tab) {
    if (!TABS.includes(tab)) return;
    pauseTab = tab;
    for (const t of TABS) {
      el(`tab-${t}`).style.display = t === tab ? 'block' : 'none';
      el(`tabbtn-${t}`).classList.toggle('active', t === tab);
    }
  }

  function nextTab() {
    setPauseTab(TABS[(TABS.indexOf(pauseTab) + 1) % TABS.length]);
  }

  function prevTab() {
    setPauseTab(TABS[(TABS.indexOf(pauseTab) - 1 + TABS.length) % TABS.length]);
  }

  function openBigMap() {
    el('bigmap-overlay').style.display = 'flex';
  }

  function closeBigMap() {
    el('bigmap-overlay').style.display = 'none';
  }

  function bigMapOpen() {
    return el('bigmap-overlay').style.display !== 'none' && el('bigmap-overlay').style.display !== '';
  }

  // Click the minimap: the full-city map. Click the big map: set a waypoint.
  function mapClickToWorld(canvas, event) {
    const rect = canvas.getBoundingClientRect();
    const size = canvas.width;
    const px = ((event.clientX - rect.left) / rect.width) * size;
    const py = ((event.clientY - rect.top) / rect.height) * size;
    return { x: (px / size) * 760 - 380, z: (py / size) * 760 - 380 };
  }
  el('mapwrap').addEventListener('click', () => openBigMap());
  el('bigmap-close').addEventListener('click', () => closeBigMap());
  el('bigmap-overlay').addEventListener('click', (event) => {
    if (event.target.id === 'bigmap-overlay') closeBigMap();
  });
  if (fullmap) {
    fullmap.addEventListener('click', (event) => {
      waypoint = mapClickToWorld(fullmap, event);
    });
  }
  if (bigmap) {
    bigmap.addEventListener('click', (event) => {
      waypoint = mapClickToWorld(bigmap, event);
    });
  }

  el('start-button').addEventListener('click', () => callbacks.onStart());
  el('resume-button').addEventListener('click', () => callbacks.onResume());
  el('restart-button').addEventListener('click', () => callbacks.onRestart());
  for (const t of TABS) {
    el(`tabbtn-${t}`).addEventListener('click', () => setPauseTab(t));
  }

  return {
    update, drainEvents, showScreen, fillTitle, fillPause, setPauseTab,
    nextTab, prevTab, pushFeed, showResults,
    openBigMap, closeBigMap, bigMapOpen,
    waypoint: () => waypoint,
  };
}
