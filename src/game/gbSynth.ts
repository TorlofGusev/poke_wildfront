/**
 * A small Game Boy–style sound chip on Web Audio, so effects sound like the handheld Pokémon games
 * without any sound files: two pulse channels with the GB duty cycles (12.5%, 25%, 50%, 75%), pitch
 * sweeps like the GB's sweep unit, and a noise channel (hits, doors, the ball pop). All tones are original.
 */
export type Duty = 0.125 | 0.25 | 0.5 | 0.75;

/** One sound event: a pulse tone (optionally sweeping from `freq` to `to`) or a noise burst. */
export interface Blip {
  readonly ch: "pulse" | "noise" | "wave";
  readonly freq: number;
  /** Sweep target; pulse/wave pitch or noise brightness glides to it over the blip. */
  readonly to?: number;
  readonly dur: number;
  readonly duty?: Duty;
  /** Loudness 0–1 of this blip (scaled by the master volume). */
  readonly vol?: number;
  /** Seconds after the previous blip starts; defaults to the previous blip's length (back to back). */
  readonly at?: number;
}

const waves = new WeakMap<BaseAudioContext, Map<number, PeriodicWave>>();
const noises = new WeakMap<BaseAudioContext, AudioBuffer>();

/** A pulse wave with the given duty cycle (Fourier series of a rectangle wave). */
export function pulseWave(ctx: BaseAudioContext, duty: Duty): PeriodicWave {
  let byDuty = waves.get(ctx);
  if (!byDuty) waves.set(ctx, (byDuty = new Map()));
  const cached = byDuty.get(duty);
  if (cached) return cached;
  const n = 48;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let k = 1; k < n; k++) imag[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
  const wave = ctx.createPeriodicWave(real, imag);
  byDuty.set(duty, wave);
  return wave;
}

/** One second of white noise, as the GB's noise channel. */
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const cached = noises.get(ctx);
  if (cached) return cached;
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buf.getChannelData(0);
  // A 15-bit LFSR like the GB's, for its gritty character.
  let lfsr = 0x7fff;
  for (let i = 0; i < data.length; i++) {
    const bit = (lfsr ^ (lfsr >> 1)) & 1;
    lfsr = (lfsr >> 1) | (bit << 14);
    data[i] = lfsr & 1 ? 0.8 : -0.8;
  }
  noises.set(ctx, buf);
  return buf;
}

/** Plays a sequence of blips into `out`, starting at `start`; returns when the last one ends. */
export function playBlips(ctx: AudioContext, out: AudioNode, blips: readonly Blip[], volume: number, start = ctx.currentTime): number {
  let t = start;
  let end = start;
  let prevDur = 0;
  for (const b of blips) {
    t += b.at ?? prevDur;
    prevDur = b.dur;
    const g = ctx.createGain();
    const peak = (b.vol ?? 1) * volume * 0.09;
    g.gain.setValueAtTime(peak, t);
    // GB envelopes step down; an exponential fade is close enough.
    g.gain.exponentialRampToValueAtTime(0.0001, t + b.dur);
    g.connect(out);
    if (b.ch === "noise") {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx);
      src.loop = true;
      // Brightness: a low-pass whose cutoff follows freq → to.
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(b.freq, t);
      if (b.to) lp.frequency.exponentialRampToValueAtTime(b.to, t + b.dur);
      src.connect(lp).connect(g);
      src.start(t);
      src.stop(t + b.dur);
    } else {
      const osc = ctx.createOscillator();
      if (b.ch === "pulse") osc.setPeriodicWave(pulseWave(ctx, b.duty ?? 0.5));
      else osc.type = "triangle";
      osc.frequency.setValueAtTime(b.freq, t);
      if (b.to) osc.frequency.exponentialRampToValueAtTime(b.to, t + b.dur);
      osc.connect(g);
      osc.start(t);
      osc.stop(t + b.dur);
    }
    end = Math.max(end, t + b.dur);
  }
  return end;
}
