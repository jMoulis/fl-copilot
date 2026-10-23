# Product unit refresh — 23 October 2026

## Scope

Correcting an existing product unit must update remote derived quantities/prices without editing the Mercalys source, converting historic numeric quantities, or failing an already committed product save when computation is interrupted. This closes a remote projection gap; it is not full M7/M8 acceptance.

## Evidence

The targeted run passes 30 tests across the product-unit integration suite, the existing Copilot analytics-query integration suite and shared sales measures. The new integration suite uses a disposable local MongoDB 6.0.1 replica set and real SQLite, canonical command processing and shared formulas. CI uses MongoDB 7; exact-head CI results must be recorded before merge.

Nine new integration scenarios:

1. Real native product-editor snapshot/save → SQLite and Outbox → remote push; derived quantities and weighted price become available while raw observations and analytical context remain unchanged. Internal markers are absent from public products.
2. Eighty historical dates: first 64 checkpointed, remaining 16 qualified as pending in Copilot quantities, then completed by ordinary pull without workflow credentials. Command replay is idempotent; no department projection is created by the unit-only pass.
3. KG → PIECE → UNKNOWN: retain fractional source numbers, never multiply/divide quantities, and qualify unavailable units.
4. Same-unit edit, stale version and foreign store do not start unauthorized refreshes.
5. Two loaded snapshots: the earlier writer cannot overwrite a later saved result.
6. Injected write failure after eight dates retains the checkpoint and committed product, defers retry, then resumes.
7. Concurrent claims share one lease and preserve store isolation.
8. A second unit correction during the first pass retains the new generation and restarts it safely.
9. An expired lease is reclaimed and resumes the persisted cursor.

A shared-core test also proves that an explicitly pending quantity is excluded even if a stale numeric quantity was supplied; the paired price uses only the remaining complete day.

## Release and acceptance limits

Full checks and exact-head push/PR CI are pending at document creation. No production maintenance write or provider request is required for these tests. No paid EAS build is started for this server correction. A compatible API release is required before a production edit can benefit; native PR 328 and real reimport acceptance remain part of the next grouped device recipe. This suite does not prove physical-device performance, second-device source restoration or all V1 recovery gates.
