# Fruits & Vegetables Copilot

Native iOS/Android copilot built on React Native + Expo with an offline-first architecture.

## Current implementation state

Current ticket:

```text
M0-T01 — Create monorepo
```

This scaffold intentionally does **not** implement the Expo runtime, Fastify runtime, MongoDB connection, SQLite schema or sync engine yet. Those belong to subsequent M0/M1 tickets.

## Canonical agent instructions

Read:

```text
AGENTS.md
```

before making any change.

## Specifications

Canonical specs are under:

```text
docs/specs/
```

## Workspace layout

```text
apps/mobile
apps/api

packages/domain
packages/sync-contracts
packages/analytics-core
packages/substitution-core
packages/commercial-core
packages/api-client
packages/test-fixtures
```

## Structural verification

```text
pnpm verify:structure
```

Runtime dependencies and actual typecheck/test toolchains are introduced in the tickets that initialize the native and remote applications.
