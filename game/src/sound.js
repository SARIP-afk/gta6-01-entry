// Solmarina (fresh build) — procedural audio: three radio stations, engine
// hum, gunshots and pickup blips, all synthesized with WebAudio. No audio
// files, no network. AudioContext starts on the first user gesture.
const STATIONS = [
  { name: 'SOL 98.1 · COAST FM', bpm: 96, root: 57, scale: [0, 3, 5, 7, 10], wave: 'triangle' },
  { name: 'BASS 94.6 · HARBOR', bpm: 122, root: 45, scale: [0, 0, 7, 10], wave: 'sawtooth' },
  { name: 'LO-FI 88.9 · TIDE', bpm: 72, root: 60, scale: [0, 2, 4, 7, 9], wave: 'sine' },
];

export class Sound {
  constructor() {
    this.ctx = null;
    this.station = 0;
    this.nextNote = 0;
    this.step = 0;
    this.engineOsc = null;
    this.engineGain = null;
    this.master = null;
    this.sirenGain = null;
    this.stepTimer = 0;
    this.stepAlt = false;
    this.volume = 0.5;
    this.volumes = [0.5, 0.25, 0, 1];
  }
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 420;
    this.engineOsc.connect(filt);
    filt.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engineOsc.start();
    // police siren: two-tone "nee-naw" — a triangle osc whose pitch is
    // swept by a slow square LFO, silent until wanted > 0 (gain driven
    // per frame by siren(), louder the nearer the closest cruiser)
    this.sirenOsc = this.ctx.createOscillator();
    this.sirenOsc.type = 'triangle';
    this.sirenOsc.frequency.value = 950;
    const lfo = this.ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 0.55;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 260;
    lfo.connect(lfoGain);
    lfoGain.connect(this.sirenOsc.frequency);
    this.sirenGain = this.ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenOsc.connect(this.sirenGain);
    this.sirenGain.connect(this.master);
    this.sirenOsc.start();
    lfo.start();
    this.nextNote = this.ctx.currentTime + 0.1;
  }
  /** Cycle the master volume 50% -> 25% -> mute -> 100% -> 50%. */
  cycleVolume() {
    const i = (this.volumes.indexOf(this.volume) + 1) % this.volumes.length;
    this.volume = this.volumes[i];
    if (this.master) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    return this.volumeLabel();
  }
  volumeLabel() { return this.volume === 0 ? 'MUTED' : `VOL ${Math.round(this.volume * 100)}%`; }
  /** Police siren: on while wanted, louder the closer the nearest cruiser. */
  siren(active, nearestDist) {
    if (!this.ctx || !this.sirenGain) return;
    const target = active ? Math.max(0.015, Math.min(0.09, 0.12 - (nearestDist || 200) * 0.0006)) : 0;
    this.sirenGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.2);
  }
  /** Two-tone car horn (H key). */
  horn() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const f of [370, 466]) {
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      g.gain.setValueAtTime(0.12, t + 0.28);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
      o.connect(g);
      g.connect(this.master);
      o.start(t);
      o.stop(t + 0.4);
    }
  }
  /** Footsteps on foot: a soft filtered thud every ~0.38 s while moving. */
  footsteps(moving, dt) {
    if (!this.ctx) return;
    if (!moving) { this.stepTimer = 0; return; }
    this.stepTimer += dt;
    if (this.stepTimer < 0.38) return;
    this.stepTimer = 0;
    this.stepAlt = !this.stepAlt;
    const t = this.ctx.currentTime;
    const len = Math.floor(44100 * 0.07);
    const buf = this.ctx.createBuffer(1, len, 44100);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = this.stepAlt ? 320 : 260;
    const g = this.ctx.createGain();
    g.gain.value = 0.16;
    src.connect(filt);
    filt.connect(g);
    g.connect(this.master);
    src.start(t);
  }
  setStation(i) {
    this.station = ((i % STATIONS.length) + STATIONS.length) % STATIONS.length;
    this.step = 0;
    return STATIONS[this.station].name;
  }
  stationName() { return STATIONS[this.station].name; }
  engine(speed, inCar) {
    if (!this.ctx) return;
    const target = inCar ? 0.05 + Math.min(0.12, Math.abs(speed) * 0.003) : 0;
    this.engineGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.1);
    this.engineOsc.frequency.setTargetAtTime(50 + Math.abs(speed) * 3.2, this.ctx.currentTime, 0.1);
  }
  tick() {
    if (!this.ctx) return;
    const st = STATIONS[this.station];
    const spb = 60 / st.bpm / 2;
    while (this.nextNote < this.ctx.currentTime + 0.15) {
      const deg = st.scale[this.step % st.scale.length] + (this.step % 16 >= 12 ? 12 : 0);
      const midi = st.root + deg;
      const freq = 440 * Math.pow(2, (midi - 69) / 12);
      const o = this.ctx.createOscillator();
      o.type = st.wave;
      o.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, this.nextNote);
      g.gain.exponentialRampToValueAtTime(0.09, this.nextNote + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, this.nextNote + spb * 0.95);
      o.connect(g);
      g.connect(this.master);
      o.start(this.nextNote);
      o.stop(this.nextNote + spb);
      if (this.step % 4 === 0) {
        const b = this.ctx.createOscillator();
        b.type = 'sine';
        b.frequency.value = 440 * Math.pow(2, (st.root - 24 - 69) / 12);
        const bg = this.ctx.createGain();
        bg.gain.setValueAtTime(0.0001, this.nextNote);
        bg.gain.exponentialRampToValueAtTime(0.12, this.nextNote + 0.02);
        bg.gain.exponentialRampToValueAtTime(0.001, this.nextNote + spb * 1.8);
        b.connect(bg);
        bg.connect(this.master);
        b.start(this.nextNote);
        b.stop(this.nextNote + spb * 2);
      }
      this.nextNote += spb;
      this.step++;
    }
  }
  shot() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const buf = this.ctx.createBuffer(1, 2205, 44100);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = 0.35;
    src.connect(g);
    g.connect(this.master);
    src.start(t);
  }
  blip(freq = 880) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.2);
  }
}
