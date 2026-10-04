# Fastify API

```sh
cp apps/api/.env.example apps/api/.env
pnpm dev:api
```

The example configuration binds to `127.0.0.1:3000`. Set `HOST=0.0.0.0` explicitly when a container or physical device needs access.

Authentication emails are sent by the API through Resend. Production requires `RESEND_API_KEY` and `AUTH_EMAIL_FROM`; the sender address must belong to a domain verified in Resend. Keep the API key server-side and use a restricted sending-only key. Local development keeps `AUTH_DEVELOPMENT_CODE=123456`, which skips external email delivery.

The native application never contacts Resend directly:

```text
mobile app → Fastify API → Resend → recipient mailbox
```

`GET /health` is intentionally public and reports API plus MongoDB readiness. A connected database returns HTTP 200; an unavailable database returns HTTP 503 and `status: "degraded"`. A later health request retries initialization, so the process can recover when MongoDB comes back. It does not assert authentication readiness.

Original source files use a private Vercel Blob store. Connect that store to the API project so Vercel provides `BLOB_READ_WRITE_TOKEN`, or `VERCEL_OIDC_TOKEN` plus `BLOB_STORE_ID`. The API issues a ten-minute upload URL scoped to one deterministic pathname, MIME type and exact file size. The mobile app uploads directly to Blob, then asks the API to verify and confirm the object. Never expose a Blob credential through an `EXPO_PUBLIC_*` variable.

Waste-receipt Vision extraction runs server-side through OpenAI after private upload and Sharp normalization. `WASTE_RECEIPT_VISION_MODEL` defaults to `gpt-5.6-luna`. Vercel deployments route `openai/gpt-5.6-luna` through AI Gateway using the automatically injected `VERCEL_OIDC_TOKEN`; local development uses `OPENAI_API_KEY`, with `AI_GATEWAY_API_KEY` available as an alternative. The API sends only the normalized JPEG with `store: false`, validates strict Structured Outputs locally and keeps valid results as reviewable evidence. The mobile application never receives an AI credential or calls the provider directly. See `docs/adr/0005-openai-vision-receipt-extraction.md` for the data-handling decision.

After extraction, the API applies the shared deterministic receipt arithmetic validator. `WASTE_RECEIPT_ARITHMETIC_TOLERANCE_EUR` defaults to `0.01`: complete `weight × unit price` lines are classified as consistent or `AMOUNT_TO_REVIEW`, while incomplete lines remain explicitly unchecked. The extracted values are never rewritten. Results are stored as separate, versioned and idempotent evidence.

`buildApp` does not open a socket; tests use Fastify injection. `runtime.ts` validates environment settings, listens and handles shutdown for the local process. `api/index.ts` loads the bundled Vercel handler, which forwards Node requests to the same Fastify instance without opening a port. Build with `pnpm --filter @fl-copilot/api build`; start the local-process bundle with `pnpm --filter @fl-copilot/api start`.

Errors follow `ApiErrorDto` from `packages/sync-contracts`. Request IDs are server-generated and returned in the `x-request-id` header and error body. Request bodies, headers, URLs and raw exception messages are not logged by the foundation logger. The health endpoint has no store context and exposes no tenant data; authenticated store-isolation tests must be introduced with business endpoints.

Configure the API Sentry project with `SENTRY_DSN` and optionally `SENTRY_ENVIRONMENT`. Unexpected server errors are captured with only the HTTP method, public error code and correlation ID; request bodies, headers, cookies, query parameters, database values, local variables and source context are disabled. Structured startup and failure logs use the same remote transport. Set `SENTRY_TEST_ROUTE_ENABLED=true` temporarily to expose `POST /api/v1/observability/test-error` for M0-T10 acceptance; production rejects this setting at startup.

MongoDB uses the native driver with one shared client pool. Production requires an explicit `MONGODB_URI`; local development defaults to the loopback server. `MONGODB_DATABASE` and `MONGODB_MAX_POOL_SIZE` are validated at startup.

Ordered, idempotent migrations live in `src/database/migrations.ts` and are recorded in `schemaMigrations`. Add a migration before repository code that depends on it. Migration numbers and recorded names are immutable.

After a developer signs in for the first time, provision that account with a non-production store before testing business data:

```sh
pnpm --filter @fl-copilot/api dev:ensure-store
```

The command selects the only development user and creates `Magasin pilote` if no active membership exists. When several users exist, set `DEVELOPMENT_USER_EMAIL`; `DEVELOPMENT_STORE_NAME` optionally changes the display name. The command refuses to run with `NODE_ENV=production`. Restart or reconnect the mobile session afterward so its authorized-store list is refreshed.

The integration test is enabled by `TEST_MONGODB_URI`:

```sh
TEST_MONGODB_URI='mongodb://127.0.0.1:27017/?directConnection=true' pnpm test
```

It creates a uniquely named database, verifies a real write/read and migration idempotency, then drops that test database. CI supplies MongoDB 7 as a service.
