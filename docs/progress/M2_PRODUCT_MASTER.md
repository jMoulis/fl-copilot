# M2 product master

Date: 2026-09-26.

## Scope

The active increment is M2-T01 from `docs/specs/IMPLEMENTATION_PLAN.md`: canonical Product, ProductIdentifier and ProductAlias contracts, their local and remote persistence, and replication through the M1 synchronization pipeline.

## Implemented

- Runtime-neutral Zod schemas and TypeScript types for products, packaging, identifiers and aliases in `@fl-copilot/domain`.
- Separate create and update contracts, including deterministic alias normalization and explicit validation states for AI-proposed identities.
- String-only identifiers so ITM8, EAN and PLU leading zeroes survive parsing, SQLite, MongoDB and synchronization.
- Decimal-string packaging quantities in shared/API contracts, converted to and from MongoDB `Decimal128` only in the remote repository adapter.
- SQLite migration and Drizzle definitions for `products`, `product_identifiers` and `product_aliases`, including the specified lookup indexes and local synchronization metadata.
- An atomic local repository for aggregate reads, upserts and soft deletes; every local mutation enqueues its Outbox command in the same SQLite transaction.
- MongoDB command handlers for product, identifier and alias upserts and deletes with optimistic versions, store ownership checks, active-parent validation and duplicate active-identifier rejection.
- Remote product indexes, including the active unique `(storeId, type, value)` identifier constraint.
- Product collections in bootstrap snapshots and incremental pull pages, with deleted records excluded from new snapshots.
- Safe mobile snapshot and pull application that preserves dirty local changes and accepts a push acknowledgement only when it still matches the local version that was sent.
- Transactional two-device coverage for creation, update and deletion, including an EAN beginning with zero and a clean bootstrap after deletion.

## Verification evidence

| Check                     | Result                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Shared contracts          | Product, identifier and alias payloads are parsed by the same domain schemas in mobile, API and sync contracts            |
| Leading zeroes            | `0000087003017` remains an exact string through local persistence, MongoDB and device-to-device replication               |
| Atomic local writes       | Product-master rows and their Outbox commands commit in one SQLite transaction                                            |
| Optimistic remote writes  | Expected remote versions gate every upsert and delete; mismatches return a durable conflict result                        |
| Push acknowledgement race | A response for version 1 cannot overwrite a newer pending local version 2                                                 |
| Bootstrap safety          | Deleted remote aliases are excluded, while dirty local records are never overwritten by snapshot upserts                  |
| Two-device replication    | Device A creates, updates and deletes; device B receives the ordered changes and a new device receives the final snapshot |
| `pnpm check`              | Passed locally: 9 workspace typechecks and 70 tests; 10 MongoDB tests skipped locally and enabled in CI                   |
| Build and exports         | Workspace build and Expo iOS, Android and Web exports pass                                                                |
| Formatting                | `pnpm format:check` and `git diff --check` pass                                                                           |

## Next work

1. Merge M2-T01 after the transactional MongoDB CI gate passes.
2. Begin M2-T02: Mercalys workbook ingestion contracts and deterministic parsing fixtures.
