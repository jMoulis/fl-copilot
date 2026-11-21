# Procurement snapshot publication backend

21 November 2026. Continues PR 559 (local staging, merged as 9fe38df).
Code-only step 2(b): no build, deployment, runtime opt-in, Product mapping or reset.

## Implemented flow

Explicit confirmation revalidates the retained original and normalized checksum.
SQLite migration 69 commits the immutable snapshot, source/record states, one
owner-scoped upload job and one Outbox command atomically. Repeated confirmation
reuses its IDs. Source documents/files/records and normal sync adapters are reused.
No Product, PA, sales, waste, analytics or AI writer is involved.

The API requires manager authority and the configured store PDV (optional pdvCode
on existing store settings), verifies the uploading account and exact source key,
rereads the original bytes and uses the shared parser. Original and normalized
SHA-256 checks are independent. Mongo migration 64 stores one immutable snapshot
per store/original checksum and source as-of. A retry reuses the publication;
changed data and simultaneous duplicate identities produce auditable conflicts.
Missing upload or missing/mismatched PDV stays pending without publishing. Correcting
the authenticated store configuration allows the same command to resume, instead
of caching a permanent refusal and requiring another import. A local pending identity cannot be
overwritten by pull, and its conflict does not block unrelated changes.

Orders, commitments, promotions, weather/news and unrelated account content remain
outside the normalized catalogue. Full JSON originals have OWNER access, including
upload completion, manifest/download, native recovery and offline opening. They
remain retained after success/failure/conflict. Normalized quotes are store-scoped.

procurementCatalogues gates publication and PDV DTOs. Older writers preserve an
omitted PDV; older readers cannot see its new field or snapshot entity. Adoption
backfills history from sequence zero. Pull loads one full procurement snapshot at
a time while ordinary change pages keep their existing size. Pending new writes
verify server support before push, also after an API rollback. Legacy transport
leaves pending commands/files intact. The production native provider has not enabled
the new capability; compatible API release and reviewed screens come first.

## Validation

The final focused run passes 172 tests across 18 suites, with transactional MongoDB
enabled. All ten workspace TypeScript projects, targeted ESLint, formatting,
structure and diff checks pass. Exact-head push/PR CI is still required before merge.
Focused suites cover source owner/MIME limits, original/native recovery,
store settings compatibility, local rollback and idempotency, immutable conflicts,
ordinary synchronization, old API adoption/rollback and real transactional Mongo
publication with a second device. Existing Mercalys/PA/two-device/store-context and
source-upload regressions are also exercised. Record exact run counts and checks
in the PR; no owner iPhone acceptance is claimed.

Private full-file rehearsal lives outside git under
maintenance/procurement-publication-2026-11-21/rehearsal. The original SHA-256 is
f4ba7bd87723aba93cba916b62fa6ffafc2e6869d7a0f7be9edae92f2e6afcac.
3,370,549 original bytes produce a 419,117-byte publication with 691 offers and 421
tariffs. The first SQLite file is reopened before push; one publication synchronizes,
the second pass pushes zero commands, and another SQLite device restores the exact
same snapshot. There is one server snapshot and zero Product/PA/sales/waste writes.
The original copy remains present with the same checksum.

MongoDB uses an isolated local test replica set. Blob upload/read is a local test
adapter: this is not production Vercel Blob qualification or an Atlas restore test.
No production account/store, paid provider or production database is touched.

## Still open

- Native runtime activation and actual private Blob round trip after API release.
- Explicit generic-to-Product links, enrichment proposals and their review.
- Runtime reference ingestion of the explicit PLU column before using the crosswalk
  in the app: current Mercalys reference parsing does not retain it. The earlier
  full-export crosswalk proof used extracted source rows, not a native PLU import.
- Approved import/product mockups and native screens, including duplicate/as-of
  conflict review/resolution. No implicit immutable-snapshot replacement.
- Complete empty-base reference → JSON → sales/waste rehearsal and final reset
  inventory/approval. Atlas backup/isolated restore remains owner-deferred.
