import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("architecture", () => {
  it("keeps src/core free of Phaser, DOM and Math.random", () => {
    const offenders = files("src/core")
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => {
        const src = readFileSync(f, "utf8");
        return /from\s+["']phaser["']|\bwindow\.|\bdocument\.|Math\.random/.test(src);
      });
    expect(offenders).toEqual([]);
  });
});
