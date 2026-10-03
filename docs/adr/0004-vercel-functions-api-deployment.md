# ADR 0004 — Vercel Functions API deployment

## Status

Accepted on 2026-10-03.

## Context

The canonical architecture originally selected Google Cloud Run for the Fastify API. The pilot already uses Vercel for private Blob storage and Git deployments, while no dedicated Google Cloud project exists for this product. Maintaining a second cloud platform would add credentials, deployment configuration and operational work before the pilot needs container-specific capabilities.

The API is a stateless HTTP service backed by MongoDB Atlas. Its long-running document workflows remain coordinated through Inngest rather than inside request handlers.

## Decision

Deploy the Fastify API as a Node.js Vercel Function with Fluid Compute.

- Run the Function in Paris (`cdg1`) while the pilot is France-based.
- Keep Fastify as the only HTTP application and preserve all existing routes, validation, authentication and store isolation.
- Bundle the runtime-neutral workspace packages into the API artifact so pnpm workspace source links are not required at invocation time.
- Keep a separate local-process entrypoint for development and tests.
- Keep MongoDB Atlas as the durable database and private Vercel Blob as the source-file store.
- Use Standard Deployment Protection so Preview deployments require Vercel authentication while the production API domain remains reachable by the native application.

## Consequences

- Git branches receive protected Preview deployments and `master` deploys production automatically.
- The API, Blob credentials and deployment logs live in one Vercel project.
- Function duration, bundle size and regional limits must be monitored as remote parsing and Inngest work are introduced.
- A container worker remains an explicit future option if measured processing requirements exceed Vercel Function limits; adopting one requires a new decision.

## References

- [Fastify on Vercel](https://vercel.com/docs/frameworks/backend/fastify)
- [Vercel Functions](https://vercel.com/docs/functions)
- [Vercel regions](https://vercel.com/docs/regions)
