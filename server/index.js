const path = require("node:path");
const { buildApp } = require("./app");

const port = Number(process.env.PORT || 4100);
const dbPath = process.env.ARMOSPHERA_ONE_DB || path.join(__dirname, "..", "data", "armosphera-one.db");

const app = buildApp({ dbPath, logger: process.env.NODE_ENV === "production" });

app.listen({ port, host: "127.0.0.1" }).then(() => {
  console.log(`Armosphera One listening on http://127.0.0.1:${port}`);
}).catch(error => {
  app.log.error(error);
  process.exit(1);
});

