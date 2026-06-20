#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testFiles = [
  "test/config.test.js",
  "test/ai-config.test.js",
  "test/ai-provider.test.js",
  "test/open-notebook.test.js",
];
const expectedTestCount = 37;
const requiredTitles = [
  "egress is OFF by default and blocks external hosts",
  "loopback is always allowed even when egress is off",
  "external host allowed only when enabled and allowlisted",
  "safeFetch blocks before calling fetch when egress is off",
  "IPv6 loopback [::1] is allowed when egress is off",
  "egress ON with empty allowlist blocks external hosts (deny-until-listed)",
  "OpenRouter egress is gated: off by default, on only when allowed AND allowlisted",
  "local model + bge-m3 embeddings remain untouched (local-first)",
  "OpenRouter is configured as the cloud provider",
  "listModels stays OFFLINE (fallback) and never calls fetch when egress is blocked",
  "listModels fetches LIVE when openrouter.ai is allowlisted, sending auth + attribution headers",
  "listModels degrades to fallback (not throw) when the live fetch errors",
  "search swallows egress-blocked errors (opt-in, gated) and returns []",
  "search queries a LIVE allowlisted instance, posting query+limit with auth",
  "search works against a loopback instance even when egress is globally off",
  "computeDataDir honors A1_STUDIO_DATA_DIR",
  "resolveDbPath prioritizes A1_STUDIO_SQLITE",
  "public client IP resolver honors configured headers only from trusted proxies",
];

function createEvalRoot() {
  const evalRoot = mkdtempSync(path.join(os.tmpdir(), "a1-ant-egress-policy-"));
  mkdirSync(path.join(evalRoot, "server"), { recursive: true });
  mkdirSync(path.join(evalRoot, "test"), { recursive: true });
  cpSync(path.join(repoRoot, "server", "config.js"), path.join(evalRoot, "server", "config.js"));
  cpSync(path.join(repoRoot, "server", "aiProvider.js"), path.join(evalRoot, "server", "aiProvider.js"));
  cpSync(path.join(repoRoot, "server", "openNotebook.js"), path.join(evalRoot, "server", "openNotebook.js"));
  cpSync(path.join(repoRoot, "server", "vendor", "a1-ai"), path.join(evalRoot, "server", "vendor", "a1-ai"), { recursive: true });
  for (const file of testFiles) {
    cpSync(path.join(repoRoot, file), path.join(evalRoot, file));
  }
  const packageJson = path.join(repoRoot, "package.json");
  if (existsSync(packageJson)) cpSync(packageJson, path.join(evalRoot, "package.json"));
  return evalRoot;
}

function testEnv(env, evalRoot) {
  return {
    CI: "1",
    NODE_ENV: "test",
    DOTENV_CONFIG_PATH: path.join(evalRoot, ".env.disabled"),
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    PATH: env.PATH || "",
    TMPDIR: env.TMPDIR || "",
    TMP: env.TMP || "",
    TEMP: env.TEMP || "",
    SystemRoot: env.SystemRoot || "",
    ComSpec: env.ComSpec || "",
    PATHEXT: env.PATHEXT || "",
  };
}

function validateTapReport(reportPath) {
  if (!existsSync(reportPath)) return "missing Node TAP report";
  const tap = readFileSync(reportPath, "utf8");
  if (!tap.includes(`1..${expectedTestCount}`)) {
    return `missing TAP plan 1..${expectedTestCount}`;
  }
  if (/^not ok\s+\d+/m.test(tap)) return "TAP report contains failing tests";
  if (/^ok\s+\d+\s+-\s+.+#\s*(SKIP|TODO)\b/im.test(tap)) {
    return "TAP report contains skipped or TODO tests";
  }
  const okTitles = Array.from(tap.matchAll(/^ok\s+\d+\s+-\s+(.+)$/gm), (match) => match[1].trim());
  if (okTitles.length !== expectedTestCount) {
    return `expected ${expectedTestCount} passing tests, got ${okTitles.length}`;
  }
  const titleSet = new Set(okTitles);
  for (const title of requiredTitles) {
    if (!titleSet.has(title)) return `missing expected test title: ${title}`;
  }
  return "";
}

let evalRoot = "";
let result = { status: 1, stdout: "", stderr: "", error: null };
let reportError = "";
try {
  evalRoot = createEvalRoot();
  const reportPath = path.join(evalRoot, "egress-policy-report.tap");
  const args = [
    "--test",
    "--test-concurrency=4",
    "--test-timeout=60000",
    "--test-reporter=tap",
    `--test-reporter-destination=${reportPath}`,
    ...testFiles,
  ];
  result = spawnSync(process.execPath, args, {
    cwd: evalRoot,
    encoding: "utf8",
    env: testEnv(process.env, evalRoot),
    shell: false,
  });
  reportError = validateTapReport(reportPath);
} catch (error) {
  reportError = error && error.message ? error.message : String(error);
} finally {
  if (evalRoot) rmSync(evalRoot, { recursive: true, force: true });
}

const failed = result.error || result.status !== 0 || reportError;
console.log(`failing_checks=${failed ? 1 : 0}`);

if (reportError) {
  console.error(`report_validation_error=${reportError}`);
}
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.error) {
  console.error(result.error.message);
}
process.exitCode = failed ? 1 : 0;
