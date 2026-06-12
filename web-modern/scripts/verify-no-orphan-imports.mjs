#!/usr/bin/env node
/**
 * verify-no-orphan-imports.mjs
 *
 * Anti-regression: after deps are removed, this script fails if any source
 * file still imports them. Walk web-modern/src and web-modern/e2e (and
 * web-modern/scripts for completeness) for the dead-dep names and exit
 * non-zero on any hit.
 *
 * Phase 10.0 D3 — see .orchestration/phase10-hygiene/plan.md.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const SCAN_ROOTS = ["src", "e2e", "scripts"].map((p) => join(REPO_ROOT, p));
const DEPS = [
  "@inlang/paraglide-js",
  "@tanstack/react-table",
  "nuqs",
  "motion",
  "mode-watcher",
];
// Bare-module matcher: matches `from "dep"`, `from 'dep'`, `require("dep")`,
// `require('dep')`, and dynamic `import("dep")` / `import('dep')`.
// We accept the dep name as a token (so e.g. "motion/react" wouldn't slip
// through by mistake — but we do allow "motion/react" intentionally because
// the motion package is a single dep that re-exports subpaths).
const DEPS_ALT = DEPS.map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const IMPORT_RE = new RegExp(
  `(?:from|require|import)\\s*[(\\[\\s]*["'](${DEPS_ALT.join("|")})(?:/[^"'\\s]*)?["']`,
  "g",
);

const hits = [];

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return; // missing root — skip silently (e.g. no e2e/ yet)
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".react-router" || entry === "dist" || entry === ".output") {
        continue;
      }
      yield* walk(full);
    } else if (st.isFile()) {
      yield full;
    }
  }
}

for (const root of SCAN_ROOTS) {
  for (const file of walk(root)) {
    // Only scan files that can contain JS/TS imports
    if (!/\.(?:[mc]?[jt]sx?|mts|cts)$/.test(file)) continue;
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    IMPORT_RE.lastIndex = 0;
    let m;
    while ((m = IMPORT_RE.exec(text)) !== null) {
      hits.push({ file: relative(REPO_ROOT, file), dep: m[1] });
    }
  }
}

if (hits.length === 0) {
  console.log(`✓ no orphan imports of [${DEPS.join(", ")}] in web-modern/{src,e2e,scripts}`);
  process.exit(0);
}

console.error(`✗ Found ${hits.length} orphan import(s) of removed deps:`);
for (const { file, dep } of hits) {
  console.error(`  - ${file}  →  ${dep}`);
}
console.error(
  `\nThese deps were removed in Phase 10.0 D3. Re-add to package.json or refactor the import.`,
);
process.exit(1);
