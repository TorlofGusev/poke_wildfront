// Inlines the Vite build into one self-contained HTML file (dist-single/index.html),
// so the game can be hosted anywhere that serves a single page.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dist = "dist";
const html = readFileSync(join(dist, "index.html"), "utf8");
const scripts = readdirSync(join(dist, "assets")).filter((f) => f.endsWith(".js"));
if (scripts.length !== 1) throw new Error(`expected one bundle in dist/assets, found ${scripts.length}`);
const js = readFileSync(join(dist, "assets", scripts[0]), "utf8").replaceAll("</script", "<\\/script");

const tag = /<script type="module" crossorigin src="[^"]+"><\/script>/;
if (!tag.test(html)) throw new Error("bundle <script> tag not found in dist/index.html");
const single = html.replace(tag, () => `<script type="module">\n${js}\n</script>`);

mkdirSync("dist-single", { recursive: true });
writeFileSync(join("dist-single", "index.html"), single);
console.log(`dist-single/index.html: ${(single.length / 1024).toFixed(0)} KiB`);
