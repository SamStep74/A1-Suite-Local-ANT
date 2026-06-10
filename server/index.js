const { buildApp } = require("./app");
const config = require("./config");
const { execFileSync } = require("node:child_process");

const port = Number(process.env.PORT || 4100);
const dbPath = config.resolveDbPath();

const host = process.env.HOST || "127.0.0.1";
const app = buildApp({ dbPath, logger: process.env.NODE_ENV === "production" });

/**
 * Identify the process holding a TCP port via `lsof` (macOS / most Linux).
 * Returns " (held by <cmd> PID <pid>)" on success, or "" if lsof is missing
 * / returns nothing / errors. Never throws — failure to identify is a UX
 * downgrade, not a fatal error.
 */
function describePortHolder(port) {
  try {
    const out = execFileSync(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"],
      { encoding: "utf8" }
    );
    const pidMatch = out.match(/^p(\d+)/m);
    const cmdMatch = out.match(/^c(.+)$/m);
    if (pidMatch) return ` (held by ${cmdMatch ? cmdMatch[1] : "process"} PID ${pidMatch[1]})`;
  } catch { /* lsof missing / no perms / no match — best-effort only */ }
  return "";
}

app.listen({ port, host }).then(() => {
  console.log(`${config.PRODUCT.name} listening on http://${host}:${port} (data: ${dbPath})`);
}).catch(error => {
  if (error.code === "EADDRINUSE") {
    // The OS will refuse to bind. Try to name the holder so the user
    // can decide: kill it, or run on a free port. Without this guard
    // a sibling dev app (Next.js shell, another A1-Suite instance)
    // squatting on :4100 silently steals /api/* — the request hits the
    // wrong app, which returns its own 404 and the user spends an
    // hour chasing "the API route is missing" when it's actually a
    // port collision.
    const holder = describePortHolder(port);
    console.error(
      `\n[Fastify] Port ${host}:${port} is already in use${holder}.\n` +
      `  A different dev app (or another A1-Suite instance) is squatting on the port.\n` +
      `  Fix one of:\n` +
      `    1. Identify and stop the holder:  lsof -nP -iTCP:${port} -sTCP:LISTEN\n` +
      `    2. Run A1 Suite on a free port:     PORT=4180 npm run dev\n`
    );
    process.exit(1);
  }
  app.log.error(error);
  process.exit(1);
});
