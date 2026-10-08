# Product roadmap

Date: 2026-10-07.

## Product objective

Fruits & Vegetables Copilot helps a department manager understand the latest trusted business state, prepare weekly work, capture field evidence and make explicit decisions from a small number of grounded recommendations.

The implementation order remains:

```text
reliable local data
→ deterministic analytics
→ operational capture and planning
→ substitution knowledge
→ bounded Copilot recommendations
→ pilot hardening
```

## Current position

The operational alpha is complete through M3 on the target iPhone Air. The application can authenticate, work offline, synchronize incrementally, manage the Product Master, ingest real Mercalys workbooks, reconcile corrected imports, retain private source files, verify imports remotely and present deterministic daily KPI and priorities from SQLite.

M2 still has two cross-platform follow-ups:

- exercise one controlled real `DIFFERENCE` on the target iPhone and verify that acknowledging it never mutates published observations;
- repeat the XLSX, publication, upload, verification and memory acceptance on representative Android hardware.

M4 receipt capture, extraction, validation, publication and recovery have been accepted on iPhone, including cashier-number confirmation on 2026-10-07. Explicit label memory has also been accepted on iPhone. M5 commercial planning is in progress: PDF capture/upload and the eight-page pilot extraction are accepted in production. Source-anchored drafts, mechanism normalization and conservative reconciliation are implemented; the review UX is being changed to a commercial brief after the pilot rejected a 140-item acknowledgement queue. Canonical operation validation, the weekly plan and execution checklist remain pending. The receipt selling-value KPI is automatically verified; a dedicated selling-value-by-date inspection UI remains a follow-up.

## Milestones

| Milestone                            | Status          | Product outcome                                                                                      | Exit evidence                                                                                                    |
| ------------------------------------ | --------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| M0 — Foundation                      | Complete        | Runnable Expo application, Fastify API, authentication, environments and observability               | Native authentication and deliberate mobile/API errors validated on a physical device                            |
| M1 — Offline-first sync              | Complete        | SQLite remains usable offline and synchronizes durable, idempotent changes across devices            | Offline create, restart, exactly-once sync and second-device observation                                         |
| M2 — Product Master and Mercalys     | Complete on iOS | Trusted products and daily Mercalys sales/waste observations with source lineage and reconciliation  | Offline publication, restart persistence, reconnect, private upload and remote verification on iPhone Air        |
| M3 — Analytics and Aujourd’hui       | Complete on iOS | Deterministic daily KPI, comparisons, quality signals and at most three priorities from SQLite       | Golden local/remote parity, offline Aujourd’hui and deterministic signal detail validated on iPhone Air          |
| M4 — Waste receipt workflow          | Complete on iOS | Photograph or import a waste receipt offline, validate assisted extraction and publish trusted waste | Offline capture survives restart; upload, extraction, validation and KPI update complete after reconnect         |
| M5 — Commercial planning             | In progress     | Import weekly commercial PDFs, validate operations and use Ma semaine offline                        | Validated plan, operation detail and execution checklist remain usable offline and synchronize later             |
| M6 — Need Units and substitution     | Planned         | Record customer needs, directed substitutes and field events such as tension or stockout             | Offline event and substitute lookup later produce an auditable remote evidence update                            |
| M7 — Copilot decisions and execution | Planned         | Show grounded French recommendations, record decisions and track execution separately                | Maximum three priorities, no unsupported number, offline decisions and deterministic fallback during AI outage   |
| M8 — Pilot release                   | Planned         | Secure, observable and recoverable iOS/Android pilot distribution                                    | Full offline/conflict matrix, recovery, accessibility, performance, security, backups and release checklist pass |

## Product delivery stages

### Data alpha — reached after M2

The application has trustworthy local and synchronized inputs. It is suitable for validating data capture, import reliability and Product Master quality, but it does not yet deliver the main daily decision experience.

### Operational alpha — reached after M3

The manager can open `Aujourd’hui` and understand the latest complete business day through sales, margin, waste, comparison and data-quality information. This is the first point where routine product value should be tested with pilot users.

### Field beta — target after M5

The application combines daily analytics, photographed waste receipts and weekly commercial planning. It supports the core daily and weekly field workflow without requiring the recommendation Copilot.

### Intelligence beta — target after M7

The application combines deterministic analytical and commercial candidates with the substitution network and bounded AI explanations. Decisions and executions remain explicit, local-first and auditable.

### Pilot release — target after M8

The complete experience is tested on representative iOS and Android devices and distributed through the intended pilot channels with monitoring, recovery and support procedures.

## Near-term sequence

### M4 — Native waste receipt workflow

1. Capture a receipt with the native camera and persist the original file locally before any network request.
2. Import an existing receipt image through the same local source-document path.
3. Model draft receipts, extracted lines and validation state for restart-safe offline work.
4. Reuse the idempotent private-blob upload pattern without exposing storage credentials to the device.
5. Normalize images remotely before structured Vision extraction.
6. Validate arithmetic and match products without silently accepting ambiguity.
7. Let the manager correct and explicitly validate extracted lines.
8. Detect duplicate receipts before publishing waste observations.
9. Recompute affected analytics after publication and keep AI pending/failure states recoverable.
10. Pass the offline capture, restart, reconnect, extraction, validation and KPI end-to-end gate.

The core M4 workflow is accepted on iPhone. Remaining pilot refinements below do not imply that multi-photo capture or piece arithmetic checks are already delivered.

### M4 pilot UX and product-mapping follow-up

The first real receipt-validation sessions identified two refinements to complete before the M4 UX gate:

- after the manager selects or confirms the associated product, collapse the selection form into a compact confirmed state and keep a clear `Modifier le produit` action;
- retain the confirmed raw-label-to-product association as auditable matching evidence. After repeated consistent confirmations, propose a store- and source-specific validated alias or mapping that can improve later deterministic matches.

An explicit `Mémoriser ce libellé` action is now implemented for a matched active product, with an `Annuler la mémorisation` action for waste-created aliases, including on published receipts. It reuses the store-scoped ProductAlias entity, atomic SQLite/Outbox mutation and existing remote sync. Repeated consistent confirmations may later propose this action; they are not required when the manager deliberately chooses it. These aliases also participate in the existing shared catalog matcher for other imports; source-specific matching scope remains a later refinement. Aliases pointing at another product, rejected/unvalidated aliases and conflicting canonical labels block creation without being overwritten. Native acceptance of explicit label memory and removal was confirmed by the pilot user after the PR #81 staging build.

This learning remains explicit and reversible. One correction must not silently retrain the Vision model, change matcher weights or create a trusted alias. Conflicting confirmations and explicit rejections prevent automatic reuse and require another human decision.

### Batch source-ingestion follow-up

A later usability increment should support selecting several Mercalys workbooks and several waste-receipt photos in one action. Every selected source must keep its own checksum, lineage, duplicate/reconciliation decision, processing state, error and retry action; one failed item must not roll back the successful items.

Before implementing multi-photo receipt import, validate the intended semantics with pilot users:

- a batch of independent ticket photos, producing one receipt per image;
- several photos or pages belonging to one receipt, producing one grouped receipt;
- or both modes through an explicit choice that never guesses the grouping silently.

Batch processing must remain local-first, use bounded upload/extraction concurrency and expose item-level progress rather than one opaque global loader.

### Receipt controls, cashier metadata and long-ticket capture

Pilot feedback confirms that normal waste tickets should cover bulk products sold by weight or by piece. The first arithmetic increment implemented only `weight × unit price`; extend source-level checks to an explicit piece quantity and per-piece price, with the same rounding tolerance. Do not derive missing quantities from amounts or rely on catalog completion to validate ticket arithmetic. Unexpected conditioned products must retain their actual nature and source evidence rather than being forced into bulk classification.

The cashier identifier printed near the bottom of the receipt is now included in the active extraction/review increment, with native pilot acceptance pending. Preserve the complete identifier as a nullable string, including its `000` prefix and any other leading zeroes. Capture confidence and source-region evidence, permit manual correction, and leave it unknown when unreadable or ambiguous instead of guessing or substituting the till/transaction number. Validate its printed context against representative tickets before implementation; it must not block otherwise valid waste publication.

For long receipts, evaluate a linked multi-photo capture mode for one logical ticket, with close-up views of the header, item sections and footer. Preserve each original and its source regions; reconcile overlapping sections without discarding legitimate repeated item occurrences or publishing them twice. This differs from a batch of independent tickets and needs an explicit grouping UX.

Review the current 2048-pixel derivative bound on representative long receipts. Prefer framing/cropping irrelevant background and processing readable sections from the immutable original over enlarging already unreadable text. Define capture guidance, legibility checks and extraction acceptance for the smallest printed amounts and cashier identifier before choosing the final image-preparation strategy.

### Analyses — Date navigation and flexible periods

A planned extension of M3 analytics will turn `Analyses` into a historical exploration workspace. Scope its delivery after the core M4 workflow, before closing the M8 pilot UX gate; the exact increment and order remain to be agreed during product review.

The intended scope includes:

- a daily view with a date picker, previous/next-day navigation and an explicit return to the latest available business day;
- calendar week, calendar month and calendar year views, alongside rolling 7-day and 28-day periods;
- a custom start/end date range;
- a separate reference-period control for J-7, comparable week, averages of comparable weekdays, N-1 and a custom reference when supported by available data;
- the selected business dates, data coverage, missing days and comparison availability displayed clearly. An incomplete month or year must not be presented as a complete period or compared silently with a full reference period;
- deterministic aggregation from trusted observations, explicit handling of incompatible units and aggregate margin calculated from totals rather than an average of line percentages;
- local navigation over available history, with clear bounds when older data is not present on the device and explicit recovery/synchronization behavior.

Before implementation, hold a dedicated UX discussion with the product owner and review representative mobile mockups. Agree how calendar navigation, presets and custom ranges fit together; how the selected period differs from its comparison period; how partial periods and missing history are explained; and how the same selection persists across product, category and waste views. Clarify the meaning of N-1 and comparable days before fixing defaults.

Acceptance should include one-handed date changes on the target iPhone, a readable month/year comparison, a custom range, incomplete-history states and offline navigation without losing the selected period. Iterate on the UX from these scenarios before committing to the final controls.

## Cross-cutting UX/UI track

UX/UI is a continuous product track rather than a separate milestone that postpones functional delivery. Its first structured pass happens now, before `Aujourd’hui` defines the visual reference for M3 and the later field workflows.

### UX-1 — Product foundations before the M3 Today screen

Define and apply a small, reusable native design system:

- product personality and visual direction appropriate for fast use in a store;
- accessible core and semantic color tokens for success, attention, conflict, offline and incomplete data;
- typography hierarchy, spacing scale, corner radii, icons and touch-target rules;
- navigation and information architecture, especially the separation of daily work, data administration, settings and diagnostics;
- reusable cards, KPI blocks, charts, lists, empty states, loading states, errors and synchronization indicators;
- representative `Aujourd’hui` states covering complete data, stale data, missing data, offline operation and actionable priorities.

The M3 implementation should use these foundations instead of introducing screen-specific colors and component styles. The visual direction should be reviewed on the target iPhone before the full Today screen is considered complete.

### UX gates during product milestones

Each milestone keeps its functional acceptance criteria and adds a focused usability review:

| Milestone | UX focus                                                                              | Evidence                                                                                                       |
| --------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| M3        | Readable daily hierarchy, trusted KPI presentation and at most three clear priorities | Today states reviewed on iPhone, including offline and incomplete-data cases                                   |
| M4        | Fast camera/import flow, correction of extracted lines and clear pending states       | A receipt can be captured and corrected one-handed without losing work                                         |
| M5        | Weekly overview, operation detail and execution checklist                             | A manager can identify the week’s required actions without opening technical screens                           |
| M6        | Product search, substitute comparison and field-event capture                         | Need and substitution choices remain understandable under time pressure                                        |
| M7        | Separation of facts, interpretation, recommendation, decision and execution           | Pilot users can explain what the Copilot knows and what action remains theirs                                  |
| M8        | Cross-platform polish, accessibility and recovery                                     | iOS/Android audit covers contrast, Dynamic Type, touch targets, screen readers, performance and error recovery |

### UX-2 — Pilot refinement in M8

Use pilot observation and product analytics to correct friction, wording and visual priority. M8 includes final accessibility and consistency work, but it must not be the first time the main workflows receive design review.

## Navigation maturity

The canonical bottom navigation is already the intended product navigation:

```text
Aujourd’hui
Ma semaine
Analyses
Casse
Plus
```

Its current maturity is uneven:

| Entry                             | Current role                 | Intended disposition                                                                                                               |
| --------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Aujourd’hui                       | Product placeholder          | Becomes the main daily screen in M3                                                                                                |
| Ma semaine                        | Product placeholder          | Becomes the weekly commercial workspace in M5                                                                                      |
| Analyses                          | Product placeholder          | Receives deeper analysis after the core M3 daily view                                                                              |
| Casse                             | Product placeholder          | Becomes the receipt capture and history workflow in M4                                                                             |
| Plus                              | Product menu                 | Remains the secondary navigation and settings area                                                                                 |
| Produits                          | Functional M2 administration | Keep, but present as data management rather than a primary daily action                                                            |
| Imports Mercalys                  | Functional M2 operation      | Keep while imports are manual; also expose contextually from Aujourd’hui when data is missing or stale                             |
| Synchronisation                   | Functional support screen    | Keep accessible through sync status and Plus, without making it a normal daily destination                                         |
| Test Sentry                       | Development diagnostic       | Hide outside non-production builds and remove from the pilot-facing menu                                                           |
| Diagnostic XLSX                   | M2 device-validation tool    | Remove from the normal pilot menu after Android acceptance; retain only behind an explicit development/debug entry if still useful |
| Conflict and verification details | Functional exception flows   | Keep hidden from tabs and open only from a relevant alert or synchronization state                                                 |

Before the M3 Today screen is treated as product-ready, the `Plus` screen should separate:

- normal user destinations;
- data administration;
- account and application settings;
- development diagnostics that must never appear in a pilot or production build.

## Product decisions to prepare

- Identify the first pilot users and stores.
- Define the expected daily Mercalys import routine and acceptable manual effort.
- Confirm the three primary Today indicators and the pilot success measures.
- Decide whether the first human pilot is iOS-first or requires Android parity before launch.
- Assemble representative waste-receipt and commercial-PDF corpora before M4 and M5.
- Define notification expectations and quiet periods before local reminders are introduced.
- Select and configure the AI provider only when a milestone requires structured extraction or recommendation generation.
- Verify the Resend sending domain before external production use, while retaining the current development sender during implementation.

## End-of-M3 product review

The technical and product foundations required for an operational alpha are present:

- `Aujourd’hui` opens from local data, identifies its exact business date and remains stable offline.
- KPI, movements and priorities are deterministic and traceable to the imported observations.
- Priorities expose their evidence and a proposed check, while keeping user decisions and execution outside M3.
- Manual Mercalys import is operational, including product confirmation, corrected-period reconciliation, private upload and remote verification.
- Waste capture is now the clearest missing daily workflow: the `Casse` tab is still a placeholder and the current source material already includes a representative bulk-waste receipt.

Pilot observation is still required to measure time saved, trust after repeated daily use and acceptable manual-import effort. These measures remain product follow-ups and do not block M4. The offline-first architecture and the dependency order for later recommendations remain unchanged.

## Confirmed receipt UX decisions — 2026-10-07

- Date review uses a French calendar selector (day/month/year display), with explicit human confirmation and ISO storage. Assisted extraction should inspect the footer for a printed French date without replacing it with capture/upload time or guessing an ambiguous year.
- The product owner approves several linked photos for one long waste ticket. This grouping mode is confirmed; independent multi-ticket batches remain a distinct use case. Design the capture/review UX and overlap reconciliation before delivery, preserving genuine repeated occurrences and all source images.

## M5 implementation start — Local PDF capture

M5-T01/T02 retain and upload the immutable weekly PDF. M5-T03/T04 page parsing and source-anchored AI extraction are accepted for the retained eight-page pilot PDF. M5-T05/T06 provide shared mechanism normalization and conservative reconciliation. M5-T07-A implemented offline transcription review but its mandatory-looking 140-item queue was rejected by the pilot. M5-T07-B now opens a source-based commercial brief with selective review and optional grouped transcription acknowledgement. No commercial operation is created merely by uploading, reading or acknowledging the document. Canonical offers/applicability, source page rendering, the weekly plan and checklist remain subsequent M5 work. See `docs/progress/M5_COMMERCIAL_PLANNING.md` for evidence.

## M5 usability clarification — Weekly brief first

Pilot feedback on 2026-10-07 rejected a mandatory 140-item transcription queue as impractical. M5 keeps its commercial-planning objective but starts document review with a source-based brief, not an extraction administration checklist. Source instructions remain consultable without a mandatory acknowledgement for each clause. Material ambiguities are grouped and surfaced before the relevant business decision; grouping never resolves missing years, conflicting prices or applicability automatically.

The pilot's primary reading order is Dramat (dramatization) and prospectus offers, followed by the document's four TG ideas and weekly basics (threshold/degressive prices and lots). Four source TG ideas do not imply four available store TGs. Relationships not explicitly extracted are not guessed from a nearby heading: a same-page offer list is labelled as such. Source references remain available.

M5 may offer optional grouped transcription confirmation of supported, unambiguous items. This does not validate product identity, store applicability, publish an offer or execute an action. Existing extraction data and human choices stay intact. A canonical weekly plan and checklist remain M5 deliverables.

M6 remains the next milestone for Need Units and substitution. The full contextual/conversational Copilot — the manager's assistant across commercial planning, analytics, waste, alternatives, decisions and execution — stays in M7. No general chat or new agent runtime is introduced in M5.

Future M5-T11 checklist idea: propose `Print signage` tasks for explicitly retained Dramat/prospectus, threshold-price and lot offers, retaining the source signage reference and requiring a separate execution confirmation. Print a document and mark a task done are separate actions; source capture alone never creates completed tasks. Source-proposed versus store-selected TGs must remain distinct.

### Current-week reading focus — 2026-10-08

The visual PDF brief defaults to the actual current ISO week in Europe/Paris. AI receives that date/week context, and a shared filter separates current sales periods from later campaigns in the same document. A short deadline due this week may remain in a separate anticipation section; this does not make a future offer active. Missing or uncertain periods are not silently assigned to the document week. Existing sources/choices stay preserved; later multi-week navigation and the full M7 Copilot remain separate scope.

### Additional anticipation tools — Deferred until the current version is complete

The product owner places further anticipation tools after completion of the current version. Keep the current weekly reading focused; do not expand this increment into a separate ordering or multi-week preparation workflow. Design and prioritize those additional tools during the subsequent product review.

A source deadline note in the current brief is not an ordering tool or a completed store action. The original PDF remains retained for later use. This follow-up does not change the canonical M6/M7 sequence or make additional anticipation tooling a release gate for the current version.

### Store offer choices — M5-T07-E

The source brief now supports retaining, modifying and withdrawing selected offers for the store, with explicit critical-field/applicability review, offline persistence, audit and incremental synchronization. Only selected offers need this review. These choices prepare planning; canonical operations, a finalized weekly plan and execution remain separate. Next: compare corrected source versions, then use retained choices for store planning and TG selection. Physical acceptance of the new choice workflow remains pending.

### Weekly preparation and TG selection — M5-T09-A

The current-week preparation uses retained store offers and explicitly declared available TG capacity. The manager selects offers, assigns named placements and may use document TG ideas as inspiration. It is a saved, audited offline draft, not a finalized plan or an installation. Source/offer changes remain visible for review instead of silently replacing decisions. Final plan validation awaits corrected-source comparison, canonical validation and known-conflict checks.

### Corrected PDF comparison — M5-T08-A

A store-scoped offline comparator now shows proposed reading changes between explicitly selected PDF documents and identifies retained choices/TG drafts that still refer to the older occurrences. Original sources and decisions remain unchanged. Partial reading/ambiguous identity never becomes a definitive deletion or an automatically adopted correction. Next: an explicit source-version decision and final plan-validation gates; this read-only comparison alone does not validate the plan.

### Reference decision after corrected PDF comparison — M5-T08-B

The manager can save a pair-specific preference for the old or corrected PDF after reviewing its differences. The choice persists offline, synchronizes with history and preserves existing retained offers/TG drafts. This preference does not assert global version activation or final plan validation. Next: canonical operation/offer validation and explicit final-plan gates using saved source/offer revisions; execution stays separately recorded.

### Selected-offer validation and preparation checks — M5-T07-F

Only selected offers in the saved draft need commercial validation. Their products, chosen dates/mechanisms, source conditions/citations and original are reviewed together; each accepted choice revision receives an immutable synchronized validation snapshot. Changed or withdrawn offers require review again, without deleting older validations or TG drafts. Targeted readiness checks surface stale selections, conflicting fixed prices, changed PDF references and empty placements. The plan remains a draft: canonical operation grouping, explicit final-plan validation and execution recording are the next M5 steps. No M7 chat is introduced here.
