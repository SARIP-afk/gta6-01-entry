// Radio: three procedural stations, composed live with WebAudio oscillators — no
// audio files, no network. A bass line, a hat tick and a pad chord, at each station's
// own tempo and root note. R cycles stations, 0 is off. Audio starts on the first
// user gesture, as browsers require.
import { RADIO } from './config.js';

export function createRadio() {
  let ctx = null;
  let master = null;
  let timer = null;
  let station = -1; // -1 = off
  let volume = 0.7;
  let beat = 0;
  let nextTime = 0;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.16 * volume;
      master.connect(ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  function note(freq, time, dur, type, gain) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(gain, time + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(time);
    osc.stop(time + dur + 0.05);
  }

  function schedule() {
    if (!ctx || station < 0) return;
    const st = RADIO[station];
    const spb = 60 / st.bpm / 2; // eighth notes
    while (nextTime < ctx.currentTime + 0.25) {
      const b = beat % 16;
      const root = st.root;
      // Bass on the beat, a fifth on the off-beat, pad on the bar.
      if (b % 4 === 0) note(root / 2, nextTime, spb * 1.8, 'triangle', 0.5);
      if (b % 4 === 2) note(root * 0.75, nextTime, spb, 'triangle', 0.3);
      if (b === 0) {
        note(root, nextTime, spb * 8, 'sine', 0.12);
        note(root * 1.5, nextTime, spb * 8, 'sine', 0.08);
      }
      if (b % 2 === 1) note(6000, nextTime, 0.03, 'square', 0.05); // hat tick
      beat += 1;
      nextTime += spb;
    }
  }

  function start() {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    if (timer) return;
    nextTime = ctx.currentTime + 0.05;
    beat = 0;
    timer = window.setInterval(schedule, 90);
  }

  function stop() {
    if (timer) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  /** Cycle to the next station (off after the last). Returns the station or null. */
  function next() {
    station += 1;
    if (station >= RADIO.length) station = -1;
    if (station < 0) stop();
    else start();
    return station < 0 ? null : RADIO[station];
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (master) master.gain.value = 0.16 * volume;
  }

  function label() {
    return station < 0 ? 'RADIO OFF' : `♪ ${RADIO[station].name}`;
  }

  return { next, label, start, stop, setVolume, volume: () => volume, station: () => station };
}
