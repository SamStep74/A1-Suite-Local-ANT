"use strict";

/**
 * Sovereign legal-KB ingest CLI.
 *
 * Reads raw .txt/.md files of RA legislation from a directory, chunks each into article-aware
 * law_chunks rows (server/lawIngest), and writes an installable laws.sqlite that server/rag.js
 * indexes unchanged. 100% offline — no network, no embedding model (BM25-only by default; run
 * the embedder pass separately if/when a local model is configured).
 *
 * Usage:
 *   node scripts/ingest-laws.js <source-dir> [dest.sqlite]
 *
 * Each file becomes one "law"; its title is the filename without extension (underscores →
 * spaces). Re-running is idempotent (content-hashed chunk ids).
 */

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const config = require("../server/config");
const { buildLawsDb } = require("../server/lawIngest");

function titleFromFilename(file) {
  return path.basename(file).replace(/\.(txt|md)$/i, "").replace(/[_]+/g, " ").trim();
}

function readSources(dir) {
  const entries = fs.readdirSync(dir).filter((f) => /\.(txt|md)$/i.test(f)).sort();
  return entries.map((f) => ({
    lawTitle: titleFromFilename(f),
    text: fs.readFileSync(path.join(dir, f), "utf8"),
  }));
}

function main(argv) {
  const sourceDir = argv[2];
  if (!sourceDir) {
    console.error("Usage: node scripts/ingest-laws.js <source-dir> [dest.sqlite]");
    process.exit(1);
  }
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    console.error(`Source directory not found: ${sourceDir}`);
    process.exit(1);
  }
  const dest = argv[3] || config.resolveLawsDbPath();
  const sources = readSources(sourceDir);
  if (sources.length === 0) {
    console.error(`No .txt/.md law files found in ${sourceDir}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const db = new DatabaseSync(dest);
  try {
    const result = buildLawsDb(db, sources);
    console.log(`Ingested ${result.sources} law file(s) -> ${result.chunks} chunk(s)`);
    console.log(`Legal KB written -> ${dest}`);
    console.log("Embeddings: none (BM25 lexical retrieval). RAG works offline as-is.");
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main(process.argv);
}

module.exports = { titleFromFilename, readSources, main };
