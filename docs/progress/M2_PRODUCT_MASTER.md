# M2 product master

Date: 2026-09-27.

## Scope

The active increment covers M2-T01 through M2-T04 from `docs/specs/IMPLEMENTATION_PLAN.md`: the synchronized product master, local-first product editing, deterministic product matching, and durable local source-document metadata.

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
- A French product list and editor under `Plus > Produits` for label, category, nature, sales unit, packaging, identifiers and aliases.
- Immediate offline saves through the product repository, with every changed entity represented by an ordered Outbox command.
- Version chaining for repeated offline edits so a later local command expects the preceding local version instead of conflicting with its own device.
- Product and aggregate-level synchronization badges; identifier and alias conflicts are surfaced on the owning product.
- Conflict-safe editing: the complete local form remains readable, while a new save is blocked until the conflict is examined.
- Leading-zero guidance beside identifier inputs and French validation, error and success states.
- An explicit no-store state instead of a generic SQLite error, plus an idempotent non-production command that provisions the first development user with an active pilot store.
- A runtime-neutral product matcher that follows the specified priority: exact validated identifier, exact validated alias, canonical normalized label, then fuzzy candidates.
- Exact ITM8, EAN and PLU values are compared as strings; identifier conflicts return an explicit ambiguous result and never auto-match.
- Only active products and non-deleted validated identifiers and aliases from the requested store can establish identity.
- Fuzzy scores use a versioned, configurable policy and remain review proposals; they never assert product truth automatically.
- Runtime-neutral contracts for local source documents, raw source records and local file metadata, including source lineage and processing states.
- SQLite migration 7 for `source_documents` and `source_records`, with checksum, status and document-lineage indexes; the existing `local_files` table gains a source-document index.
- Transactional creation of a source document and its immutable local-file metadata, with matching store, URI and checksum validation.
- Source records retain raw and normalized JSON, warning/error codes and stable document IDs for later parsing and publication.
- Local file metadata, checksums and raw records survive database restart while the source remains explicitly `LOCAL_ONLY` until the M2-T13 upload flow exists.

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
| `pnpm check`              | Passed locally: 9 workspace typechecks and 87 tests; 10 MongoDB tests skipped locally and enabled in CI                   |
| Build and exports         | Workspace build and Expo iOS, Android and Web exports pass                                                                |
| Formatting                | `pnpm format:check` and `git diff --check` pass                                                                           |
| Offline editor            | Creating a product with an EAN and alias persists all three local records and queues three ordered commands               |
| Repeated offline edits    | A second save targets the first local version, allowing both commands to synchronize in order                             |
| Conflict visibility       | Open product, identifier and alias conflicts resolve to the owning product and block an unsafe new save                   |
| Matcher precedence        | An exact validated identifier wins before alias and label matching, while contradictory ITM8/EAN identities block         |
| Matching safety           | Unvalidated aliases and inactive, review-only, deleted or cross-store products cannot auto-match                          |
| Fuzzy proposals           | Candidate, review and ambiguity thresholds are configuration inputs recorded through the matcher version                  |
| Source restart durability | Source-document, local-file and raw-record metadata remain available after closing and reopening the SQLite database      |
| Source atomicity          | A local-file insertion failure rolls back its source document; mismatched store, URI or checksum is rejected              |
| Source lineage            | Raw JSON and issue codes retain their stable `sourceDocumentId` relationship                                              |

## Next work

1. Merge M2-T04 after CI.
2. Begin M2-T05: validate a React Native-compatible XLSX adapter against real pilot fixtures and target-device constraints.
