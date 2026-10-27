import Phaser from "phaser";
import { pulseWave } from "./gbSynth";

/**
 * Background music: a tiny chiptune step sequencer on Web Audio (original tunes, no files).
 * Each track is 16th-note steps per voice: a note like "C5" starts, "-" holds it, "." rests.
 * Notes are scheduled slightly ahead by a timer so playback stays in time.
 */
export type MusicTrack = "title" | "overworld" | "battle" | "victory";

interface VoiceDef {
  readonly wave: OscillatorType;
  readonly gain: number;
  readonly score: string;
}

interface TrackDef {
  readonly bpm: number;
  readonly loop: boolean;
  readonly voices: readonly VoiceDef[];
}

const TRACKS: Record<MusicTrack, TrackDef> = {
  title: {
    bpm: 100,
    loop: true,
    voices: [
      {
        wave: "square",
        gain: 0.05,
        score: `C5 - - - E5 - G5 - A5 - - - G5 - E5 -  F5 - - - E5 - D5 - E5 - - - - - . .
                C5 - - - E5 - G5 - C6 - - - B5 - A5 -  G5 - F5 - D5 - E5 - C5 - - - - - . .`,
      },
      {
        wave: "triangle",
        gain: 0.1,
        score: `C3 - . . G3 - . . C3 - . . G3 - . .  F2 - . . C3 - . . G2 - . . D3 - . .
                A2 - . . E3 - . . A2 - . . E3 - . .  G2 - . . D3 - . . C3 - . . G2 - . .`,
      },
    ],
  },
  overworld: {
    bpm: 88,
    loop: true,
    voices: [
      {
        wave: "square",
        gain: 0.04,
        score: `E5 - - - D5 - C5 - D5 - - - . . G4 -  A4 - - - C5 - D5 - E5 - - - - - . .
                F5 - - - E5 - D5 - C5 - - - A4 - - -  B4 - - - C5 - D5 - C5 - - - - - . .`,
      },
      {
        wave: "triangle",
        gain: 0.1,
        score: `C3 - . . G3 - . . C3 - . . G3 - . .  A2 - . . E3 - . . A2 - . . E3 - . .
                F2 - . . C3 - . . F2 - . . C3 - . .  G2 - . . D3 - . . C3 - . . G2 - . .`,
      },
    ],
  },
  battle: {
    bpm: 150,
    loop: true,
    voices: [
      {
        wave: "square",
        gain: 0.045,
        score: `A4 . A4 . C5 - A4 . E5 - - - D5 - C5 -  B4 . B4 . D5 - B4 . G5 - - - F5 - E5 -
                A4 . A4 . C5 - E5 . A5 - - - G5 - E5 -  F5 - E5 - D5 - B4 - C5 - B4 - G#4 - - -`,
      },
      {
        wave: "triangle",
        gain: 0.11,
        score: `A2 . A3 . A2 . A3 . A2 . A3 . A2 . A3 .  G2 . G3 . G2 . G3 . G2 . G3 . G2 . G3 .
                F2 . F3 . F2 . F3 . F2 . F3 . F2 . F3 .  E2 . E3 . E2 . E3 . E2 . E3 . E2 . E3 .`,
      },
    ],
  },
  victory: {
    bpm: 140,
    loop: false,
    voices: [
      { wave: "square", gain: 0.05, score: "G4 - C5 - E5 - G5 - - - E5 - G5 - - -  C6 - - - - - - - - - - - . . . ." },
      { wave: "triangle", gain: 0.1, score: "C3 - - - - - - - G2 - - - - - - -  C3 - - - - - - - - - - - . . . ." },
    ],
  },
};

const SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "G#4" → frequency in Hz. */
function noteFreq(note: string): number {
  const m = /^([A-G])(#?)(\d)$/.exec(note);
  if (!m) throw new Error(`Bad note ${note}`);
  const midi = 12 * (Number(m[3]) + 1) + SEMITONES[m[1]!]! + (m[2] ? 1 : 0);
  return 440 * 2 ** ((midi - 69) / 12);
}

interface NoteEvent {
  readonly freq: number;
  readonly steps: number;
}

/** Per step: the note starting there, if any. */
function parseScore(score: string): (NoteEvent | undefined)[] {
  const tokens = score.trim().split(/\s+/);
  const events: (NoteEvent | undefined)[] = tokens.map(() => undefined);
  tokens.forEach((tok, i) => {
    if (tok === "-" || tok === ".") return;
    let steps = 1;
    while (tokens[i + steps] === "-") steps++;
    events[i] = { freq: noteFreq(tok), steps };
  });
  return events;
}

const PARSED = Object.fromEntries(
  Object.entries(TRACKS).map(([k, t]) => [k, t.voices.map((v) => ({ ...v, events: parseScore(v.score) }))]),
) as Record<MusicTrack, (VoiceDef & { events: (NoteEvent | undefined)[] })[]>;

const LOOKAHEAD = 0.15;
const TICK_MS = 30;
const FADE = 0.4;

interface Playing {
  readonly name: MusicTrack;
  readonly out: GainNode;
  readonly timer: ReturnType<typeof setInterval>;
}

let level = 0;
let master: GainNode | null = null;
let current: Playing | null = null;

/** Music loudness 0–1 (master volume × music share, 0 when muted); applies to a playing track at once. */
export function setMusicLevel(value: number): void {
  level = value;
  if (master) master.gain.setTargetAtTime(level, master.context.currentTime, 0.05);
}

function contextOf(scene: Phaser.Scene): AudioContext | undefined {
  return (scene.sound as Partial<Phaser.Sound.WebAudioSoundManager>).context;
}

function fadeOut(p: Playing): void {
  clearInterval(p.timer);
  const t = p.out.context.currentTime;
  p.out.gain.cancelScheduledValues(t);
  p.out.gain.setValueAtTime(p.out.gain.value, t);
  p.out.gain.linearRampToValueAtTime(0, t + FADE);
  setTimeout(() => p.out.disconnect(), FADE * 1000 + 600);
}

/** Starts a track (fading out the previous one); asking for the track already playing changes nothing. */
export function playMusic(scene: Phaser.Scene, name: MusicTrack): void {
  if (current?.name === name) return;
  const ctx = contextOf(scene);
  if (!ctx) return;
  if (!master || master.context !== ctx) {
    master = ctx.createGain();
    master.gain.value = level;
    master.connect(ctx.destination);
  }
  if (current) fadeOut(current);
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, ctx.currentTime);
  out.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.2);
  out.connect(master);

  const voices = PARSED[name];
  const def = TRACKS[name];
  const length = Math.max(...voices.map((v) => v.events.length));
  const stepDur = 60 / def.bpm / 4;
  let step = 0;
  // While the context is still locked its clock stands still, so nothing piles up before unlock.
  let next = ctx.currentTime + 0.05;
  const tick = () => {
    while (next < ctx.currentTime + LOOKAHEAD) {
      if (step >= length) {
        if (!def.loop) {
          clearInterval(timer);
          if (current?.out === out) current = null;
          return;
        }
        step = 0;
      }
      for (const v of voices) {
        const e = v.events[step];
        if (e) playNote(ctx, out, v.wave, v.gain, e.freq, next, e.steps * stepDur);
      }
      step++;
      next += stepDur;
    }
  };
  const timer = setInterval(tick, TICK_MS);
  current = { name, out, timer };
  tick();
}

/** Fades out whatever is playing. */
export function stopMusic(): void {
  if (current) fadeOut(current);
  current = null;
}

function playNote(ctx: AudioContext, out: AudioNode, wave: OscillatorType, gain: number, freq: number, t: number, dur: number): void {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  // Square voices play on the GB pulse channel (25% duty), the rest as written.
  if (wave === "square") osc.setPeriodicWave(pulseWave(ctx, 0.25));
  else osc.type = wave;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.008);
  g.gain.setValueAtTime(gain * 0.8, t + dur * 0.5);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.95);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + dur);
}
