#!/usr/bin/env node
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function declaredA1AiSource() {
  const packagePath = path.join(repoRoot, "package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  const spec = packageJson.devDependencies?.["@a1/ai"] || packageJson.dependencies?.["@a1/ai"] || "";
  if (!spec) {
    throw new Error("package.json must declare @a1/ai so the Karpathy runner source is explicit.");
  }
  if (spec.startsWith("file:")) {
    return path.resolve(repoRoot, spec.slice("file:".length));
  }
  return "@a1/ai";
}

function loadA1Ai() {
  const declared = declaredA1AiSource();
  const candidates = declared === "@a1/ai" ? ["@a1/ai"] : ["@a1/ai", declared];
  for (const candidate of candidates) {
    try {
      if (candidate !== "@a1/ai" && !existsSync(candidate)) {
        throw new Error(`Declared @a1/ai file dependency does not exist: ${candidate}`);
      }
      const mod = require(candidate);
      if (typeof mod.runProductResearchCli !== "function") {
        throw new Error(`${candidate} does not export runProductResearchCli`);
      }
      return mod;
    } catch (error) {
      const missingSelf = error
        && error.code === "MODULE_NOT_FOUND"
        && (error.message || "").includes(`'${candidate}'`);
      if (!missingSelf) throw error;
    }
  }
  throw new Error("Cannot load declared @a1/ai product research runner. Run npm install or make the declared file dependency available.");
}

const { runProductResearchCli } = loadA1Ai();
const exitCode = await runProductResearchCli({
  repoRoot,
  argv: process.argv.slice(2),
  env: process.env,
});
if (exitCode) process.exitCode = exitCode;
