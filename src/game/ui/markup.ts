/**
 * Tiny inline colour markup for UI text: `{key|text}` colours `text` by `key`
 * (a Pokémon type, or a semantic key such as dmg, heal, status, player, enemy).
 * Kept free of Phaser so it can be unit tested.
 */
export interface Segment {
  readonly text: string;
  readonly key?: string;
}

const TOKEN = /\{([a-z-]+)\|([^{}]*)\}/g;

export function parseMarkup(s: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of s.matchAll(TOKEN)) {
    if (m.index! > last) out.push({ text: s.slice(last, m.index) });
    out.push({ text: m[2]!, key: m[1]! });
    last = m.index! + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}

export const stripMarkup = (s: string): string => s.replace(TOKEN, "$2");

/** Wraps text in a colour key; braces and pipes in the text are dropped so markup stays well-formed. */
export const tag = (key: string, text: string | number): string => `{${key}|${String(text).replace(/[{}|]/g, "")}}`;
