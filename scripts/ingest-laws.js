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
 *   node scripts/ingest-laws.js <source-dir> [dest.sqlite] [--embed]
 *
 * Each file becomes one "law"; its title is the filename without extension (underscores →
 * spaces). Re-running is idempotent (content-hashed chunk ids).
 */

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const config = require("../server/config");
const { buildLawsDb } = require("../server/lawIngest");
const { embedLawChunks } = require("../server/lawEmbedIngest");

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

async function main(argv) {
  // Separate flags from positionals so [dest.sqlite] still works with or without --embed.
  const embed = argv.includes("--embed");
  const positionals = argv.slice(2).filter((a) => !a.startsWith("--"));
  const sourceDir = positionals[0];
  if (!sourceDir) {
    console.error("Usage: node scripts/ingest-laws.js <source-dir> [dest.sqlite] [--embed]");
    process.exit(1);
  }
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    console.error(`Source directory not found: ${sourceDir}`);
    process.exit(1);
  }
  const dest = positionals[1] || config.resolveLawsDbPath();
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
    if (embed) {
      // Opt-in embedding via the LOCAL loopback embedder. Failure-tolerant: if it is not running,
      // the KB stays BM25-only and the CLI still succeeds (sovereign degrade, no crash).
      console.log(`Embedding via ${config.lawEmbed.baseUrl} (model ${config.lawEmbed.model})…`);
      const e = await embedLawChunks(db);
      console.log(`Embeddings: ${e.embedded} embedded, ${e.failed} failed (of ${e.total}).`);
      if (e.failed > 0) console.log("Some/all embeddings failed (local embedder offline?) — BM25 retrieval still works.");
    } else {
      console.log("Embeddings: none (BM25 lexical retrieval). RAG works offline as-is. Add --embed to populate vectors.");
    }
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main(process.argv).catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = { titleFromFilename, readSources, main };
