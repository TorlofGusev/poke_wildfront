# Feedback relay

Turns the in-game "Feedback" form into GitHub issues. Screenshots and saves go to the `feedback-assets` branch.

## Setup (once)

1. **GitHub token.** Go to GitHub → Settings → Developer settings → Fine-grained tokens → *Generate new token*.
   - Repository access: only `poke_wildfront`.
   - Permissions: **Issues: Read and write**, **Contents: Read and write**.
2. **Asset branch.** Create an empty `feedback-assets` branch:
   `git switch --orphan feedback-assets && git commit --allow-empty -m "feedback assets" && git push origin feedback-assets && git switch main`
3. **Labels.** Create the labels `feedback`, `bug`, `balance`, `idea` and `other` in the repo (Issues → Labels).
4. **Deploy.** In this folder:
   ```
   npx wrangler login
   npx wrangler secret put GITHUB_TOKEN     (paste the token)
   npx wrangler deploy
   ```
   Wrangler prints the Worker's URL, e.g. `https://wildfront-feedback.<you>.workers.dev`.
5. **Hosts.** Put every address the game is played from into `ALLOWED_ORIGINS` in `wrangler.toml`
   (e.g. the Cloudflare Pages address too), then run `npx wrangler deploy` again.
6. **Game.** Put the Worker URL into `FEEDBACK_URL` in `src/game/feedback.ts`, and push.
