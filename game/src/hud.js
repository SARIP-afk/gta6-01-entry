// The HUD: every DOM panel the player reads — mission banner, wanted stars with
// their tier name, cash, health, ammo, the weapon panel, speed, the 90 px minimap,
// the police dispatch panel, the crime feed, dialog with a procedural portrait, the
// radio label, the results banner, and the two big overlays: title (with save slots)
// and pause (MAP / STORY / STATS / SAVE tabs). All of it is DOM, so it costs zero
// draw calls.
import { CITY, DISTRICTS, WANTED_TIERS, WEAPON, CAR_MODELS } from './config.js';

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
  const feedLines = [];
  let feedTimer = 0;
  let resultsTimer = 0;

  function drawMap(ctx, size, state, big) {
    const span = 760;
    const s = size / span;
    const toX = (x) => (x + span / 2) * s;
    const toZ = (z) => (z + span / 2) * s;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(20, 28, 36, 0.88)';
    ctx.fillRect(0, 0, size, size);
    // Roads.
    ctx.strokeStyle = 'rgba(200, 205, 215, 0.5)';
    ctx.lineWidth = big ? 3 : 1;
    for (const r of state.city.roads) {
      ctx.beginPath();
      ctx.moveTo(toX(r), 0);
      ctx.lineTo(toX(r), size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, toZ(r));
      ctx.lineTo(size, toZ(r));
      ctx.stroke();
    }
    // Causeway + pier.
    ctx.strokeStyle = '#f2c94c';
    ctx.beginPath();
    ctx.moveTo(toX(CITY.gridMax), toZ(-6));
    ctx.lineTo(toX(CITY.pier.x), toZ(-6));
    ctx.stroke();
    // Shells.
    ctx.fillStyle = '#f2c94c';
    for (const sh of state.city.shells) {
      if (!sh.taken) ctx.fillRect(toX(sh.x) - 1, toZ(sh.z) - 1, 2, 2);
    }
    // Objective diamond.
    const o = state.objective;
    if (o && o.dist > 0.1) {
      ctx.save();
      ctx.translate(toX(o.x), toZ(o.z));
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#f2c94c';
      const r = big ? 7 : 4;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.restore();
    }
    // Police blips.
    ctx.fillStyle = '#ff4a4a';
    for (const u of state.police.units) {
      ctx.beginPath();
      ctx.arc(toX(u.x), toZ(u.z), big ? 4 : 2.5, 0, Math.PI * 2);
      ctx.fill();
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
    // Player arrow.
    const px = state.player.mode === 'car' ? state.heroCar.x : state.player.x;
    const pz = state.player.mode === 'car' ? state.heroCar.z : state.player.z;
    const heading = state.player.mode === 'car' ? state.heroCar.heading : state.player.heading;
    ctx.save();
    ctx.translate(toX(px), toZ(pz));
    ctx.rotate(-heading);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-5, -5);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // District names on the big pause map, so it reads as a city, not a grid.
    if (big) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      for (const d of DISTRICTS) {
        const cx = (d.x0 + d.x1) / 2;
        const cz = (d.z0 + d.z1) / 2;
        ctx.fillText(d.name, toX(cx), toZ(cz));
      }
      ctx.fillStyle = 'rgba(242,201,76,0.9)';
      ctx.font = '10px system-ui, sans-serif';
      for (let i = 0; i < DISTRICTS.length; i += 1) {
        const d = DISTRICTS[i];
        const cx = (d.x0 + d.x1) / 2;
        const cz = (d.z0 + d.z1) / 2;
        const st = state.standing[i];
        ctx.fillText(st >= 60 ? `FRIENDLY ${st}` : st >= 40 ? `NEUTRAL ${st}` : `WARY ${st}`, toX(cx), toZ(cz) + 13);
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = `bold ${big ? 14 : 10}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
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

    // Banner: mission name, stage text, distance or timer.
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

    // Wanted stars + tier.
    el('wanted-stars').textContent = '★'.repeat(wanted) + '☆'.repeat(5 - wanted);
    el('wanted-tier').textContent = tier.label;
    el('wanted').style.display = wanted > 0 ? 'block' : 'none';

    el('cash').textContent = `$${s.cash.toLocaleString('en-US')}`;
    el('health-fill').style.width = `${Math.max(0, p.health)}%`;
    el('health-num').textContent = `${Math.round(p.health)}`;
    el('ammo').textContent = s.combat.state.reloading ? 'RELOADING' : `${WEAPON.name} ${s.combat.state.ammo}/${s.combat.state.reserve}`;
    // Weapon panel: big name, big ammo, reload hint — the one panel a shooter reads.
    el('weapon-name').textContent = WEAPON.name;
    el('weapon-sub').textContent = `${WEAPON.damage} DMG · ${WEAPON.range} M RANGE`;
    if (s.combat.state.reloading) {
      el('weapon-mag').textContent = '––';
      el('weapon-reserve').textContent = `${s.combat.state.reserve}`;
      el('weapon-hint').textContent = 'RELOADING…';
    } else {
      el('weapon-mag').textContent = `${s.combat.state.ammo}`;
      el('weapon-reserve').textContent = `${s.combat.state.reserve}`;
      el('weapon-hint').textContent = 'R — RELOAD · CLICK — FIRE';
    }
    const speed = p.mode === 'car' ? Math.abs(s.heroCar.speed) * 3.6 : Math.abs(p.speed) * 3.6;
    el('speed').textContent = `${Math.round(speed)} KM/H`;
    const dmg = Math.round(s.heroCar.damage);
    const cond = dmg < 20 ? 'PRISTINE' : dmg < 50 ? 'DENTED' : dmg < 80 ? 'SMOKING' : 'WRECKED';
    el('carname').textContent = p.mode === 'car'
      ? `${CAR_MODELS[s.heroCar.model].name} · ${100 - dmg}% · ${cond}`
      : 'ON FOOT';
    const di = state.districtIndex;
    el('district').textContent = `${DISTRICTS[di].name} — ${DISTRICTS[di].tag} · ${s.standing[di] >= 60 ? 'FRIENDLY' : s.standing[di] >= 40 ? 'NEUTRAL' : 'WARY'} ${s.standing[di]} · ${s.completionPct || 0}% DONE`;
    el('shells').textContent = `SHELLS ${s.shellsTaken}/20 · EXPORTS ${s.exportsDone.length}/5`;

    // Dispatch panel: header counts the units, each line names the unit, its job
    // and its live distance.
    const disp = s.police.state.dispatch;
    el('dispatch').style.display = disp.length > 0 ? 'block' : 'none';
    el('dispatch-list').innerHTML = `<div><b>KPD RESPONSE · ${disp.length} UNIT${disp.length === 1 ? '' : 'S'}</b></div>` + disp.map((u) => `<div><b>${u.id}</b> · ${u.role} · ${u.dist} m</div>`).join('');

    // Dialog.
    const dlg = s.missions.state.dialog;
    if (dlg) {
      el('dialog').style.display = 'flex';
      el('dialog-name').textContent = dlg.speaker;
      el('dialog-line').textContent = dlg.line;
      drawPortrait(el('portrait'), dlg.speaker);
    } else {
      el('dialog').style.display = 'none';
    }

    // Minimap.
    drawMap(mm, 90, s, false);
    if (screen === 'paused' && bm) drawMap(bm, 360, s, true);

    // Feed + results fade.
    if (feedTimer > 0) {
      feedTimer -= 1 / 60;
      if (feedTimer <= 0) el('crimefeed').innerHTML = '';
    }
    if (resultsTimer > 0) {
      resultsTimer -= 1 / 60;
      if (resultsTimer <= 0) el('results').style.display = 'none';
    }

    // Ledger line (only visible in the pause STATS tab).
    if (ledger) el('ledger').textContent = `RENDER ${ledger.calls} CALLS · ${ledger.triangles.toLocaleString('en-US')} TRI`;
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

  function fillTitle(slots, best) {
    el('best-line').textContent = best > 0 ? `BEST CASH $${best.toLocaleString('en-US')}` : '';
    const wrap = el('slots');
    wrap.innerHTML = '';
    slots.forEach((slot, i) => {
      const card = document.createElement('button');
      card.className = 'slot';
      if (!slot) {
        card.innerHTML = `<b>SLOT ${i + 1} · EMPTY</b><span>New game</span>`;
      } else {
        card.innerHTML = `<b>SLOT ${i + 1} · ${slot.district || ''}</b><span>$${(slot.cash || 0).toLocaleString('en-US')} · Missions ${slot.missionUnlocked - 1}/4 · ${slot.completion || 0}%</span>`;
      }
      card.addEventListener('click', () => callbacks.onSlot(i, slot));
      wrap.appendChild(card);
    });
  }

  function fillPause(state, slots) {
    el('pause-missions').innerHTML = state.missionsList.map((mm) => (
      `<div class="prow"><b>${mm.id} · ${mm.name}</b><span>${mm.status}</span></div>`
    )).join('') + `<div class="prow"><b>RATINGS</b><span>${['M1', 'M2', 'M3', 'M4'].map((id) => `${id} ${state.ratings[id] || '—'}`).join(' · ')}</span></div>`
      + `<div class="prow"><b>PAR TIMES</b><span>M1 150s · M2 180s · M3 240s · M4 300s</span></div>`;
    el('pause-stats').innerHTML = [
      `COMPLETION ${state.completion}%`,
      `Missions ${state.missionsDone}/4 · Shells ${state.shells}/20 · Exports ${state.exports}/5`,
      `Distance ${(state.distance / 1000).toFixed(1)} km · Cars stolen ${state.carsStolen} · Cops escaped ${state.copsEscaped}`,
      `Shots ${state.shots} · Cash $${state.cash.toLocaleString('en-US')}`,
      `District standing: ${state.standing.map((v, i) => `${state.districtNames[i]} ${v}`).join(' · ')}`,
    ].map((l) => `<div>${l}</div>`).join('');
    const wrap = el('pause-slots');
    wrap.innerHTML = '';
    slots.forEach((slot, i) => {
      const card = document.createElement('button');
      card.className = 'slot';
      card.innerHTML = slot
        ? `<b>SAVE SLOT ${i + 1}</b><span>$${(slot.cash || 0).toLocaleString('en-US')} · ${slot.completion || 0}% · ${slot.district || ''} · ${slot.savedAt ? slot.savedAt.slice(0, 10) : ''}</span>`
        : `<b>SAVE SLOT ${i + 1} · EMPTY</b><span>Save here</span>`;
      card.addEventListener('click', () => callbacks.onSave(i));
      wrap.appendChild(card);
    });
  }

  function setPauseTab(tab) {
    for (const t of ['map', 'story', 'stats', 'save']) {
      el(`tab-${t}`).style.display = t === tab ? 'block' : 'none';
      el(`tabbtn-${t}`).classList.toggle('active', t === tab);
    }
  }

  el('start-button').addEventListener('click', () => callbacks.onStart());
  el('resume-button').addEventListener('click', () => callbacks.onResume());
  el('restart-button').addEventListener('click', () => callbacks.onRestart());
  for (const t of ['map', 'story', 'stats', 'save']) {
    el(`tabbtn-${t}`).addEventListener('click', () => setPauseTab(t));
  }

  return { update, drainEvents, showScreen, fillTitle, fillPause, setPauseTab, pushFeed, showResults };
}
