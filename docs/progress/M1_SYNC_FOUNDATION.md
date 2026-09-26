# M1 offline-first synchronization foundation

Date: 2026-09-26.

## Scope

The active increment is M1-T01 from `docs/specs/IMPLEMENTATION_PLAN.md`: shared, runtime-neutral Zod contracts for the synchronization protocol. It does not implement the local Outbox repository, atomic business mutations, remote idempotency, change sequencing or HTTP synchronization endpoints.

## Implemented

- Protocol version 1 and the initial 100-command push limit.
- `SyncCommand`, `SyncPushRequest`, `SyncCommandResult` and `SyncPushResponse` schemas and inferred types.
- `SyncChangeEnvelope` and `SyncPullResponse` schemas and inferred types.
- `BootstrapResponse` with every canonical entity collection named by the database/API specification.
- Reuse of the canonical `ApiErrorDto` schema in command results.
- JSON-safe payload and remote-entity validation, UUID domain identifiers, ISO timestamps, non-negative remote versions and the five canonical command statuses.
- API and mobile synchronization façades that re-export the same schema instances from `@fl-copilot/sync-contracts`.

Bootstrap entity values remain opaque JSON objects until their canonical schemas are implemented in their owning domain packages. The synchronization package owns the envelope and does not duplicate future product, observation, commercial or recommendation contracts.

## Verification evidence

| Check                        | Result                                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| Shared runtime imports       | API and mobile façades resolve to the same `SyncCommand` and `SyncPushRequest` schema instances     |
| Push request contract        | Protocol version, UUID identifiers, positive local sequence and the 100-command limit are validated |
| Push response contract       | All five canonical per-command statuses parse successfully                                          |
| Pull and bootstrap contracts | Change pages and the complete named bootstrap envelope parse successfully                           |
| `pnpm check`                 | Passed: structure, lint, all 9 workspace typechecks, 35 tests; 3 integration tests skipped          |
| `pnpm format:check`          | Passed                                                                                              |
| `git diff --check`           | Passed                                                                                              |

## Next work

1. M1-T02: implement the SQLite Outbox repository with monotonic sequence allocation, oldest-first pending queries, state transitions and retry metadata.
2. M1-T03: prove atomic local business write plus Outbox insertion with a temporary test entity.
3. Continue through remote command idempotency and store-scoped change sequencing before exposing push and pull endpoints.
