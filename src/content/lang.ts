/**
 * Game language. English is the source; Hungarian comes from overlay files in i18n/hu/ that mirror
 * the content files but hold only the translated text (descriptions, dialogue). Names stay English.
 * The choice is remembered per browser; switching reloads the page so content is rebuilt.
 */

export type Lang = "en" | "hu";
export const LANG_KEY = "pokemon-wildfront.lang";

function detect(): Lang {
  try {
    const saved = globalThis.localStorage?.getItem(LANG_KEY);
    if (saved === "en" || saved === "hu") return saved;
    return globalThis.navigator?.language?.toLowerCase().startsWith("hu") ? "hu" : "en";
  } catch {
    return "en";
  }
}

/** Tests and Node always run in English. */
export const LANG: Lang = typeof window === "undefined" ? "en" : detect();

export function setLang(lang: Lang): void {
  try {
    globalThis.localStorage?.setItem(LANG_KEY, lang);
  } catch {
    // Storage blocked: the switch lasts until reload only.
  }
}

const HU_FILES = import.meta.glob("./i18n/hu/**/*.json", { eager: true, import: "default" }) as Record<string, unknown>;

/**
 * Lays translated text over content: objects merge key by key, arrays of objects merge by `id`
 * (or position), and strings or string arrays are replaced.
 */
export function overlay<T>(base: T, over: unknown): T {
  if (over === undefined || over === null) return base;
  if (typeof over === "string" || typeof base !== "object" || base === null) return over as T;
  if (Array.isArray(base)) {
    if (!Array.isArray(over)) return base;
    if (base.every((b) => typeof b !== "object" || b === null)) return over as T;
    return base.map((b, i) => {
      const id = (b as { id?: unknown }).id;
      const o = id !== undefined ? over.find((x) => (x as { id?: unknown })?.id === id) : over[i];
      return overlay(b, o);
    }) as T;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) if (k in out) out[k] = overlay(out[k], v);
  return out as T;
}

/** The content file at `path` (relative to src/content, e.g. "talents.json") in the current language. */
export function localized<T>(path: string, data: T): T {
  return LANG === "hu" ? overlay(data, HU_FILES[`./i18n/hu/${path}`]) : data;
}
