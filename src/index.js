import { createApi } from "./api.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { SessionManager } from "./sessions.js";

const sessions = new SessionManager();
const app = createApi(sessions);

const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, "admin API listening");
});

sessions.startAll().catch((err) => logger.error({ err }, "failed to start sessions"));

async function shutdown(signal) {
  logger.info({ signal }, "shutting down");
  server.close();
  await sessions.stopAll();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
