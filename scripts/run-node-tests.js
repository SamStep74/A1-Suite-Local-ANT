"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const TEST_ROOTS = [
  path.join(ROOT, "test"),
  path.join(ROOT, "server", "lib", "__tests__"),
];
const TEST_FILE_RE = /\.test\.(?:cjs|js|mjs)$/;

function walk(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, out);
    } else if (TEST_FILE_RE.test(entry.name)) {
      out.push(full);
    }
  }
}

const files = [];
for (const root of TEST_ROOTS) walk(root, files);
files.sort();

if (files.length === 0) {
  console.error("No node:test files found.");
  process.exit(1);
}

const args = [
  "--test",
  "--test-concurrency=4",
  "--test-timeout=180000",
  ...process.argv.slice(2),
  ...files,
];
const result = spawnSync(process.execPath, args, {
  cwd: ROOT,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
