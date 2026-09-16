# Fruits & Vegetables Copilot

Native French iOS/Android department copilot, built with React Native + Expo and an offline-first architecture.

## Current increment

M0 foundation: executable monorepo tooling, Expo navigation and design primitives, Fastify API, shared transport errors, pooled MongoDB infrastructure, versioned local SQLite storage with Drizzle schemas and stable secure-random device identity. Business screens currently show honest empty states. Authentication and synchronization remain subsequent tickets; this is not yet an operational MVP.

Read `AGENTS.md` and the canonical specifications in `docs/specs/` before implementing a ticket. See `docs/progress/M0_FOUNDATION.md` for acceptance evidence and remaining gates.

## Requirements

- Node 24 (`nvm use`; exact version in `.nvmrc`)
- pnpm 9.15.9
- iOS: Xcode 26.2+ and CocoaPods 1.16.2+
- Android: Java 17+, Android SDK 36 and an emulator/device

Expo SDK 55 is pinned to match the available Xcode 26.3 toolchain. Native dependencies follow Expo's compatibility matrix. NativeWind uses stable v4 and Tailwind v3. A move to a newer SDK must revalidate both native platforms.

## Install and verify

```sh
pnpm install
pnpm check
pnpm format:check
pnpm build
pnpm --filter @fl-copilot/mobile export
```

`pnpm check` runs structure validation, ESLint, strict TypeScript for every workspace package and Vitest. `pnpm build` currently builds the API. `export` produces iOS and Android JavaScript/Hermes bundles; it does not replace a native build test.

## Run the API

```sh
cp apps/api/.env.example apps/api/.env
pnpm dev:api
curl http://127.0.0.1:3000/health
```

Expected response:

```json
{
  "status": "ok",
  "service": "fl-copilot-api",
  "database": { "status": "connected" }
}
```

The endpoint reports API and MongoDB readiness. It returns HTTP 503 with `status: "degraded"` when MongoDB is unavailable and retries the connection on later health checks. Configuration is validated at startup; malformed requests and unexpected exceptions return French structured errors with server-generated request IDs.

## Visual preview without native tools

```sh
pnpm preview:web
```

Open http://localhost:8087. This compiles and serves the same Expo interface for visual inspection without CocoaPods or an Android SDK. Restart the command after changing source files. It is a UI preview, not proof of native camera, SQLite, secure storage or offline synchronization behavior.

For a live web development server, use `pnpm --filter @fl-copilot/mobile web`.

## Run the mobile application

```sh
pnpm --filter @fl-copilot/mobile ios
# or
pnpm --filter @fl-copilot/mobile android
```

After installing a development build:

```sh
pnpm dev:mobile
```

The five native tabs are Aujourd’hui, Ma semaine, Analyses, Casse and Plus. The Plus tab opens an accessible About sheet. No API connection is required to open this foundation shell.

For native navigation acceptance, run the Maestro scenario against an installed, running development build with Metro available:

```sh
maestro test .maestro/navigation.yaml
```

Native project folders are generated locally by Expo and ignored by Git. The committed app configuration is the source of truth.

## Workspace

- `apps/mobile`: Expo Router, NativeWind, reusable native primitives, native SQLite initialization and versioned local migrations; Zustand holds ephemeral UI state only. TanStack Query is reserved for remote coordination.
- `apps/api`: Fastify, Zod, configuration, request/error handling, pooled MongoDB driver and ordered migrations.
- `packages/sync-contracts`: shared health/error schemas; sync DTOs follow in M1.
- `packages/domain`, `analytics-core`, `substitution-core`, `commercial-core`: runtime-neutral business modules, currently scaffolds.
- `packages/api-client`, `test-fixtures`: reserved client/fixture packages.

CI runs installation from the frozen lockfile, checks, formatting, API build and both mobile bundle exports. Native runtime acceptance is tracked separately; passing bundle export alone does not close M0-T02.
