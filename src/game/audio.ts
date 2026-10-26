import Phaser from "phaser";
import { CONTENT } from "../content";
import { setMusicLevel } from "./music";

/**
 * Sound: the classic Gen 1 Pokémon cries (PokeAPI cries, "legacy" set) and small chiptune effects
 * synthesised with Web Audio, so effects need no files. Muting is remembered per browser.
 */
const CRIES = import.meta.glob("../assets/cries/*.ogg", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const cryUrl = (dex: number) => CRIES[`../assets/cries/${String(dex).padStart(4, "0")}.ogg`];
const cryKey = (speciesId: string) => `${speciesId}-cry`;
const MUTE_KEY = "wildfront:muted";
const VOLUME_KEY = "wildfront:volume";

let muted = (() => {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
})();

let volume = (() => {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY));
    return localStorage.getItem(VOLUME_KEY) !== null && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.8;
  } catch {
    return 0.8;
  }
})();

export const isMuted = (): boolean => muted;
export const getVolume = (): number => volume;

/** Music plays at about half the loudness of effects. */
const MUSIC_SHARE = 0.5;
const syncMusic = () => setMusicLevel(muted ? 0 : volume * MUSIC_SHARE);

/** Master volume 0–1 for cries and effects; remembered per browser. */
export function setVolume(game: Phaser.Game, value: number): void {
  volume = Math.min(1, Math.max(0, value));
  game.sound.volume = volume;
  syncMusic();
  try {
    localStorage.setItem(VOLUME_KEY, String(volume));
  } catch {
    // Storage blocked: the volume still applies for this session.
  }
}

export function toggleMute(game: Phaser.Game): boolean {
  muted = !muted;
  game.sound.mute = muted;
  syncMusic();
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    // Storage blocked: muting still works for this session.
  }
  return muted;
}

export function preloadCries(scene: Phaser.Scene): void {
  for (const s of Object.values(CONTENT.species)) {
    const url = s.dex ? cryUrl(s.dex) : undefined;
    if (url) scene.load.audio(cryKey(s.id), url);
  }
}

/** Plays a species' cry; a lower `rate` sounds like the classic fainting cry. */
export function playCry(scene: Phaser.Scene, speciesId: string, rate = 1): void {
  if (muted || !scene.cache.audio.exists(cryKey(speciesId))) return;
  scene.sound.play(cryKey(speciesId), { volume: 0.45, rate });
}

export type Sfx = "select" | "hit" | "superHit" | "weakHit" | "heal" | "status" | "faint" | "capture" | "levelUp" | "victory" | "defeat" | "encounter" | "pickup" | "warp" | "talk" | "buy";

/** Note sequences: [frequency Hz, duration s, wave][]. */
const PATTERNS: Record<Sfx, [number, number, OscillatorType][]> = {
  select: [[880, 0.05, "square"]],
  hit: [[220, 0.06, "square"], [140, 0.08, "square"]],
  superHit: [[330, 0.05, "square"], [220, 0.05, "square"], [110, 0.12, "sawtooth"]],
  weakHit: [[160, 0.08, "triangle"]],
  heal: [[523, 0.07, "triangle"], [659, 0.07, "triangle"], [784, 0.12, "triangle"]],
  status: [[392, 0.06, "square"], [370, 0.06, "square"], [349, 0.1, "square"]],
  faint: [[392, 0.1, "square"], [294, 0.1, "square"], [196, 0.22, "square"]],
  capture: [[659, 0.08, "square"], [784, 0.08, "square"], [988, 0.08, "square"], [1319, 0.2, "square"]],
  levelUp: [[523, 0.08, "square"], [659, 0.08, "square"], [784, 0.08, "square"], [1047, 0.25, "square"]],
  victory: [[784, 0.1, "square"], [784, 0.1, "square"], [784, 0.1, "square"], [1047, 0.35, "square"]],
  defeat: [[330, 0.18, "triangle"], [262, 0.18, "triangle"], [196, 0.4, "triangle"]],
  encounter: [[523, 0.05, "square"], [494, 0.05, "square"], [523, 0.05, "square"], [494, 0.05, "square"], [392, 0.12, "square"]],
  pickup: [[784, 0.05, "square"], [1175, 0.09, "square"]],
  warp: [[392, 0.06, "triangle"], [523, 0.06, "triangle"], [659, 0.1, "triangle"]],
  talk: [[660, 0.03, "square"], [880, 0.03, "square"]],
  buy: [[988, 0.05, "square"], [1319, 0.12, "square"]],
};

export function sfx(scene: Phaser.Scene, name: Sfx): void {
  if (muted || volume <= 0) return;
  const ctx = (scene.sound as Partial<Phaser.Sound.WebAudioSoundManager>).context;
  if (!ctx) return;
  // A still-locked context (first click of the session) plays the effect as soon as it resumes.
  if (ctx.state !== "running") {
    ctx.resume().then(() => playPattern(ctx, name), () => undefined);
    return;
  }
  playPattern(ctx, name);
}

function playPattern(ctx: AudioContext, name: Sfx): void {
  let t = ctx.currentTime;
  for (const [freq, dur, wave] of PATTERNS[name]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = wave;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.06 * volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
    t += dur;
  }
}

/** M toggles sound everywhere; the first click or key press unlocks the browser's audio. */
export function setupAudio(game: Phaser.Game): void {
  game.sound.mute = muted;
  game.sound.volume = volume;
  syncMusic();
  const unlock = () => {
    const ctx = (game.sound as Partial<Phaser.Sound.WebAudioSoundManager>).context;
    if (ctx && ctx.state !== "running") ctx.resume().catch(() => undefined);
  };
  for (const type of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(type, unlock, { capture: true });
  window.addEventListener("keydown", (e) => {
    if (e.key === "m" || e.key === "M") toggleMute(game);
  });
}
