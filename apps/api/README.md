# Fastify API

```sh
cp apps/api/.env.example apps/api/.env
pnpm dev:api
```

The example configuration binds to `127.0.0.1:3000`. Set `HOST=0.0.0.0` explicitly when a container or physical device needs access.

`GET /health` is intentionally public and reports API plus MongoDB readiness. A connected database returns HTTP 200; an unavailable database returns HTTP 503 and `status: "degraded"`. A later health request retries initialization, so the process can recover when MongoDB comes back. It does not assert authentication readiness. There are no business endpoints yet.

`buildApp` does not open a socket; tests use Fastify injection. `server.ts` validates environment settings, listens and handles shutdown. Build with `pnpm --filter @fl-copilot/api build`; start the resulting bundle with `pnpm --filter @fl-copilot/api start`.

Errors follow `ApiErrorDto` from `packages/sync-contracts`. Request IDs are server-generated and returned in the `x-request-id` header and error body. Request bodies, headers, URLs and raw exception messages are not logged by the foundation logger. The health endpoint has no store context and exposes no tenant data; authenticated store-isolation tests must be introduced with business endpoints.

MongoDB uses the native driver with one shared client pool. Production requires an explicit `MONGODB_URI`; local development defaults to the loopback server. `MONGODB_DATABASE` and `MONGODB_MAX_POOL_SIZE` are validated at startup.

Ordered, idempotent migrations live in `src/database/migrations.ts` and are recorded in `schemaMigrations`. Add a migration before repository code that depends on it. Migration numbers and recorded names are immutable.

The integration test is enabled by `TEST_MONGODB_URI`:

```sh
TEST_MONGODB_URI='mongodb://127.0.0.1:27017/?directConnection=true' pnpm test
```

It creates a uniquely named database, verifies a real write/read and migration idempotency, then drops that test database. CI supplies MongoDB 7 as a service.
