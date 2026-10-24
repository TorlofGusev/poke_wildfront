# Building and hosting

The game is a static web page; no server is needed.

| Command | Output | Use |
|---|---|---|
| `npm run dev` | dev server on http://localhost:5173 | development |
| `npm run build` | `dist/` (index.html + one JS bundle) | any static host (GitHub Pages, itch.io, Netlify…) |
| `npm run build:single` | `dist-single/index.html`, one ~1.4 MB file | hosts that take a single HTML file; easy sharing |
| `npm run test:e2e` | — | opens the single-file build in headless Chromium and plays the first steps |

CI (`.github/workflows/ci.yml`) runs the tests, builds the single-file version, runs the browser smoke test and attaches `dist-single/index.html` to every run as a downloadable artifact.

## Browser support

Tested in current Chromium. The game needs WebGL or Canvas 2D and `localStorage` for saves (saves stay in that browser; clearing site data deletes them). It is played in landscape; phones held upright see a "turn your phone" message. Touch works for all actions (tap to select, tap a unit for its details).

## Hosting

Not decided yet (see the project brief). When it is, `dist/` or `dist-single/index.html` can be uploaded as-is.
