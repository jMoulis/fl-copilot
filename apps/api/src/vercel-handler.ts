import type { IncomingMessage, ServerResponse } from "node:http";
import "./observability.js";
import { buildApp } from "./build-app.js";
import { parseEnvironment } from "./config.js";
import { createMongoDatabase } from "./database/mongo.js";
import { runWithVercelOidcToken } from "./vercel-request-context.js";

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
  const oidcHeader = request.headers["x-vercel-oidc-token"];
  const oidcToken = Array.isArray(oidcHeader) ? oidcHeader[0] : oidcHeader;
  runWithVercelOidcToken(oidcToken, () => {
    app.server.emit("request", request, response);
  });
}
