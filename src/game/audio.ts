import Phaser from "phaser";
import { CONTENT } from "../content";
import { setMusicLevel } from "./music";
import { playBlips, type Blip, type Duty } from "./gbSynth";

/**
 * Sound: the classic Gen 1 Pokémon cries (PokeAPI cries, "legacy" set) and Game Boy–style effects
 * synthesised with Web Audio (gbSynth), so effects need no files. Muting is remembered per browser.
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

/**
 * Effects in the style of the Gen 1 handhelds (see gbSynth): pulse jingles with GB duty cycles, pitch
 * sweeps, and the noise channel for hits and doors. Original sounds, made to feel like the era.
 */
const N = (freq: number, dur: number, duty: Duty = 0.5, vol = 1): Blip => ({ ch: "pulse", freq, dur, duty, vol });
const PATTERNS: Record<Sfx, readonly Blip[]> = {
  // Menu cursor: a short thin blip.
  select: [N(1760, 0.035, 0.125, 0.7)],
  // A hit: a burst of noise falling in brightness, with a low thump.
  hit: [{ ch: "noise", freq: 6000, to: 800, dur: 0.12 }, { ch: "pulse", freq: 180, to: 70, dur: 0.1, duty: 0.5, vol: 0.6, at: 0 }],
  // Super effective: a harder, longer crunch.
  superHit: [{ ch: "noise", freq: 9000, to: 400, dur: 0.2, vol: 1.2 }, { ch: "pulse", freq: 260, to: 55, dur: 0.18, duty: 0.25, vol: 0.8, at: 0 }, { ch: "noise", freq: 3000, to: 300, dur: 0.12, vol: 0.8, at: 0.12 }],
  // Not very effective: a dull tap.
  weakHit: [{ ch: "noise", freq: 1800, to: 500, dur: 0.08, vol: 0.6 }],
  // Healing: a bright rising arpeggio.
  heal: [N(784, 0.06, 0.125), N(988, 0.06, 0.125), N(1175, 0.06, 0.125), N(1568, 0.16, 0.125)],
  // A status takes hold: a wobbling falling sweep.
  status: [{ ch: "pulse", freq: 900, to: 500, dur: 0.09, duty: 0.25 }, { ch: "pulse", freq: 800, to: 420, dur: 0.09, duty: 0.25 }, { ch: "pulse", freq: 700, to: 300, dur: 0.14, duty: 0.25 }],
  // Fainting: the long falling tone of the handhelds.
  faint: [{ ch: "pulse", freq: 600, to: 60, dur: 0.6, duty: 0.5 }],
  // The ball: pop, three wobbles, click.
  capture: [{ ch: "pulse", freq: 300, to: 1600, dur: 0.12, duty: 0.25 }, { ch: "noise", freq: 2500, to: 600, dur: 0.05, at: 0.3 }, { ch: "noise", freq: 2500, to: 600, dur: 0.05, at: 0.35 }, { ch: "noise", freq: 2500, to: 600, dur: 0.05, at: 0.35 }, N(1319, 0.05, 0.5, 0.9), N(1760, 0.18, 0.5, 0.9)],
  // Level up: a short fanfare.
  levelUp: [N(1047, 0.08, 0.25), N(1047, 0.08, 0.25), N(1047, 0.08, 0.25), N(1397, 0.24, 0.25), N(1319, 0.1, 0.25), N(1568, 0.3, 0.25)],
  victory: [N(784, 0.1, 0.25), N(988, 0.1, 0.25), N(1175, 0.1, 0.25), N(1568, 0.4, 0.25)],
  defeat: [N(494, 0.2, 0.5), N(440, 0.2, 0.5), N(370, 0.2, 0.5), { ch: "pulse", freq: 330, to: 110, dur: 0.5, duty: 0.5 }],
  // A wild Pokémon appears: a rapid trill rising into the battle.
  encounter: [N(1047, 0.04, 0.25), N(1175, 0.04, 0.25), N(1047, 0.04, 0.25), N(1175, 0.04, 0.25), N(1319, 0.04, 0.25), N(1397, 0.04, 0.25), { ch: "pulse", freq: 400, to: 1800, dur: 0.25, duty: 0.125 }],
  // Item found.
  pickup: [N(1319, 0.06, 0.5), N(1568, 0.06, 0.5), N(2093, 0.14, 0.5)],
  // Doors and map changes: a step of noise and a falling blip.
  warp: [{ ch: "noise", freq: 1500, to: 300, dur: 0.1 }, { ch: "pulse", freq: 700, to: 250, dur: 0.14, duty: 0.25, vol: 0.7 }],
  // Text box advance.
  talk: [N(2093, 0.025, 0.125, 0.5)],
  buy: [N(1568, 0.05, 0.5), N(2093, 0.14, 0.5)],
};

export function sfx(scene: Phaser.Scene, name: Sfx): void {
  if (muted || volume <= 0) return;
  const ctx = (scene.sound as Partial<Phaser.Sound.WebAudioSoundManager>).context;
  if (!ctx) return;
  // A still-locked context (first click of the session) plays the effect as soon as it resumes.
  if (ctx.state !== "running") {
    ctx.resume().then(() => playBlips(ctx, ctx.destination, PATTERNS[name], volume), () => undefined);
    return;
  }
  playBlips(ctx, ctx.destination, PATTERNS[name], volume);
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
  // A hidden tab goes quiet (a phone browser would keep playing in the background); its clock stops too, so the music picks up where it was.
  document.addEventListener("visibilitychange", () => {
    const ctx = (game.sound as Partial<Phaser.Sound.WebAudioSoundManager>).context;
    if (!ctx) return;
    if (document.hidden) ctx.suspend().catch(() => undefined);
    else unlock();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "m" || e.key === "M") toggleMute(game);
  });
}
