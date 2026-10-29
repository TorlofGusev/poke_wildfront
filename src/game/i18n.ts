import { LANG } from "../content/lang";

/**
 * UI text: English strings are the keys; Hungarian lives in i18n/hu/*.json (one file per area,
 * merged), as { "English text with {name}": "Magyar szöveg {name}" }. Missing entries stay English.
 */
const HU: Record<string, string> = Object.assign(
  {},
  ...Object.values(import.meta.glob("./i18n/hu/*.json", { eager: true, import: "default" }) as Record<string, Record<string, string>>),
);

/** Translates a UI string and fills `{name}` placeholders. */
export function t(en: string, vars?: Readonly<Record<string, string | number>>): string {
  const s = LANG === "hu" ? (HU[en] ?? en) : en;
  const out = vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
  return LANG === "hu" ? article(out) : out;
}

/** "a(z) Pidgeotto" → "a Pidgeotto", "a(z) Ekans" → "az Ekans": the article that fits the next word's sound. */
function article(s: string): string {
  return s.replace(/\b([Aa])\(z\)(\s+)(\S)/g, (_m, a: string, sp: string, c: string) => `${a}${/[aáeéiíoóöőuúüű15]/i.test(c) ? "z" : ""}${sp}${c}`);
}
