# Import and local mutation stability — 22 October 2026

## Incident and evidence boundary

The owner reports increasing lag during successive receipt captures/product edits, 93 pending modifications, five failed Mercalys files, and missing analytical figures. This is a blocking M8 incident, taking priority over new M7 functionality. The supplied Analytics screenshot also retains a product filter (RAISIN BLANC ITALIA VRAC) and ISO week 42 **2025**, whereas the shown import names are October **2026**. This can explain that specific empty scope; it does not explain the reported freezes or prove that the stored history survives.

Read-only Sentry inspection found no new issue over the last 48 hours. Existing SQLite BUSY issue FRUITS-ET-LEGUMES-6 last occurred on 17 October. Caught batch failures were not reported to Sentry. MongoDB remote inspection remained unavailable after the connector repeated authentication instead of returning clusters. No production collection, device database, file, Outbox command or environment variable was modified during investigation. Consequently neither actual data loss nor an Inngest-quota root cause is established. The latest available native build is staging 0.1.0 (5), source 1e7684d; this source predates the current fix and PR 315's awaited file relocations.

## Verified defects and correction

- Saving a product rewrote every retained identifier and alias. A fixture with 20 aliases and one code previously creates 22 additional commands for a category-only change. It now creates exactly one; a repeated unchanged save creates none. Related records retain their versions/status/provenance. Actual changes/deletions keep the existing transactional Outbox path. Recalculation is not queued for an unchanged product or an alias/code-only edit.
- Every new Mercalys publication reparsed the whole published source history inside its transaction. A malformed unrelated historical packet could roll back a valid new import. New publication now only queues its own source plus sources explicitly superseded by an approved reconciliation. It still rolls back the complete correction if any affected source cannot be committed.
- Background publication repair held one writer transaction across the complete history. It now selects eligible dirty/unrestored sources, skips already pending commands, yields between per-source transactions, and records a stable failed local job per unreadable source. Other valid sources and pending commands remain usable. A successful retry completes the diagnostic; the same immutable command is not duplicated.
- Only the inner network sync was coalesced. Upload/repair/recalculation surrounding it could be repeated by concurrent foreground/photo/manual triggers. The whole pipeline now shares a promise per SQLite instance/account/store, releases after failure and allows a later explicit cycle.
- Outbox notifications are bounded to one per 50 ms burst. Obsolete local snapshot reads cannot replace a more recent snapshot. These reduce redundant queries and UI refreshes; they do not establish an iPhone frame-rate guarantee.
- Caught batch failures now retain stable storage categories (busy/full/integrity/IO/missing original/invalid data) and show a French actionable message. Batch-status text has explicit dark-theme foreground. Optional monitoring reports only a fixed category and operation phase, throttled per category/phase; raw native/Zod messages, SQL, source data, file paths and credentials are never sent by this reporter. A failed telemetry callback cannot fail a publication.

No migration, API/schema change, formula change, provider change, automatic recovery/reset, command deletion, data reconstruction or paid AI request is included.

## Validation and remaining acceptance

- Two regression tests fail on the previous runtime: redundant pending commands and a new publication blocked by an unrelated malformed source. Corrected runtime passes them.
- SQLite integration verifies that a forced failure after prior observations were marked superseded rolls back exactly: previous observations, product/day and department/day projections, pending command bytes and source count are unchanged.
- Repair test verifies a durable visible diagnostic, preserved valid pending command, same-source retry, no duplicate command and completion after successful retry.
- Pipeline tests cover 93 concurrent callers, exact single execution of upload/push/pull/recalculation, failure release and account/store/database isolation.
- Storage diagnostic cases cover native wrapped BUSY, extended SQLite codes, full/integrity/IO, missing file, invalid payload and cyclic causes; network/quota failures are not reclassified as SQLite errors.
- Full checks, formatting, native exports and exact-head push/PR CI are recorded in the incident artifact manifest when complete. Native device acceptance remains separate.

Before claiming the incident resolved: verify the owner's current year/product filters, inspect pending groups on the installed corrected binary, exercise successive photos and several product edits while navigating, retry one retained failed Mercalys source, verify known historical totals/product figures before and after synchronization and restart. Do not uninstall the app, clear storage, erase the Outbox, reset the database or reimport a whole archive to conceal missing figures. If totals remain absent in the correct scope, compare the local published observations/projections with durable server publications before any recovery.
