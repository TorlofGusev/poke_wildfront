import type Phaser from "phaser";
import { GAME_VERSION } from "../core/version";
import { t } from "./i18n";

/** The feedback relay (tools/feedback-worker); empty until it is deployed, which hides the button. */
export const FEEDBACK_URL = "https://wildfront-feedback.eternityfractured.workers.dev";

const SAVE_KEY = "pokemon-wildfront.save";

/**
 * The feedback form, as an HTML dialog over the game (real text input, also on phones). It sends the text with
 * the version, scene and platform; optionally a screenshot taken when it opened, the save and the given context
 * (e.g. the battle log). The game's keyboard is off while it is open.
 */
export function openFeedback(game: Phaser.Game, scene: string, context?: string): void {
  if (!FEEDBACK_URL || document.getElementById("feedback")) return;
  let screenshot: string | undefined;
  game.renderer.snapshot((img) => { screenshot = (img as HTMLImageElement).src; });
  const keyboard = game.input.keyboard;
  keyboard?.stopListeners();

  const box = document.createElement("div");
  box.id = "feedback";
  box.style.cssText = "position:fixed;inset:0;background:rgba(5,8,16,.75);display:flex;align-items:center;justify-content:center;z-index:50;font:14px monospace;color:#e8ecf4";
  const field = "width:100%;box-sizing:border-box;background:#10141c;color:#e8ecf4;border:1px solid #3a4560;padding:6px;font:inherit";
  const button = "background:#2a3245;color:#e8ecf4;border:1px solid #5a6785;padding:8px 14px;font:inherit;cursor:pointer";
  box.innerHTML = `
    <form style="background:#1c2130;border:1px solid #f5d76e;padding:16px;width:min(520px,92vw);display:flex;flex-direction:column;gap:10px">
      <div style="color:#f5d76e;font-size:18px">${t("Feedback")}</div>
      <select name="category" style="${field}">
        <option value="bug">${t("Bug")}</option>
        <option value="balance">${t("Balance")}</option>
        <option value="idea">${t("Idea")}</option>
        <option value="other">${t("Other")}</option>
      </select>
      <textarea name="text" rows="6" maxlength="5000" required placeholder="${t("What happened, or what would you change?")}" style="${field};resize:vertical"></textarea>
      <input name="website" tabindex="-1" autocomplete="off" style="display:none">
      <label><input type="checkbox" name="attach" checked> ${t("Attach a screenshot and my save")}</label>
      <div class="note" style="color:#8a93a6;min-height:1em"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button type="button" name="cancel" style="${button}">${t("Cancel")}</button>
        <button type="submit" style="${button};border-color:#f5d76e">${t("Send")}</button>
      </div>
    </form>`;
  document.body.append(box);
  const form = box.querySelector("form")!;
  const note = box.querySelector<HTMLDivElement>(".note")!;
  const close = () => {
    box.remove();
    keyboard?.startListeners();
  };
  form.querySelector<HTMLButtonElement>("[name=cancel]")!.onclick = close;
  form.querySelector("textarea")!.focus();
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const data = new FormData(form);
    const attach = data.get("attach") === "on";
    const send = form.querySelector<HTMLButtonElement>("[type=submit]")!;
    send.disabled = true;
    note.textContent = t("Sending…");
    try {
      const res = await fetch(FEEDBACK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: data.get("category"),
          text: data.get("text"),
          website: data.get("website"),
          version: GAME_VERSION,
          scene,
          platform: `${navigator.userAgent} · ${window.innerWidth}×${window.innerHeight}`,
          context,
          ...(attach && { screenshot, save: localStorage.getItem(SAVE_KEY) ?? undefined }),
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      note.textContent = t("Thank you! Your feedback was sent.");
      setTimeout(close, 1500);
    } catch {
      note.textContent = t("Could not send it. Please try again later.");
      send.disabled = false;
    }
  };
}
