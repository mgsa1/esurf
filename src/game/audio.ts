/**
 * Minimal arcade SFX via WebAudio. No external assets — every sound is
 * synthesized with oscillators + filter sweeps + noise bursts.
 *
 * Lazy-init on first play() so we satisfy autoplay-policy gestures.
 * All gains are conservative — easy to mix without clipping.
 */

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let muted = false;

function ensure(): boolean {
  if (muted) return false;
  if (ctx) return true;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;
    ctx = new Ctor();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.45;
    masterGain.connect(ctx.destination);
    return true;
  } catch {
    return false;
  }
}

export function setMuted(v: boolean): void {
  muted = v;
  if (muted && ctx) ctx.suspend?.();
  if (!muted && ctx) ctx.resume?.();
}

export function isMuted(): boolean { return muted; }

/** Short noise burst routed through a band-pass filter. */
function noiseBurst(durationS: number, freq: number, q: number, gain: number): void {
  if (!ensure() || !ctx || !masterGain) return;
  const bufferLen = Math.floor(ctx.sampleRate * durationS);
  const buffer = ctx.createBuffer(1, bufferLen, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferLen; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = q;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, ctx.currentTime);
  env.gain.linearRampToValueAtTime(gain, ctx.currentTime + 0.005);
  env.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationS);
  src.connect(filter);
  filter.connect(env);
  env.connect(masterGain);
  src.start();
  src.stop(ctx.currentTime + durationS + 0.05);
}

/** Quick FM-like blip with frequency sweep. */
function tone(freqStart: number, freqEnd: number, durationS: number, type: OscillatorType, gain: number): void {
  if (!ensure() || !ctx || !masterGain) return;
  const osc = ctx.createOscillator();
  osc.type = type;
  const env = ctx.createGain();
  const now = ctx.currentTime;
  osc.frequency.setValueAtTime(freqStart, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), now + durationS);
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(gain, now + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, now + durationS);
  osc.connect(env);
  env.connect(masterGain);
  osc.start(now);
  osc.stop(now + durationS + 0.02);
}

// ---- Public sound effects ----

export const sfx = {
  jump: () =>      tone(420, 720, 0.18, 'square',   0.18),
  land: () =>      noiseBurst(0.18, 240, 6, 0.30),
  wipeout: () => { tone(360, 90,  0.45, 'sawtooth', 0.30); noiseBurst(0.55, 180, 2, 0.45); },
  gate: () =>    { tone(880, 1760, 0.12, 'triangle', 0.22); tone(1320, 2640, 0.10, 'triangle', 0.16); },
  comboUp: (level: number) => {
    const base = 600 + level * 120;
    tone(base, base * 1.5, 0.18, 'triangle', 0.22);
    tone(base * 1.5, base * 2, 0.10, 'sine', 0.18);
  },
  pump: () =>     tone(220, 320, 0.08, 'sine',     0.10),
  whoosh: () =>   noiseBurst(0.16, 700, 1.2, 0.10),
  tubeIn: () =>   tone(140, 260, 0.45, 'sawtooth', 0.18),
  tubeOut: () =>  tone(260, 540, 0.20, 'triangle', 0.18),
  trick: () =>    tone(720, 1100, 0.12, 'square',   0.18),
  flip: () =>     tone(540, 920, 0.15, 'square',    0.18),
  timeWarn: () => tone(880, 880, 0.10, 'square',   0.20),
  bestRun: () => {
    tone(660,  990, 0.15, 'triangle', 0.25);
    setTimeout(() => tone(880, 1320, 0.20, 'triangle', 0.25), 120);
    setTimeout(() => tone(1100, 1760, 0.30, 'triangle', 0.28), 280);
  },
};
