# M1 offline-first synchronization foundation

Date: 2026-09-26.

## Scope

The active increment covers M1-T01 through M1-T07 from `docs/specs/IMPLEMENTATION_PLAN.md`: shared, runtime-neutral Zod contracts for the synchronization protocol, durable atomic local Outbox and pull-page application, remote command idempotency, store-scoped change sequencing and the authenticated push and pull endpoints.

## Implemented

- Protocol version 1 and the initial 100-command push limit.
- `SyncCommand`, `SyncPushRequest`, `SyncCommandResult` and `SyncPushResponse` schemas and inferred types.
- `SyncChangeEnvelope` and `SyncPullResponse` schemas and inferred types.
- `BootstrapResponse` with every canonical entity collection named by the database/API specification.
- Reuse of the canonical `ApiErrorDto` schema in command results.
- JSON-safe payload and remote-entity validation, UUID domain identifiers, ISO timestamps, non-negative remote versions and the five canonical command statuses.
- API and mobile synchronization façades that re-export the same schema instances from `@fl-copilot/sync-contracts`.
- Canonical Outbox schema with command IDs, command types, expected remote versions, five local states and retry metadata.
- A data-preserving local migration from the M0 provisional Outbox columns to the canonical M1 contract.
- Atomic, persistent local-sequence allocation backed by `app_metadata`, with a unique device/sequence index.
- Durable enqueue and lookup, bounded oldest-first pending queries, guarded state transitions, attempt tracking and interrupted-sync recovery.
- A reusable exclusive-transaction helper that commits a local business mutation and its Outbox command as one SQLite unit.
- A temporary synchronized test entity and schema migration used to prove the transaction boundary before real domain repositories adopt it.
- A MongoDB `processedCommands` service that stores each globally unique command ID and its original result in the same transaction as the remote mutation.
- Concurrent duplicate handling that returns the stored result without repeating the domain mutation, plus identity checks against command-ID reuse across stores or entities.
- A MongoDB migration for the initial `processedCommands` operational index; MongoDB's `_id` index enforces global command-ID uniqueness.
- A `syncStoreCounters` allocator backed by atomic MongoDB `$inc` using 64-bit `Long` sequences.
- Transaction-aware `syncChanges` appends with the canonical entity identity, operation, version, timestamp and optional payload revision.
- A unique `(storeId, sequence)` MongoDB index and replica-set CI runtime so transaction and concurrency acceptance tests execute on every pull request.
- `POST /api/v1/sync/push` with the canonical protocol and batch contracts, Bearer authentication, explicit store context and protocol-version headers.
- Active session, device and store-membership authorization before any synchronization command is processed.
- Independent per-command transactions and results, including durable `APPLIED`, `REJECTED` and `CONFLICT` outcomes, replayed `ALREADY_APPLIED` outcomes and transient `RETRYABLE_ERROR` responses.
- The initial `SYNC_TEST_ENTITY_UPSERT` handler, which applies optimistic version checks and appends its remote change in the same MongoDB transaction.
- `GET /api/v1/sync/pull` with Bearer and store authorization, protocol-version validation, bounded page sizes and store-bound opaque cursors.
- Ordered MongoDB change pages based on 64-bit sequence values, with `hasMore` lookahead and canonical synchronized entities in UPSERT envelopes.
- A canonical SQLite inbox-state migration that stores the opaque cursor, protocol version, bootstrap revision and last successful sync timestamp.
- Atomic mobile pull-page application that commits synchronized entities and the next cursor together, retaining both prior values when the transaction rolls back.

Bootstrap entity values remain opaque JSON objects until their canonical schemas are implemented in their owning domain packages. The synchronization package owns the envelope and does not duplicate future product, observation, commercial or recommendation contracts.

## Verification evidence

| Check                        | Result                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| Shared runtime imports       | API and mobile façades resolve to the same `SyncCommand` and `SyncPushRequest` schema instances      |
| Push request contract        | Protocol version, UUID identifiers, positive local sequence and the 100-command limit are validated  |
| Push response contract       | All five canonical per-command statuses parse successfully                                           |
| Pull and bootstrap contracts | Change pages and the complete named bootstrap envelope parse successfully                            |
| Outbox migration             | A populated M0 row is preserved and mapped to canonical M1 columns; its sequence counter resumes     |
| Outbox restart persistence   | Commands survive a SQLite file reopen and the next local sequence continues monotonically            |
| Outbox ordering/transitions  | Pending commands return oldest first; retry, failure and interrupted-sync recovery metadata pass     |
| Atomic local mutation        | Entity, Outbox command and sequence commit together; a failure before commit rolls all three back    |
| Remote command idempotency   | Concurrent duplicate commands produce one domain mutation and replay the original stored result      |
| Remote transaction rollback  | A failed remote mutation persists neither the domain effect nor a processed-command record           |
| Command identity guard       | Reuse of a command ID for a different store, device, type or entity is rejected                      |
| Store-scoped sequencing      | Concurrent changes receive unique, gap-free sequences while separate stores retain separate counters |
| Push route security          | Bearer token, device, active session, membership, store header and protocol header are validated     |
| Mixed push batch             | Valid commands commit independently around a rejected command; replay does not duplicate its change  |
| CI MongoDB integration       | Replica-set tests cover transactional command idempotency, change ordering and mixed push batches    |
| Ordered pull pagination      | Pages remain store-scoped and sequence-ordered; `hasMore` and opaque cursor continuation are covered |
| Atomic pull application      | Entity writes and cursor advancement commit or roll back together in SQLite                          |
| `pnpm check`                 | Passed: structure, lint, all 9 workspace typechecks, 54 tests; 7 conditional MongoDB tests skipped   |
| `pnpm format:check`          | Passed                                                                                               |
| `git diff --check`           | Passed                                                                                               |

## Next work

1. M1-T08: provide the initial store snapshot and cursor through the bootstrap endpoint.
2. Apply bootstrap into a fresh or staged SQLite transaction before recording its revision and cursor.
