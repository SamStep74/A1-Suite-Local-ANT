const { buildApp } = require("./app");
const config = require("./config");

const port = Number(process.env.PORT || 4100);
const dbPath = config.resolveDbPath();

const app = buildApp({ dbPath, logger: process.env.NODE_ENV === "production" });

app.listen({ port, host: process.env.HOST || "127.0.0.1" }).then(() => {
  console.log(`${config.PRODUCT.name} listening on http://127.0.0.1:${port} (data: ${dbPath})`);
}).catch(error => {
  app.log.error(error);
  process.exit(1);
});
