import "./observability.js";
import { buildApp } from "./build-app.js";
import { parseEnvironment } from "./config.js";
import { createMongoDatabase } from "./database/mongo.js";
import { flushObservability, logRemoteEvent } from "./observability.js";

const config = parseEnvironment(process.env);
const database = createMongoDatabase(config);
const app = buildApp(config, { database });
let closing = false;

async function shutdown() {
  if (closing) return;
  closing = true;
  try {
    await app.close();
    await flushObservability();
  } catch {
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});

try {
  await app.listen({ host: config.HOST, port: config.PORT });
  logRemoteEvent("info", "API started", {
    environment: config.NODE_ENV,
    port: config.PORT,
  });
} catch {
  app.log.fatal("API startup failed");
  await app.close();
  process.exitCode = 1;
}
