# Reversible document list archives — 31 October 2026

## Approved scope

Archive and restore commercial PDFs, Mercalys batch/ZIP history and individual batch files. Use Actifs/Archivés views; preserve existing navigation, original links and review screens. This is personal list visibility per authenticated owner/store across their devices, not source deletion, publication withdrawal, processing cancellation or generic reset. A whole-store preference would require a separate product decision.

## Implementation and invariants

- Strict shared `DocumentArchive` contract; SQLite migration 62; remote `documentArchives` collection; canonical `DOCUMENT_ARCHIVE_SET` push/processed command/pull. Stable target IDs and owner-private envelopes.
- Local preference and Outbox commit atomically, with lifecycle/context checks through commit. Active pending intents coalesce without deleting audit commands; in-flight acknowledgements cannot overwrite a newer local choice. Reversible visibility uses server commit order, not client time, and does not change any business conflict policy.
- Independent capability-confirmed bounded history adopts markers even when the ordinary bootstrap cursor already passed them. Owned markers are loaded as a page batch, not one query per row. Private Outbox filtering precedes LIMIT, preventing another account’s backlog from starving the active one.
- One metadata read per screen refresh, no row subscription. Filtering precedes SQL pagination; processors retain the complete unfiltered batch. Archive actions do not prepare/publish imports or recompute analytics. Existing content remains accessible if metadata refresh fails.
- Original sources/files, sales/waste observations, receipt records, offers, jobs, provenance, deduplication and Copilot links remain unchanged. Reimporting an archived duplicate reveals it in Archivés rather than silently restoring or duplicating it.

## Executed checks

Real SQLite tests cover archive/restore/reopen, migration from v61 without changing previous tables, transaction failure rollback, stale owner/context cancellation, scope spoofing, late acknowledgements and monotone verified cache, double appui, retained old callbacks and local-vs-refresh error presentation. Snapshots include sources, local files, records, sales, waste, receipt data, batches/items, offers and jobs. A 100-file batch hides 85 rows with correct active/archive SQL pages while the processor still reads all 100. Three hundred alternating preferences leave one active pending command and retain audit history. One hundred other-owner commands cannot starve the current owner.

Mounted commercial and Mercalys navigation tests exercise restore, retained original links and archived duplicate handling, without publication or batch preparation. API HTTP tests verify authenticated manager/viewer ownership and anonymous denial. SDK tests verify negotiated bounded canonical history.

Three real Mongo replica-set tests passed through the canonical service: two SQLite devices round-trip archive/restore, history adoption beyond an existing main cursor, idempotent processed replay, two-owner privacy, old-client exclusion, spoof denial and bounded pagination. Existing Mercalys canonical and two-device sync regressions also pass (three files, six tests in the combined Mongo run). No production database writes or paid model requests were used.

Final local `pnpm check` passes: **4,554 tests passed / 732 skipped** (Mongo-dependent suites are covered separately above). Strict typecheck across ten projects, lint/structure, formatting, API build/import and free iOS/Android export pass. Both previous full-suite failures were stale migration expectations, updated to schema 62 and its explicit new table; preservation assertions remain unchanged. Exact-head CI identities are recorded at release; no phone acceptance is implied by these local checks.

## Delivery and device acceptance still required

Both exact-head push and PR CI must pass, then exact merged-master CI before API delivery. Verify staged production health/authentication and promote the same API artifact before the single grouped EAS build. Native build includes the persil follow-up PR 386, which build 18 does not contain. SQLite 62 cannot be reopened by build 18/schema 61: retain installation data and use a compatible forward correction, not reinstallation/reset. Old API without archive negotiation is not compatible with new marker synchronization.

On the new binary: archive/restore one PDF, one ZIP/batch and one file; verify originals and published values remain; reopen and synchronize; verify the personal view on another authorized device where the target already exists. Preferences do not newly replicate local Mercalys ZIP bytes or batch working folders. Verify the actual persil conflict, preparation for the intended next week and receipt occurrence navigation separately. Visual native acceptance, actual persil resolution and full V1/M8 remain open.
