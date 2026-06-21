#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");
const testRoots = ["server/lib/__tests__", "test"];
const testFilePattern = /\.test\.(?:cjs|js|mjs)$/;
const excluded = new Set([
  // The modern SPA is served by web-modern/Vite. Keep this browser smoke in
  // the Playwright lane instead of the backend Node lane.
  "test/suite-dashboard-sidebar-openability.test.mjs"
]);

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else if (entry.isFile()) {
      const relativePath = path.relative(rootDir, fullPath).split(path.sep).join("/");
      if (testFilePattern.test(relativePath) && !excluded.has(relativePath)) {
        files.push(relativePath);
      }
    }
  }
  return files;
}

const testFiles = testRoots
  .flatMap(root => walk(path.join(rootDir, root)))
  .sort();

if (testFiles.length === 0) {
  console.error("No Node test files found.");
  process.exit(1);
}

const result = spawnSync(process.execPath, [
  "--test",
  "--test-concurrency=4",
  "--test-timeout=180000",
  ...testFiles
], {
  cwd: rootDir,
  stdio: "inherit"
});

if (result.signal) {
  console.error(`Node test runner terminated by ${result.signal}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
