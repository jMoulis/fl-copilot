# M2 product master

Date: 2026-09-28.

## Scope

The active increment covers M2-T01 through M2-T11 from `docs/specs/IMPLEMENTATION_PLAN.md`: the synchronized product master, local-first product editing, deterministic product matching, durable local source-document metadata, native Mercalys parsing, atomic publication, and exact duplicate protection.

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
- An isolated SheetJS CE 0.20.3 adapter preserves raw values, formatted text, number formats, formulas, dates and empty worksheets from `ArrayBuffer` input.
- Generated characterization tests cover leading-zero numeric formats, metadata, distinct business dates, decimal variants, totals, empty sheets and a 10,000-row memory baseline.
- Four current Mercalys sales and waste exports pass structural characterization without being added to Git; they cover daily and weekly selections, leading-zero identifiers, decimals, totals and optional empty worksheets.
- A non-production `Plus > Diagnostic XLSX` screen reads a selected workbook locally through Expo DocumentPicker and Expo FileSystem and reports device-side timing and structural counts.
- ADR 0001 records the accepted iPhone SheetJS decision after real-file and 10,000-row device validation.
- A bounded semantic detector identifies explicit Mercalys `Vente Nette` and `Casse` reports from their report content and validated article columns, independent of filenames.
- Single-day non-detailed files are accepted because their selection date is unambiguous; multi-day files are accepted only with `Par Jour` detail and an article `Date` column.
- Weekly and monthly aggregates without daily dates are recognized but returned as unsupported, while generic, structurally incomplete and contradictory workbooks fail closed.
- ADR 0002 records daily facts as the required storage grain and recommends daily routine imports, with weekly daily-detail files allowed for catch-up.
- A source-specific sales parser normalizes identifiers, labels, business dates and the seven observed numeric measures while retaining the raw source values and zero-based worksheet row index.
- Report totals and declared line counts are returned as control metadata rather than article records; empty rows and worksheets are ignored.
- Invalid identifiers, dates, quantities and numeric values fail closed at row level, and a declared-line-count mismatch remains visible for the later validation workflow.
- An anonymized daily golden result covers metadata exclusion, leading zeroes, localized decimals, report controls and empty worksheets; the local real example produces 147 valid records without issues.
- Sales and waste use one source-specific Mercalys article parser behind explicit flow-specific entry points, so both formats share identifier, date, numeric and report-control behavior without conflating their source types.
- An anonymized waste golden result verifies that total and line-count rows are excluded; the real daily waste example produces 27 valid records and preserves its 68-unit control total separately.
- A native `Imports Mercalys` screen runs file reading, product identification and data verification locally, with visible progress and no network dependency.
- The validation summary separates ready lines from products requiring confirmation and parser anomalies, shows a short review list, and explains unsupported weekly aggregates in French.
- Product matching uses the active local product, identifier and alias catalog; only deterministic `AUTO_MATCH` results are ready, while review, ambiguity and missing products remain explicitly unresolved.
- SQLite migration 8 adds canonical daily sales and waste observations, with source-record uniqueness and date/product lookup indexes.
- Publishing copies the selected XLSX into the app document directory, computes its SHA-256 checksum, and retains it until remote upload is confirmed by later work.
- A single SQLite transaction persists the source document, immutable file metadata, parsed source records, validated observations, and a pending `SOURCE_UPLOAD_AND_REGISTER` job.
- Only deterministic product matches become observations; unresolved rows retain their raw and normalized lineage with an explicit product-review warning.
- Waste observations derive product nature from the active matched product and keep known purchase value separate from estimated value.
- Published observations use pending synchronization metadata and remain queryable after restart without any network access.
- The French publication result reports locally published and remaining lines and makes the offline state explicit.
- Exact duplicates are detected locally from the store, Mercalys source type, and SHA-256 checksum before publication.
- The duplicate check is repeated inside the publication transaction, so retries and concurrent publication attempts cannot create a second set of observations or upload jobs.
- Failed and cancelled prior imports remain reviewable and do not block a clean retry.
- The French duplicate state shows the prior import date and status, with expandable filename, source, and business-period details.

## Verification evidence

| Check                     | Result                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared contracts          | Product, identifier and alias payloads are parsed by the same domain schemas in mobile, API and sync contracts                              |
| Leading zeroes            | `0000087003017` remains an exact string through local persistence, MongoDB and device-to-device replication                                 |
| Atomic local writes       | Product-master rows and their Outbox commands commit in one SQLite transaction                                                              |
| Optimistic remote writes  | Expected remote versions gate every upsert and delete; mismatches return a durable conflict result                                          |
| Push acknowledgement race | A response for version 1 cannot overwrite a newer pending local version 2                                                                   |
| Bootstrap safety          | Deleted remote aliases are excluded, while dirty local records are never overwritten by snapshot upserts                                    |
| Two-device replication    | Device A creates, updates and deletes; device B receives the ordered changes and a new device receives the final snapshot                   |
| `pnpm check`              | Passed locally: 9 workspace typechecks and 118 tests; 10 MongoDB tests skipped locally and enabled in CI                                    |
| Build and exports         | Workspace build and Expo iOS, Android and Web exports pass                                                                                  |
| Formatting                | `pnpm format:check` and `git diff --check` pass                                                                                             |
| Offline editor            | Creating a product with an EAN and alias persists all three local records and queues three ordered commands                                 |
| Repeated offline edits    | A second save targets the first local version, allowing both commands to synchronize in order                                               |
| Conflict visibility       | Open product, identifier and alias conflicts resolve to the owning product and block an unsafe new save                                     |
| Matcher precedence        | An exact validated identifier wins before alias and label matching, while contradictory ITM8/EAN identities block                           |
| Matching safety           | Unvalidated aliases and inactive, review-only, deleted or cross-store products cannot auto-match                                            |
| Fuzzy proposals           | Candidate, review and ambiguity thresholds are configuration inputs recorded through the matcher version                                    |
| Source restart durability | Source-document, local-file and raw-record metadata remain available after closing and reopening the SQLite database                        |
| Source atomicity          | A local-file insertion failure rolls back its source document; mismatched store, URI or checksum is rejected                                |
| Source lineage            | Raw JSON and issue codes retain their stable `sourceDocumentId` relationship                                                                |
| XLSX edge cases           | Leading zeroes, report metadata, dates, decimals, totals and empty worksheets survive the adapter boundary                                  |
| Pilot XLSX compatibility  | Four current Mercalys exports parse successfully; sales/waste and daily/weekly variants retain identifiers and values                       |
| Workstation memory        | A generated 10,000-row/2.49 MB workbook parsed in 88.8 ms with 42.6 MB measured heap growth on Node 24.14.0                                 |
| iPhone adapter gate       | An earlier 27.7 KiB characterization file parsed 323 rows in 70 ms and retained 28 leading-zero cells                                       |
| iPhone stress test        | A generated 10,000-row workbook parsed in 828 ms; the result rendered and the iPhone Air remained open and usable                           |
| Mercalys source detection | Daily sales/waste examples are accepted; weekly aggregates are identified but safely rejected for missing daily dates                       |
| Mercalys sales golden     | Two anonymized rows match expected JSON; metadata, total, line count and empty worksheet do not become article records                      |
| Real daily sales example  | 147 article rows normalize for 2026-09-26; declared count and report total remain separate and no issue is reported                         |
| Mercalys waste golden     | Two anonymized rows match expected JSON; sales reports and weekly aggregates are rejected through explicit error codes                      |
| Real daily waste example  | 27 article rows normalize for 2026-09-26; the 68-unit report total remains separate and no issue is reported                                |
| Import validation summary | Sales and waste fixtures each classify one ready, one ambiguous and one unmatched row; weekly aggregate guidance is tested                  |
| Import route export       | Expo Router Web export passes with a native-only import screen and an explicit Web fallback                                                 |
| Import publication        | Ready sales/waste rows, source lineage, retained-file metadata and upload job commit atomically; an inactive product rolls everything back  |
| Offline availability      | Published observations survive database restart and do not require a remote request                                                         |
| Exact duplicate           | Re-selecting or retrying the same store/source/checksum returns the prior import and leaves document, observation, and job counts unchanged |
| Duplicate scope           | Identical checksums from different Mercalys source types remain distinct; failed/cancelled imports allow a new publication                  |

## Next work

1. Validate M2-T11 on the target iPhone by selecting an already published daily file and confirming that publication is blocked.
2. Begin M2-T12 overlap reconciliation for corrected files whose checksum differs.
3. Run the same XLSX compatibility, publication, and memory checks on target Android hardware before the Android milestone is accepted.
