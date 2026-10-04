# Product roadmap

Date: 2026-10-04.

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

M3 local/remote parity, offline Today behavior and the deterministic signal detail are complete. The next product milestone is M4, which turns `Casse` into an offline receipt-capture, assisted-extraction and validation workflow.

## Milestones

| Milestone                            | Status          | Product outcome                                                                                      | Exit evidence                                                                                                    |
| ------------------------------------ | --------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| M0 — Foundation                      | Complete        | Runnable Expo application, Fastify API, authentication, environments and observability               | Native authentication and deliberate mobile/API errors validated on a physical device                            |
| M1 — Offline-first sync              | Complete        | SQLite remains usable offline and synchronizes durable, idempotent changes across devices            | Offline create, restart, exactly-once sync and second-device observation                                         |
| M2 — Product Master and Mercalys     | Complete on iOS | Trusted products and daily Mercalys sales/waste observations with source lineage and reconciliation  | Offline publication, restart persistence, reconnect, private upload and remote verification on iPhone Air        |
| M3 — Analytics and Aujourd’hui       | Complete on iOS | Deterministic daily KPI, comparisons, quality signals and at most three priorities from SQLite       | Golden local/remote parity, offline Aujourd’hui and deterministic signal detail validated on iPhone Air          |
| M4 — Waste receipt workflow          | Planned         | Photograph or import a waste receipt offline, validate assisted extraction and publish trusted waste | Offline capture survives restart; upload, extraction, validation and KPI update complete after reconnect         |
| M5 — Commercial planning             | Planned         | Import weekly commercial PDFs, validate operations and use Ma semaine offline                        | Validated plan, operation detail and execution checklist remain usable offline and synchronize later             |
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

M4 is the immediate priority because `Casse` is the next missing daily field workflow and supplies more reliable waste evidence to the deterministic analytics already delivered by M3.

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
