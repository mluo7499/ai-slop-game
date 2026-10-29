// Fully procedural WebAudio: no sound files, tiny download, punchy feedback.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.65;
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.noise = null;
    this.enabled = true;
  }

  init() {
    if (this.ctx) { this.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.22;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);

    const len = Math.floor(this.ctx.sampleRate * 0.6);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;
    this.startAmbience();
  }

  resume() {
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  setListener(x, y, z, yaw) {
    this.listener.x = x; this.listener.y = y; this.listener.z = z; this.listener.yaw = yaw;
  }

  spatial(pos) {
    if (!pos) return { gain: 1, pan: 0 };
    const dx = pos[0] - this.listener.x;
    const dy = pos[1] - this.listener.y;
    const dz = pos[2] - this.listener.z;
    const dist = Math.hypot(dx, dy, dz);
    const gain = Math.max(0, 1 - dist / 80) ** 1.6;
    const rightX = Math.cos(this.listener.yaw);
    const rightZ = -Math.sin(this.listener.yaw);
    const pan = dist > 0.5 ? Math.max(-0.85, Math.min(0.85, (dx * rightX + dz * rightZ) / dist)) : 0;
    return { gain, pan };
  }

  noiseBurst({ dur = 0.12, gain = 0.3, freq = 1200, q = 0.9, type = 'bandpass', pan = 0, sweep = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (sweep) filter.frequency.exponentialRampToValueAtTime(Math.max(60, freq + sweep), t + dur);
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(filter); filter.connect(g); g.connect(p); p.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  tone({ freq = 440, dur = 0.15, gain = 0.2, type = 'sine', slide = 0, delay = 0, pan = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    osc.connect(g); g.connect(p); p.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  startAmbience() {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 42;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 110;
    const g = this.ctx.createGain();
    g.gain.value = 0.025;
    osc.connect(filter); filter.connect(g); g.connect(this.master);
    osc.start();
  }

  shoot(type, pos) {
    if (!this.ctx) return;
    const { gain, pan } = this.spatial(pos);
    if (gain < 0.02) return;
    if (type === 'sniper') {
      this.noiseBurst({ dur: 0.4, gain: 0.5 * gain, freq: 900, q: 0.6, pan, sweep: -600 });
      this.tone({ freq: 90, slide: 34, dur: 0.35, gain: 0.3 * gain, type: 'triangle', pan });
    } else if (type === 'shotgun') {
      this.noiseBurst({ dur: 0.28, gain: 0.5 * gain, freq: 700, q: 0.5, pan, sweep: -420 });
      this.tone({ freq: 70, slide: 30, dur: 0.24, gain: 0.24 * gain, type: 'square', pan });
    } else if (type === 'rifle' || type === 'rifle2') {
      this.noiseBurst({ dur: 0.14, gain: 0.34 * gain, freq: type === 'rifle' ? 1500 : 1900, q: 0.8, pan, sweep: -900 });
      this.tone({ freq: type === 'rifle' ? 130 : 160, slide: 48, dur: 0.11, gain: 0.19 * gain, type: 'square', pan });
    } else if (type === 'smg') {
      this.noiseBurst({ dur: 0.09, gain: 0.24 * gain, freq: 2100, q: 1.1, pan, sweep: -900 });
      this.tone({ freq: 190, slide: 70, dur: 0.07, gain: 0.12 * gain, type: 'square', pan });
    } else if (type === 'pistol') {
      this.noiseBurst({ dur: 0.1, gain: 0.26 * gain, freq: 2400, q: 1.2, pan, sweep: -1200 });
      this.tone({ freq: 220, slide: 90, dur: 0.07, gain: 0.1 * gain, type: 'square', pan });
    } else if (type === 'deagle') {
      this.noiseBurst({ dur: 0.22, gain: 0.42 * gain, freq: 1200, q: 0.8, pan, sweep: -700 });
      this.tone({ freq: 110, slide: 40, dur: 0.2, gain: 0.22 * gain, type: 'sawtooth', pan });
    } else if (type === 'knife') {
      this.noiseBurst({ dur: 0.16, gain: 0.18 * gain, freq: 5200, q: 2.2, pan, sweep: 2000 });
    } else if (type === 'throw') {
      this.noiseBurst({ dur: 0.12, gain: 0.12, freq: 800, q: 1.2, pan });
    }
  }

  hitmarker(headshot = false) {
    if (!this.ctx) return;
    this.tone({ freq: headshot ? 1720 : 1080, dur: 0.055, gain: 0.12, type: 'triangle' });
    if (headshot) this.tone({ freq: 2400, dur: 0.08, gain: 0.08, type: 'sine', delay: 0.03 });
  }

  kill() {
    this.tone({ freq: 660, dur: 0.08, gain: 0.1, type: 'square' });
    this.tone({ freq: 990, dur: 0.12, gain: 0.09, type: 'square', delay: 0.06 });
  }

  hurt() {
    this.noiseBurst({ dur: 0.18, gain: 0.22, freq: 320, q: 0.7, type: 'lowpass' });
    this.tone({ freq: 90, slide: 50, dur: 0.2, gain: 0.12, type: 'sine' });
  }

  footstep(pos, crouch = false) {
    const { gain, pan } = this.spatial(pos);
    this.noiseBurst({ dur: 0.07, gain: (crouch ? 0.045 : 0.1) * gain, freq: 340, q: 0.8, type: 'lowpass', pan });
  }

  explosion(pos) {
    const { gain, pan } = this.spatial(pos);
    this.noiseBurst({ dur: 0.75, gain: 0.55 * gain, freq: 620, q: 0.5, pan, sweep: -520 });
    this.tone({ freq: 62, slide: 24, dur: 0.7, gain: 0.36 * gain, type: 'sawtooth', pan });
    this.tone({ freq: 120, slide: 40, dur: 0.4, gain: 0.2 * gain, type: 'triangle', pan });
  }

  beep(fast = false) {
    this.tone({ freq: fast ? 1400 : 1050, dur: 0.07, gain: 0.12, type: 'square' });
  }

  plant() {
    for (let i = 0; i < 3; i++) this.tone({ freq: 520, dur: 0.08, gain: 0.12, type: 'square', delay: i * 0.14 });
  }

  defuse() {
    for (let i = 0; i < 2; i++) this.tone({ freq: 760, dur: 0.12, gain: 0.1, type: 'sine', delay: i * 0.18 });
  }

  reload(dur = 2) {
    this.noiseBurst({ dur: 0.06, gain: 0.14, freq: 1800, q: 1.4 });
    setTimeout(() => this.noiseBurst({ dur: 0.07, gain: 0.16, freq: 900, q: 1.2 }), Math.max(120, dur * 700));
  }

  ui(ok = true) {
    this.tone({ freq: ok ? 720 : 260, dur: 0.05, gain: 0.07, type: 'triangle' });
  }

  levelUp() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone({ freq: f, dur: 0.22, gain: 0.1, type: 'triangle', delay: i * 0.08 }));
  }

  win() {
    [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone({ freq: f, dur: 0.3, gain: 0.11, type: 'triangle', delay: i * 0.11 }));
  }

  lose() {
    [392, 330, 262, 196].forEach((f, i) => this.tone({ freq: f, dur: 0.34, gain: 0.11, type: 'sine', delay: i * 0.13 }));
  }

  roundStart() {
    this.tone({ freq: 330, dur: 0.16, gain: 0.1, type: 'square' });
    this.tone({ freq: 495, dur: 0.2, gain: 0.1, type: 'square', delay: 0.12 });
  }
}
