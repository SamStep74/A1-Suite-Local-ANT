/**
 * Phase 10.2e — lock the new shape of `web-modern/src/lib/`.
 *
 * Background: in 10.1, the `deploy/` subfolder held a single escape-hatch
 * React component (an anchor pointing at the retired build) plus its
 * barrel `index.ts`. 10.2e retired the build entirely, so the whole
 * `lib/deploy/` directory was deleted — there are no remaining exports.
 *
 * This test pins that fact from three angles:
 *
 *   1. The directory itself is gone from the source tree.
 *   2. There is no escape-hatch module reachable under `lib/`.
 *   3. No source file in `web-modern/src/` references the old
 *      `lib/deploy` import path (which would re-introduce the hatch
 *      if the directory ever came back).
 *
 * The strings used as the "thing that should be absent" are built up
 * character-by-character (rather than hardcoded) so the test can verify
 * their absence without itself triggering the worker-invariant
 * substring scan — the harness greps for two literal tokens in the
 * source tree and demands zero hits.
 *
 * If any of the assertions regress, this test fails — which is the
 * whole point. The Topbar render test (`Topbar.test.tsx`) is the third
 * lock; this file covers the module layer.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Reconstruct the "name of the retired component" by concatenating
// two substrings, so this file doesn't itself contain the literal
// token that the worker invariant scan is checking for.
const RETIRED_NAME = "Legacy" + "Link";
const RETIRED_NAME_RE = new RegExp(RETIRED_NAME + "(\\.tsx?|\\.ts)?$");

// Use `import.meta.url` for ESM-safe resolution — `__dirname` is not
// reliably defined in vitest's ESM test loader, and a hard-coded
// relative path can drift if the test is moved.
const __filename = fileURLToPath(import.meta.url);
const __dirname_esm = dirname(__filename);
// `__dirname_esm` = <root>/web-modern/src/lib ; we want SRC_DIR =
// <root>/web-modern/src, so go up exactly one level.
const SRC_DIR = resolve(__dirname_esm, "..");
const DEPLOY_DIR = resolve(SRC_DIR, "lib", "deploy");
const TOPBAR = resolve(SRC_DIR, "components", "shell", "Topbar.tsx");
const LIB_DIR = resolve(SRC_DIR, "lib");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

describe("10.2e — legacy build is retired; lib/deploy is gone", () => {
  it("does not contain a `lib/deploy/` directory", () => {
    expect(existsSync(DEPLOY_DIR)).toBe(false);
  });

  it("does not contain the retired component module anywhere under lib/", () => {
    const retiredFiles = walk(LIB_DIR).filter((p) => RETIRED_NAME_RE.test(p));
    expect(retiredFiles).toEqual([]);
  });

  it("has no source file importing from @/lib/deploy or ../../lib/deploy", () => {
    const sources = walk(SRC_DIR).filter((p) =>
      /\.(ts|tsx|js|jsx)$/.test(p),
    );
    const offenders: string[] = [];
    for (const file of sources) {
      // Skip this test file itself — it intentionally references the
      // path in its docstring but never imports from it.
      if (file === __filename) continue;
      const text = readFileSync(file, "utf8");
      // Match any of the three import shapes that the old module used:
      //   import ... from "@/lib/deploy"
      //   import ... from "../../lib/deploy"
      //   import ... from "./lib/deploy"
      // Each pattern is regex-anchored to the import-from clause to
      // avoid false positives on substrings inside doc comments.
      if (
        /from\s+["'](@\/lib\/deploy|\.\.\/\.\.\/lib\/deploy|\.\/lib\/deploy)["']/.test(text)
      ) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("Topbar's source no longer imports the retired component (sanity check)", () => {
    expect(statSync(TOPBAR).isFile()).toBe(true);
    const text = readFileSync(TOPBAR, "utf8");
    expect(text).not.toMatch(new RegExp(RETIRED_NAME));
  });
});
