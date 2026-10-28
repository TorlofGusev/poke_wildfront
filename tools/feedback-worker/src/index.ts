/**
 * Feedback relay: the game posts a report here and it becomes a GitHub issue (labelled `feedback` plus its
 * category). The screenshot and the save go to the `feedback-assets` branch, and the issue links them.
 * The GitHub token stays a Worker secret, never in the game.
 */

interface Env {
  /** Fine-grained token for this repo only: Issues read/write, Contents read/write. */
  GITHUB_TOKEN: string;
  /** "owner/name". */
  REPO: string;
  /** Comma-separated origins allowed to post (the game's hosts). */
  ALLOWED_ORIGINS: string;
}

interface Report {
  category: "bug" | "balance" | "idea" | "other";
  text: string;
  version: string;
  scene: string;
  platform: string;
  /** Extra context, e.g. the battle log. */
  context?: string;
  /** PNG data URL. */
  screenshot?: string;
  save?: string;
  /** Honeypot: people never fill it, bots do. */
  website?: string;
}

const CATEGORIES = ["bug", "balance", "idea", "other"];
const MAX_BODY = 3_000_000;
const ASSET_BRANCH = "feedback-assets";
/** Reports per IP per hour. */
const RATE_LIMIT = 10;
const recent = new Map<string, number[]>();

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get("Origin") ?? "";
    const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
    const cors = {
      "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0]!,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
    if (req.method !== "POST") return reply(405, { error: "POST only" });
    if (!allowed.includes(origin)) return reply(403, { error: "origin not allowed" });
    if (Number(req.headers.get("Content-Length") ?? 0) > MAX_BODY) return reply(413, { error: "too large" });

    const ip = req.headers.get("CF-Connecting-IP") ?? "?";
    const now = Date.now();
    const times = (recent.get(ip) ?? []).filter((t) => now - t < 3_600_000);
    if (times.length >= RATE_LIMIT) return reply(429, { error: "too many reports, try again later" });
    recent.set(ip, [...times, now]);

    let r: Report;
    try {
      r = await req.json();
    } catch {
      return reply(400, { error: "bad json" });
    }
    if (r.website) return reply(200, { ok: true });
    if (!CATEGORIES.includes(r.category) || typeof r.text !== "string" || !r.text.trim()) return reply(400, { error: "category and text needed" });

    const gh = (path: string, init: RequestInit = {}) => fetch(`https://api.github.com/repos/${env.REPO}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "wildfront-feedback", ...init.headers },
    });
    const id = `${new Date(now).toISOString().slice(0, 19).replace(/[:T]/g, "-")}-${Math.random().toString(36).slice(2, 6)}`;
    const upload = async (name: string, base64: string): Promise<string | null> => {
      const res = await gh(`/contents/${id}/${name}`, { method: "PUT", body: JSON.stringify({ message: `feedback ${id}: ${name}`, content: base64, branch: ASSET_BRANCH }) });
      return res.ok ? `https://github.com/${env.REPO}/blob/${ASSET_BRANCH}/${id}/${name}` : null;
    };
    const links: string[] = [];
    let image = "";
    if (r.screenshot?.startsWith("data:image/png;base64,")) {
      const url = await upload("screenshot.png", r.screenshot.slice("data:image/png;base64,".length));
      if (url) image = `\n\n![screenshot](${url}?raw=true)`;
    }
    if (r.save) {
      const url = await upload("save.json", btoa(unescape(encodeURIComponent(r.save))));
      if (url) links.push(`[save](${url})`);
    }

    const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
    const body = [
      clip(r.text.trim(), 5000),
      image,
      "",
      "| | |",
      "|---|---|",
      `| Version | ${clip(String(r.version), 40)} |`,
      `| Scene | ${clip(String(r.scene), 80)} |`,
      `| Platform | ${clip(String(r.platform), 200)} |`,
      ...(links.length ? [`| Files | ${links.join(" · ")} |`] : []),
      ...(r.context ? ["", "<details><summary>Context</summary>", "", "```", clip(r.context, 20000), "```", "</details>"] : []),
    ].join("\n");
    const title = `[${r.category}] ${clip(r.text.trim().split("\n")[0]!, 80)}`;
    const res = await gh("/issues", { method: "POST", body: JSON.stringify({ title, body, labels: ["feedback", r.category] }) });
    if (!res.ok) return reply(502, { error: "could not file the report" });
    return reply(200, { ok: true });
  },
};
