import { defineConfig } from "vite";

// Relative base so the build works under any GitHub Pages sub-path.
export default defineConfig({
  base: "./",
  // Inline every asset (sprites are small) so the build is fully self-contained.
  build: { target: "es2022", chunkSizeWarningLimit: 4000, assetsInlineLimit: 100_000 },
});
