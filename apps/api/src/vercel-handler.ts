import type { IncomingMessage, ServerResponse } from "node:http";
import "./observability.js";
import { buildApp } from "./build-app.js";
import { parseEnvironment } from "./config.js";
import { createMongoDatabase } from "./database/mongo.js";

const config = parseEnvironment(process.env);
const database = createMongoDatabase(config);
const app = buildApp(config, { database });
let readiness: Promise<void> | undefined;

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  readiness ??= Promise.resolve(app.ready()).then(() => undefined);
  await readiness;
  app.server.emit("request", request, response);
}
