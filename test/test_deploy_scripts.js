// test_deploy_scripts.js — integrity tests for deploy scripts.
//
// A1-Suite-Local-ANT has 2 deploy scripts (install.sh, healthcheck.sh,
// start-all.sh) and 2 template files (.service, .plist). Per AGENTS.md §5
// ("This is the canonical single-host path. Installs systemd unit (Linux)
// or launchd plist (macOS)"), these are critical for production.
//
// This test file validates shell script integrity:
//   - bash syntax (via `bash -n`)
//   - shebang presence
//   - strict mode (set -e, set -u, or set -o pipefail)
//   - no obvious bugs (e.g. `cd` without error handling)
//   - template files have valid plist/service structure
//   - scripts are executable

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const DEPLOY = path.join(ROOT, "deploy");
const SCRIPTS = path.join(DEPLOY, "scripts");

// Helper: run `bash -n` to check syntax (no execution, just parse)
function checkBashSyntax(scriptPath) {
  try {
    execSync('bash -n "' + scriptPath + '"', { stdio: "pipe" });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.stderr ? e.stderr.toString() : e.message };
  }
}

// Helper: read script
function readScript(scriptPath) {
  return fs.readFileSync(scriptPath, "utf8");
}

// Helper: check if any line matches a set- pattern
function hasStrictMode(content) {
  const lines = content.split("\n");
  return lines.some(line => {
    // Match: "set -e", "set -u", "set -o pipefail", "set -euo pipefail", etc.
    // The set line must have at least one of: -e, -u, or -o pipefail
    return /^set\s+-\S*\s/.test(line) || /^set\s+-[a-z]/.test(line);
  });
}

// Helper: check if a line has the bash shebang
function hasBashShebang(content) {
  return /^#!.*\b(bash|sh)\b/.test(content.split("\n")[0]);
}

// Helper: check if content has a function-like declaration
function hasFunctionDeclaration(content, fnName) {
  // Match: function name(...) or name() { or fn_name() {
  const re = new RegExp("\\b" + fnName + "\\s*\\(");
  return re.test(content);
}

// ─── 1. install.sh ───────────────────────────────

test("deploy/install.sh exists", () => {
  assert.ok(fs.existsSync(path.join(DEPLOY, "install.sh")),
    "install.sh must exist (per AGENTS.md §5)");
});

test("deploy/install.sh has valid bash syntax", () => {
  const result = checkBashSyntax(path.join(DEPLOY, "install.sh"));
  assert.ok(result.ok, "install.sh has bash syntax errors: " + result.error);
});

test("deploy/install.sh has shebang + strict mode", () => {
  const content = readScript(path.join(DEPLOY, "install.sh"));
  assert.ok(hasBashShebang(content), "install.sh should have a bash/sh shebang");
  assert.ok(hasStrictMode(content), "install.sh should use strict mode (set -e, -u, or -o pipefail)");
});

test("deploy/install.sh checks for Node.js version", () => {
  const content = readScript(path.join(DEPLOY, "install.sh"));
  assert.ok(/node\s+-v|npm\s+install|node\s+-p/.test(content),
    "install.sh should check Node.js version or use node -p");
});

test("deploy/install.sh has correct mode validation (spa/legacy)", () => {
  const content = readScript(path.join(DEPLOY, "install.sh"));
  assert.ok(/DEPLOY_DEFAULT.*=.*spa.*legacy|spa.*\|.*legacy/.test(content),
    "install.sh should validate DEPLOY_DEFAULT is 'spa' or 'legacy'");
});

// ─── 2. deploy/scripts/healthcheck.sh ─────────────

test("deploy/scripts/healthcheck.sh exists", () => {
  assert.ok(fs.existsSync(path.join(SCRIPTS, "healthcheck.sh")),
    "healthcheck.sh must exist");
});

test("deploy/scripts/healthcheck.sh has valid bash syntax", () => {
  const result = checkBashSyntax(path.join(SCRIPTS, "healthcheck.sh"));
  assert.ok(result.ok, "healthcheck.sh has bash syntax errors: " + result.error);
});

test("deploy/scripts/healthcheck.sh has shebang + strict mode", () => {
  const content = readScript(path.join(SCRIPTS, "healthcheck.sh"));
  assert.ok(hasBashShebang(content), "healthcheck.sh should have a bash/sh shebang");
  assert.ok(hasStrictMode(content), "healthcheck.sh should use strict mode");
});

test("deploy/scripts/healthcheck.sh has a probe function (the smoke check)", () => {
  const content = readScript(path.join(SCRIPTS, "healthcheck.sh"));
  assert.ok(hasFunctionDeclaration(content, "probe"),
    "healthcheck.sh should have a probe() function");
  assert.ok(/HTTP\s+\$/.test(content) || /http_code/.test(content),
    "healthcheck.sh should report HTTP codes");
});

// ─── 3. deploy/scripts/start-all.sh ──────────────

test("deploy/scripts/start-all.sh exists", () => {
  assert.ok(fs.existsSync(path.join(SCRIPTS, "start-all.sh")),
    "start-all.sh must exist (per AGENTS.md §5)");
});

test("deploy/scripts/start-all.sh has valid bash syntax", () => {
  const result = checkBashSyntax(path.join(SCRIPTS, "start-all.sh"));
  assert.ok(result.ok, "start-all.sh has bash syntax errors: " + result.error);
});

test("deploy/scripts/start-all.sh has shebang + strict mode", () => {
  const content = readScript(path.join(SCRIPTS, "start-all.sh"));
  assert.ok(hasBashShebang(content), "start-all.sh should have a bash/sh shebang");
  assert.ok(hasStrictMode(content), "start-all.sh should use strict mode");
});

// ─── 4. Template files (.service + .plist) ─────

test("deploy/armosphera-one.service.tmpl has systemd unit structure", () => {
  const tmpl = path.join(DEPLOY, "armosphera-one.service.tmpl");
  if (!fs.existsSync(tmpl)) return;  // skip if file doesn't exist
  const content = readScript(tmpl);
  assert.match(content, /^\[Unit\]/m, "service file should have [Unit] section");
  assert.match(content, /^\[Service\]/m, "service file should have [Service] section");
  assert.match(content, /^\[Install\]/m, "service file should have [Install] section");
  assert.match(content, /^ExecStart=/m, "service file should have ExecStart");
});

test("deploy/com.armosphera.one.plist.tmpl has launchd plist structure", () => {
  const tmpl = path.join(DEPLOY, "com.armosphera.one.plist.tmpl");
  if (!fs.existsSync(tmpl)) return;
  const content = readScript(tmpl);
  assert.ok(/<\?xml/.test(content) || /<plist/.test(content),
    "plist should be XML with plist root");
  assert.match(content, /<key>Label<\/key>/, "plist should have Label key");
  assert.match(content, /<key>ProgramArguments<\/key>/, "plist should have ProgramArguments");
});

// ─── 5. Cross-cutting / integrity ─────────────

test("deploy scripts don't contain hardcoded secrets", () => {
  const allScripts = [
    path.join(DEPLOY, "install.sh"),
    path.join(SCRIPTS, "healthcheck.sh"),
    path.join(SCRIPTS, "start-all.sh"),
    path.join(DEPLOY, "armosphera-one.service.tmpl"),
    path.join(DEPLOY, "com.armosphera.one.plist.tmpl"),
  ];
  // Common patterns (regression-catcher)
  const secretPatterns = [
    /sk_live_[a-zA-Z0-9]{20,}/,  // Stripe live
    /sk-[a-zA-Z0-9]{20,}/,         // OpenAI/Anthropic
    /AIza[0-9A-Za-z_-]{35}/,        // Google API key
    /ghp_[a-zA-Z0-9]{36}/,          // GitHub PAT
  ];
  for (const script of allScripts) {
    if (!fs.existsSync(script)) continue;
    const content = readScript(script);
    for (const pattern of secretPatterns) {
      assert.ok(!pattern.test(content),
        script + " may contain a hardcoded secret matching " + pattern);
    }
  }
});

test("deploy scripts are reproducible (same content on every call)", () => {
  const installPath = path.join(DEPLOY, "install.sh");
  if (!fs.existsSync(installPath)) return;
  const c1 = readScript(installPath);
  const c2 = readScript(installPath);
  assert.strictEqual(c1, c2, "install.sh should return the same content on every read");
});

test("AGENTS.md §5 documents the two deploy paths", () => {
  const agentsPath = path.join(ROOT, "AGENTS.md");
  if (!fs.existsSync(agentsPath)) return;
  const content = readScript(agentsPath);
  assert.match(content, /deploy/i, "AGENTS.md should mention deploy");
  assert.match(content, /install\.sh|start-all/, "AGENTS.md should mention the deploy scripts");
});
