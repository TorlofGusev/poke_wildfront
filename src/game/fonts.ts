import latin600 from "@fontsource/nunito/files/nunito-latin-600-normal.woff2";
import latinExt600 from "@fontsource/nunito/files/nunito-latin-ext-600-normal.woff2";
import latin800 from "@fontsource/nunito/files/nunito-latin-800-normal.woff2";
import latinExt800 from "@fontsource/nunito/files/nunito-latin-ext-800-normal.woff2";

/**
 * The text font, bundled (inlined into the build) so it looks and measures the same on every computer and phone:
 * Nunito, a rounded sans, at 600 for text and 800 for bold. Latin-ext carries the Hungarian ő and ű.
 */
export const TEXT_FONT_FAMILY = "Nunito";

const LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const LATIN_EXT = "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";

let ready: Promise<void> | null = null;

/** Registers and loads the text font once; resolves when text can be measured with it (or it failed: system fallback). */
export function loadTextFont(): Promise<void> {
  ready ??= (async () => {
    if (typeof document === "undefined" || typeof FontFace === "undefined") return;
    const faces = [
      [latin600, "600", LATIN], [latinExt600, "600", LATIN_EXT], [latin800, "800", LATIN], [latinExt800, "800", LATIN_EXT],
    ].map(([url, weight, range]) => new FontFace(TEXT_FONT_FAMILY, `url(${url})`, { weight, unicodeRange: range }));
    faces.forEach((f) => document.fonts.add(f));
    await Promise.all(faces.map((f) => f.load())).then(() => undefined, () => undefined);
  })();
  return ready;
}
