# Implementation Plan — Native Offline-First Fruits & Vegetables Copilot

### M7 L5/L9 — decisions and declared realizations in Actions

Expose existing owner/store-private decisions and independent action declarations through a ten-entry local weekly follow-up. Preserve original proposal provenance, logical-deletion privacy, canonical Paris date boundaries and separate realization semantics; route to existing chat without creating business commands. Use one joined page read, retained display/page/filter, lazy opening and focus/pull/manual refresh. Coalesce calculation progress while allowing reads when returning during blocked synchronization. No new model tool, writer, sync contract or business migration. See `../qa/M7_ACTIONS_COPILOT_FOLLOWUP_2026_10_23.md` and retain full M7/M8 exit gates.

### M7 CRUD parity — inactive product metadata (23 October 2026)

Exact-ID catalogue inspection and reviewed metadata updates may include nondeleted inactive products, preserving their inactive status through the manual canonical writer. Negotiate catalogue capability 2; capability 1 keeps existing eligibility. Do not broaden automatic matching, import association, classification or retirement. Keep immutable identity, scope, current-version/child checks, private proposal authority and atomic Outbox/recomputation/restart replay. See `../qa/M7_INACTIVE_CATALOGUE_MAINTENANCE_2026_10_23.md`. No additional model tool, prompt, migration or business permission. This completes one manual/tool exception, not the full M7/M8 acceptance.


### M7 UX / M8 performance — commercial document browsing (23 October 2026)

Reuse canonical PDF/original/review/recovery services in a compact searchable/status-filtered list with ten mounted cards per page, preserved route context and synchronized review-only sources. Delay preparation mounting until requested, retain its state after folding, and replace screen polling/N+1 upload-state reads with focus/pull/manual snapshot reads and one store-scoped grouped job read. Preserve earliest-job identity, source bytes, exact recovery authority and late/error content. No network loop, schema or business command. See `../qa/M7_UX_COMMERCIAL_DOCUMENTS_2026_10_23.md`; final CI, grouped native/device acceptance and all full V1/M8 requirements remain open.

### Current M8 validation increment — manual editor session scope (23 October 2026)

Fence retained manual product-save callbacks by current owner/store/product/database/device and mount lifetime, rechecking around the existing exclusive SQLite aggregate mutation. A scope change must roll back catalogue, Outbox and recomputation together; a replacement session object with identical scope must remain usable offline. No new permission hierarchy, API/schema/migration or network requirement. Reproduce cancelled create/edit before acquisition, while queued and after writes on real SQLite; verify mounted stale-handler and delayed-writer behavior. See `../qa/M8_PRODUCT_EDITOR_SCOPE_2026_10_23.md`. This follows build 13, remains unreleased, and does not replace any full V1 or seven-workstream exit criterion.

**Product:** Fruits & Vegetables Copilot  
**Document:** `IMPLEMENTATION_PLAN.md`  
**Version:** 1.0  
**Date:** 16 September 2026  
**Specification language:** English  
**Application language:** French (`fr-FR`)  
**Primary client:** React Native + Expo  
**Architecture:** Offline-first / local-first  
**Execution target:** AI development agent + human technical review  
**Status:** Canonical implementation sequence for MVP delivery.

---

# 1. Purpose

This document converts the validated functional and technical specifications into an executable development plan.

The plan defines:

- implementation sequence;
- milestones;
- tickets/work packages;
- dependencies;
- required tests;
- mandatory acceptance criteria;
- quality gates;
- release gates;
- technical risks;
- recommended agent workflow;
- definition of done.

The agent must not redesign the architecture while implementing this plan.

---

# 2. Canonical reference documents

Implementation must remain aligned with:

```text
Copilot_FL_MVP_v0.4_EN.md

PRODUCT_AND_SUBSTITUTION_FUNCTIONAL_SPEC.md

KPI_AND_ANALYTICS_ENGINE_FUNCTIONAL_SPEC.md

COMMERCIAL_PLANNING_AND_PROMOTION_ENGINE_FUNCTIONAL_SPEC.md

I_COPILOT_AND_RECOMMENDATION_ENGINE_FUNCTIONAL_SPEC.md

DATA_INGESTION_AND_DOCUMENT_PROCESSING_FUNCTIONAL_SPEC.md

TECHNICAL_ARCHITECTURE_AND_IMPLEMENTATION_SPEC.md

DATABASE_AND_API_CONTRACTS.md

UX_FLOWS_AND_SCREEN_SPEC.md
```

If implementation finds a contradiction between documents:

1. stop the affected ticket;
2. record the contradiction;
3. preserve existing functional invariants;
4. request a human decision before changing architecture.

---

# 3. Non-negotiable architecture baseline

The agent MUST implement:

```text
React Native + Expo
Expo Router
TypeScript strict mode

SQLite local operational datastore
Drizzle local DB access

stable client-generated UUIDs
Outbox local mutations
bidirectional incremental sync
remote change feed
domain-specific conflicts

Fastify remote API
MongoDB Atlas durable remote data
Vercel Blob private source files
Inngest remote workflows

shared deterministic analytics/substitution rules
remote AI processing
```

---

# 4. Explicitly prohibited architectural drift

Do not replace the agreed baseline with:

- synchronous remote-request-first screens;
- generic cloud-only state;
- all-business-state in TanStack Query;
- last-write-wins for every conflict;
- server-generated replacement IDs for offline entities;
- independent mobile KPI formulas;
- generic one-prompt AI business logic;
- AI-computed official KPI values;
- direct database access from the mobile app.

---

# 5. Implementation strategy

The MVP is built vertically, but only after the offline-first platform foundation is trustworthy.

High-level sequence:

```text
M0 Foundation
  ↓
M1 Sync Core
  ↓
M2 Product Master + Local Mercalys
  ↓
M3 Analytics + Today
  ↓
M4 Waste Receipt
  ↓
M5 Commercial Planning
  ↓
M6 Need Units + Substitution
  ↓
M7 Copilot + Decisions + Execution
  ↓
M8 Hardening + Pilot Release
```

---

# 6. Why this order

The recommendation layer depends on trustworthy structured data.

Therefore:

```text
data reliability
before
AI recommendation
```

and:

```text
local persistence + synchronization
before
business feature scale-out
```

and:

```text
deterministic KPI engine
before
Copilot explanations
```

---

# 7. Development-agent working rules

For each ticket, the agent must:

1. read the relevant source specs;
2. identify dependencies;
3. implement the smallest complete vertical slice;
4. add/update Zod contracts first when API data changes;
5. add migrations before repository code;
6. add deterministic tests before or with business logic;
7. run lint/typecheck/tests;
8. update fixtures when schema intentionally changes;
9. never silently weaken acceptance criteria;
10. produce a concise implementation summary.

---

# 8. Branch / commit discipline

Recommended ticket branch:

```text
feature/Mx-Txx-short-description
```

Each ticket should produce logically reviewable commits.

Avoid one huge milestone commit.

---

# 9. Definition of Ready for a ticket

A ticket may start when:

- dependencies are completed;
- affected schemas are known;
- source spec sections are identified;
- expected behavior is testable;
- no unresolved architecture decision blocks it.

---

# 10. Definition of Done for a ticket

A ticket is done only when:

- implementation compiles;
- TypeScript passes strict mode;
- unit/integration tests pass;
- acceptance criteria pass;
- offline behavior is tested where applicable;
- sync behavior is tested where applicable;
- French UI labels are present;
- error/empty/loading states are implemented;
- no abandoned architecture concept is introduced;
- documentation/contracts are updated if needed.

---

# 11. Milestone 0 — Repository & Native Foundation

**Goal:** Create a buildable native application and remote service with local database, environments and observability.

---

# 12. M0 dependencies

None.

---

# 13. M0-T01 — Create monorepo

Deliver:

```text
apps/mobile
apps/api

packages/domain
packages/sync-contracts
packages/analytics-core
packages/substitution-core
packages/commercial-core
packages/api-client
packages/test-fixtures
```

Configure:

- pnpm;
- Turborepo;
- TypeScript strict;
- ESLint;
- formatting;
- path aliases.

Acceptance:

```text
pnpm install
pnpm typecheck
pnpm test
```

run from root.

---

# 14. M0-T02 — Initialize Expo application

Install/configure:

```text
Expo
React Native
Expo Router
NativeWind
React Hook Form
Zod
Zustand
TanStack Query
```

Create bottom tabs:

```text
Aujourd’hui
Ma semaine
Analyses
Casse
Plus
```

Acceptance:

- iOS development build launches;
- Android development build launches;
- navigation works;
- French labels render.

---

# 15. M0-T03 — Native design-system primitives

Implement:

```text
AppScreen
AppHeader
MetricCard
SectionCard
StatusBadge
PrimaryButton
SecondaryButton
InlineAlert
EmptyState
SyncState
BottomSheet wrapper
```

Acceptance:

- components support dynamic text size;
- status is not conveyed by color only;
- touch targets satisfy mobile accessibility guidance.

---

# 16. M0-T04 — Initialize Fastify API

Create:

```text
apps/api
```

Configure:

- Fastify;
- Zod validation;
- structured error responses;
- request IDs;
- health endpoint;
- environment configuration.

Acceptance:

```text
GET /health
```

returns success in local environment.

---

# 17. M0-T05 — MongoDB infrastructure

Implement:

- native MongoDB driver;
- pooled connection;
- environment configuration;
- migrations collection;
- test database support.

Acceptance:

- API health includes DB status;
- integration test creates/reads test entity.

---

# 18. M0-T06 — Local SQLite + Drizzle foundation

Install/configure:

```text
expo-sqlite
Drizzle ORM
```

Create migration runner.

Initial tables:

```text
app_metadata
sync_inbox_state
sync_outbox
sync_conflicts
local_jobs
local_files
```

Acceptance:

- fresh install migrates;
- restart preserves data;
- migration version is readable.

---

# 19. M0-T07 — Stable device identity

Generate/persist:

```text
deviceId
```

using secure random UUID.

Acceptance:

- survives normal app restart;
- is different across clean installs.

---

# 20. M0-T08 — Authentication foundation

Implement native email code flow:

```text
login
verify code
access token
refresh token
```

Use:

```text
expo-secure-store
```

Acceptance:

- online login works;
- session survives restart;
- logout clears authenticated local access correctly.

---

# 21. M0-T09 — Environments & EAS

Configure:

```text
development
staging
production
```

Create:

```text
eas.json
```

Acceptance:

- development build succeeds;
- staging API URL can differ from production;
- secrets are not committed.

---

# 22. M0-T10 — Observability foundation

Add Sentry to:

```text
mobile
API
```

Add structured remote logs.

Acceptance:

- deliberate test error appears in non-production monitoring;
- no raw source file content is logged.

---

# 23. Milestone 0 exit gate

Must prove:

```text
native app builds
Fastify API runs
MongoDB works
SQLite works
auth works
environment isolation exists
```

Do NOT proceed to business features if SQLite migrations or auth persistence remain unstable.

---

# 24. Milestone 1 — Offline-First Synchronization Core

**Goal:** Prove the architecture can safely create local data, survive restart, synchronize once, and reach a second device.

This milestone is mandatory before product/import work.

---

# 25. M1-T01 — Shared sync DTOs

Implement Zod contracts:

```text
SyncCommand
SyncPushRequest
SyncPushResponse
SyncChangeEnvelope
SyncPullResponse
BootstrapResponse
ApiErrorDto
```

Acceptance:

- mobile and API import same schemas;
- contract tests pass.

---

# 26. M1-T02 — Outbox repository

Implement:

- monotonic local sequence;
- pending query;
- state transitions;
- retry metadata.

Acceptance:

- commands survive app restart;
- oldest commands are returned first.

---

# 27. M1-T03 — Atomic local mutation helper

Provide utility ensuring:

```text
local business write
+
Outbox insert
```

in one SQLite transaction.

Create test entity initially.

Acceptance:

- simulated error before commit leaves neither record nor Outbox;
- successful transaction creates both.

---

# 28. M1-T04 — Remote processedCommands

Mongo collection:

```text
processedCommands
```

Unique command ID.

Acceptance:

- same command twice produces one domain mutation.

---

# 29. M1-T05 — Remote change sequence

Implement:

```text
syncStoreCounters
syncChanges
```

Atomic per-store sequence.

Acceptance:

- concurrent mutations produce unique ordered sequences.

---

# 30. M1-T06 — Push endpoint

Implement:

```text
POST /api/v1/sync/push
```

Support statuses:

```text
APPLIED
ALREADY_APPLIED
CONFLICT
REJECTED
RETRYABLE_ERROR
```

Acceptance:

- mixed batch returns per-command result;
- one rejected command does not roll back unrelated valid command.

---

# 31. M1-T07 — Pull endpoint

Implement:

```text
GET /api/v1/sync/pull
```

Acceptance:

- change pages ordered by sequence;
- cursor advances only after local transaction commits.

---

# 32. M1-T08 — Bootstrap endpoint

Implement initial bootstrap with:

- store;
- test replicated entity;
- initial cursor.

Acceptance:

- fresh device receives snapshot;
- later pull returns only subsequent changes.

---

# 33. M1-T09 — Mobile SyncService

Implement:

```text
push
pull
sync lock
backoff
foreground trigger
manual trigger
```

Acceptance:

- no competing sync cycles;
- sync retries safely.

---

# 34. M1-T10 — Sync status UI

Create:

```text
Plus > Synchronisation
```

States:

```text
Synchronisé
Hors connexion
À synchroniser
Synchronisation…
Conflit
Erreur
```

Acceptance:

- pending count reacts to Outbox.

---

# 35. M1-T11 — Conflict storage & generic shell

Persist conflict records locally.

Create conflict detail skeleton.

Acceptance:

- remote version conflict does not destroy local payload.

---

# 36. M1-T12 — Two-device proof test

Scenario:

```text
Device A offline creates test entity
A restarts
A reconnects
A syncs
Device B pulls
```

Expected:

```text
same stable ID
one remote entity
B receives entity
```

This is a hard milestone gate.

---

# 37. Milestone 1 exit gate

No business milestone may begin until:

- Outbox atomicity passes;
- duplicate command test passes;
- cursor retry test passes;
- two-device propagation passes;
- conflict preserves local data.

---

# 38. Milestone 2 — Product Master & Local Mercalys Ingestion

**Goal:** Build trustworthy local product data and offline sales/waste Excel import.

---

# 39. M2-T01 — Product schemas and repositories

Implement local/remote:

```text
Product
ProductIdentifier
ProductAlias
```

Acceptance:

- CRUD contracts;
- sync replication;
- leading-zero identifiers preserved.

---

# 40. M2-T02 — Product editor UI

Screen fields:

```text
Libellé
Catégorie
Nature
Unité de vente
Conditionnement
Identifiants
Aliases
```

Acceptance:

- offline edit creates Outbox;
- conflict is visible.

---

# 41. M2-T03 — Product matching engine

Implement sequence:

```text
exact identifier
approved alias
canonical normalized label
fuzzy candidates
```

Acceptance:

- exact identifier takes precedence;
- ITM8/EAN conflict blocks auto-match.

---

# 42. M2-T04 — SourceDocument local model

Implement:

```text
source_documents
source_records
local_files
```

Acceptance:

- file metadata persists across restart;
- checksum stored.

---

# 43. M2-T05 — Native XLSX adapter spike

Select/test React Native-compatible parser with real pilot fixtures.

Mandatory tests:

- leading zeroes;
- report metadata;
- business date;
- decimal values;
- totals;
- empty sheets;
- memory usage.

Output:

```text
ADR / adapter decision
```

Do not proceed to full parser until this spike passes target devices.

---

# 44. M2-T06 — Mercalys source detection

Implement:

```text
MERCALYS_SALES
MERCALYS_WASTE
```

based on report semantics.

Acceptance:

- wrong/unrecognized workbook is rejected safely.

---

# 45. M2-T07 — Local Mercalys Sales parser

Normalize article rows.

Exclude:

- totals;
- line-count metadata;
- empty sheets.

Acceptance:

- golden fixture expected JSON passes.

---

# 46. M2-T08 — Local Mercalys Waste parser

Same quality requirements.

Acceptance:

- total row excluded;
- golden fixture passes.

---

# 47. M2-T09 — Local import validation UX

Implement:

```text
Lecture du fichier
Identification des produits
Vérification des données
```

Summary:

```text
ready
ambiguous products
errors
```

---

# 48. M2-T10 — Local import publication

On user validation:

- publish local observations;
- preserve source lineage;
- queue remote source upload/registration.

Acceptance:

- app can use data while offline.

---

# 49. M2-T11 — Exact duplicate detection

Local checksum detection.

Acceptance:

- same exact file cannot double-publish.

---

# 50. M2-T12 — Overlap reconciliation

Implement classifications:

```text
UNCHANGED
ADDED
REMOVED
MODIFIED
AMBIGUOUS
```

Build native review UI.

Acceptance:

- corrected file is not blindly added.

---

# 50A. M2-T12A — Imported product confirmation

Resolve Mercalys lines that do not match the local Product Master.

- group repeated rows by exact source identifier;
- allow an explicit link to a proposed existing product;
- allow explicit creation from a unique unknown ITM8/EAN;
- retain unknown category, nature and sales unit as `UNKNOWN`;
- persist validated source identifiers locally with Outbox commands;
- rerun deterministic matching without reselecting the workbook.

Acceptance:

- an empty Product Master can be initialized explicitly from a daily Mercalys
  file without entering every reference manually;
- ambiguous mappings are never batch-validated;
- leading-zero identifiers remain strings;
- resolved lines become ready for local publication immediately.

---

# 51. M2-T13 — Vercel Blob source upload

Implement short-lived client upload authorization through Fastify and a native
Vercel Blob upload queue. Keep the Blob read-write credential server-side.

Acceptance:

- offline source waits;
- reconnect uploads exactly once.

---

# 52. M2-T14 — Remote import verification

Remote parser/verification.

Acceptance:

```text
MATCH
DIFFERENCE
FAILED
```

works.

---

# 53. M2-T15 — Verification conflict UX

If remote normalization differs:

do not silently replace local data.

Screen:

```text
Vérification distante différente
```

---

# 54. M2 exit gate

Must demonstrate with network disabled:

```text
choose XLSX
parse
match products
publish locally
restart app
data remains
```

Then reconnect:

```text
upload
remote verify
sync result
```

---

# 55. Milestone 3 — Shared Analytics & `Aujourd’hui`

**Goal:** Compute deterministic KPIs locally and remotely using one implementation.

---

# 56. M3-T01 — Decimal utilities

Implement canonical decimal serialization/conversion.

Acceptance:

```text
0.580
4.88
money calculations
```

round-trip exactly.

---

# 57. M3-T02 — Analytics-core package

Implement initial KPI registry and formulas:

- sales;
- quantity;
- purchase values;
- margin;
- waste known/estimated;
- ratios;
- comparison availability.

Acceptance:

- unit tests;
- missing vs zero tests;
- unit compatibility tests.

---

# 58. M3-T03 — ProductDailyPerformance builder

Run locally and remotely.

Acceptance:

- same fixture produces identical serialized result.

---

# 59. M3-T04 — DepartmentDailyPerformance builder

Acceptance:

- does not average line margin percentages incorrectly;
- aggregate formula tests pass.

---

# 60. M3-T05 — Comparison engine

Implement:

```text
J-7
previous comparable week
average previous same weekdays
N-1 when available
before operation
```

Acceptance:

- missing reference returns unavailable;
- actual sample size preserved.

---

# 61. M3-T06 — Data quality engine

Implement source/coverage quality fields.

Acceptance:

- partial local import reflected in quality.

---

# 62. M3-T07 — Analytical candidate engine

Initial candidates:

```text
WASTE_SPIKE
SALES_DROP
MARGIN_DROP
DATA_QUALITY_ALERT
```

Deterministic only.

---

# 63. M3-T08 — Local recomputation scheduler

Scoped recompute by product/date.

Acceptance:

- UI stays responsive during pilot-sized import.

---

# 64. M3-T09 — Remote analytics confirmation

Use same analytics-core.

Acceptance:

- local vs remote parity suite passes.

---

# 65. M3-T10 — `Aujourd’hui` screen

Implement:

```text
business date
Ventes
Marge
Casse
max 3 priorities placeholder/deterministic candidates
main movements
tensions
quality alerts
```

Reads SQLite only.

---

# 66. M3-T11 — Offline Today acceptance

Disable network.

Expected:

- screen opens from SQLite;
- exact business date shown;
- local-only KPI marker when relevant;
- pull-to-refresh does not clear content.

## M3-T12 — Deterministic signal detail

Open a read-only explanation from each Today priority.

Expected:

- exact current and J-7 values remain visible offline for comparison signals;
- absolute and percentage differences are labelled;
- incomplete inputs and the analytical quality score are explicit;
- the proposed action is clearly separated from a recorded decision;
- product editing remains a secondary destination;
- no M7 decision or execution behavior is simulated.

---

# 67. M3 exit gate

Hard requirement:

```text
same golden fixture
→ same local result
→ same remote result
```

No Copilot milestone begins if parity is unresolved.

---

# 68. Milestone 4 — Native Waste Receipt Workflow

**Goal:** Capture waste offline and complete AI-assisted validation after synchronization.

---

# 69. M4-T01 — Camera capture

Implement `expo-camera`.

Acceptance:

- permission flow;
- framing;
- retake;
- persistent local source file.

---

# 70. M4-T02 — Image import

Implement `expo-image-picker`.

Acceptance:

- supported image is copied into app-owned persistent storage.

---

# 71. M4-T03 — Offline receipt domain model

Implement:

```text
waste_receipts
waste_lines
```

Acceptance:

- receipt survives app termination.

---

# 72. M4-T04 — Receipt upload queue

Use source upload system.

Acceptance:

- queued offline;
- upload resumes after connectivity.

---

# 73. M4-T05 — Remote image normalization

Implement Sharp adapter.

Acceptance:

- orientation and extraction-ready derivative.

---

# 74. M4-T06 — Receipt Vision AI

Structured output only.

Extract:

```text
label
quantity/weight
unit price
total
confidence
```

Acceptance:

- schema-invalid AI result never reaches domain state.

---

# 75. M4-T07 — Arithmetic validator

Application code checks:

```text
weight × unit price ≈ total
```

Acceptance:

- mismatch creates warning;
- no silent correction.

---

# 76. M4-T08 — Receipt product matching

Reuse ProductMatcher.

Acceptance:

- packaged and bulk lines can coexist.

---

# 77. M4-T09 — Receipt validation UI

Implement:

- image preview;
- date confirmation;
- grouped repeated lines;
- line correction;
- ambiguous products.

---

# 78. M4-T10 — Duplicate receipt detection

Implement exact image/checksum first; heuristic candidate later.

Acceptance:

- same image twice flags duplicate;
- same product/day alone does not.

---

# 79. M4-T11 — Waste publication

After validation:

- local WasteObservation;
- KPI recomputation;
- Outbox as needed.

Critical acceptance:

```text
waste does not modify sales
```

---

# 80. M4-T12 — AI pending/failure UX

States:

```text
En attente de connexion
Analyse en cours
Échec
À valider
```

Manual work remains possible.

---

# 81. M4 offline end-to-end gate

Scenario:

```text
network off
capture receipt
kill app
restart
receipt exists
network on
upload
AI extraction
validate
local waste KPI updates
remote sync confirms
```

---

# 82. Milestone 5 — Commercial PDF & Weekly Planning

**Goal:** Import weekly commercial PDF, extract structured operations remotely, and use the resulting plan offline.

---

# 83. M5-T01 — PDF local source capture

Use document picker.

Acceptance:

- PDF persists locally while offline;
- status = analysis pending.

---

# 84. M5-T02 — PDF upload/job orchestration

Acceptance:

- one source → one extraction workflow;
- retries idempotent.

---

# 85. M5-T03 — Deterministic page text extraction

Implement remote `pdfjs-dist` adapter.

Persist page references.

---

# 86. M5-T04 — Commercial Document AI

Extract structured:

```text
operation
offer
dates
mechanisms
deadlines
instructions
TG
market signals
```

Acceptance:

- structured Zod schema;
- source page traceability.

---

# 87. M5-T05 — Mechanism normalization

Implement:

```text
FIXED_PRICE
PRICE_CEILING
THRESHOLD_PRICE
CARD_BENEFIT
LOT
purchase condition
```

Acceptance:

- strict `<` is preserved;
- supplier discount not customer discount.

---

# 88. M5-T06 — Offer de-duplication/conflict

Acceptance:

- detail + recap produces one offer with multiple references;
- materially different price/date creates conflict.

---

# 89. M5-T07 — Extraction validation UI

Implement native issue-by-issue review for material ambiguities, entered from a source-based commercial summary. Do not require acknowledging every informational extraction block. Support explicit grouped transcription confirmation only for unambiguous, source-supported items; it is not offer publication or applicability validation.

Pilot reading order: Dramat/prospectus, source TG ideas, threshold-price/lot weekly basics. The full conversational Copilot remains M7.

---

# 90. M5-T08 — Corrected PDF version workflow

Old/new structured comparison.

Acceptance:

- no silent overwrite.

---

# 91. M5-T09 — `Ma semaine` screen

Implement:

```text
week selector
max 3 priorities
deadlines
operations
TG/merchandising
market tensions
substitutes placeholder
weather/calendar context
```

Reads SQLite.

---

# 92. M5-T10 — Operation detail

Implement:

- exact mechanism display;
- applicability;
- execution checklist;
- source reference.

---

# 93. M5-T11 — Offline execution checklist

Follow-up: propose signage-printing tasks from retained commercial offers, with source references, separate store choice and explicit execution status.

Mark:

```text
TODO
DONE
SKIPPED
NOT_APPLICABLE
```

locally.

Acceptance:

- sync later;
- partial execution visible.

---

# 94. M5-T12 — Context providers

Add:

- weather;
- public holidays;
- school holidays.

Acceptance:

- provider failure does not block commercial plan.

---

# 95. M5-T13 — Local deadline notifications

Schedule known deadlines on device.

Acceptance:

- reminder can fire while offline.

---

# 96. M5 exit gate

User can:

```text
import PDF
wait for extraction
validate
view week offline
complete checklist offline
sync later
```

---

# 97. Milestone 6 — Need Units & Substitution Network

**Goal:** Build behavioral substitution model and field-event learning.

---

# 98. M6-T01 — Need Unit entities

Implement local/remote CRUD and sync.

---

# 99. M6-T02 — Product memberships

Many-to-many Product ↔ NeedUnit.

Acceptance:

- overlapping Need Units supported.

---

# 100. M6-T03 — Directed substitution relationships

Implement:

```text
A → B
```

independently of:

```text
B → A
```

Acceptance:

- unique edge scope enforced.

---

# 101. M6-T04 — Product substitution UI

Product sheet shows:

```text
relation
confidence
price compatibility
margin context
evidence count
```

---

# 102. M6-T05 — `Signaler` native flow

Create offline store events:

```text
Tension
Stock faible
Rupture
Qualité
Prix
Fournisseur
```

Acceptance:

- appears immediately locally;
- syncs once.

---

# 103. M6-T06 — SubstitutionEvidence engine

Remote deterministic analysis uses synchronized event + sales.

Acceptance:

- daily data only; no fabricated hourly response.

---

# 104. M6-T07 — Conservative score update

Rules:

- repeated evidence increases confidence gradually;
- one extreme observation cannot drastically change score;
- rejected relationship never auto-reactivates.

Acceptance tests mandatory.

---

# 105. M6-T08 — Score history/audit

Persist updates with evidence links.

---

# 106. M6-T09 — Offline substitute lookup

Validated graph replicated to SQLite.

Acceptance:

- product → substitutes works with network disabled.

---

# 107. M6-T10 — Weekly substitution integration

Market tension in commercial plan surfaces substitute candidates.

---

# 108. M6-T11 — Promotion overlap detection

Use Need Unit/substitution network.

Acceptance:

- warns without quantified causal cannibalization.

---

# 109. M6 exit gate

Demonstrate:

```text
offline stockout event
→ local substitute lookup
→ sync
→ later remote evidence
→ score/confidence update
→ device pulls update
```

---

# 110. Milestone 7 — Copilot, Decisions, Execution & Review

**Goal:** Add bounded AI recommendations on top of deterministic candidates.


**Approved scope update — 11 October 2026:** Chat is the primary workspace; current manual business functions are tools. The revised delivery sequence, explicit CRUD coverage, inline missing-information forms, multi-chat/shared knowledge, compaction and constrained implantation images are in `../M7_CONVERSATIONAL_DELIVERY_PLAN.md`. T01–T05 are completed. Retain T06–T15, deliver additional T16–T29 below, and run the expanded M7 exit gate before M8. This supersedes the initial guided-follow-up-only MVP preference, while preserving canonical architecture/invariants.

---

# 111. M7-T01 — Candidate aggregator

Merge:

```text
analyticalCandidates
weeklyCommercialCandidates
```

Attach context.

No prose.

---

# 112. M7-T02 — Eligibility filter

Suppress/downgrade:

- invalid entity;
- insufficient quality;
- rejected relation;
- non-applicable operation;
- missing required cost;
- obsolete deadline.

---

# 113. M7-T03 — Deterministic priority scoring

Persist score components.

Acceptance:

- deadline urgency can outrank lower urgency;
- low-value +500% signal is not automatically priority one.

---

# 114. M7-T04 — Candidate conflict detection

Examples:

```text
increase exposure
vs
reduce exposure
```

must create trade-off.

---

# 115. M7-T05 — AI provider adapter

Create remote interface for:

```text
Copilot generation
```

Configuration controls model.

---

# 116. M7-T06 — Copilot structured generation

Output:

```text
French summary
recommendations
confidence
risks
missing data
measurement
```

Max three priorities.

---

# 117. M7-T07 — Grounding validator

Block:

- unsupported numbers;
- unknown product IDs;
- invalid dates;
- fourth priority;
- invalid recommendation type.

Hard gate.

---

# 118. M7-T08 — Deterministic fallback

If AI unavailable:

show structured deterministic recommendations/templates.

---

# 119. M7-T09 — Primary native chat and progressive recommendation detail UX

Implement the approved primary conversation (composer, attachments, progress/retry, forms, history and topic switching) and progressively revealed recommendation detail. Prototype approval T16 precedes implementation. No new primary tab without owner UX agreement.

Detail sections:

```text
Faits
Lecture
Action proposée
Objectif
Points de vigilance
Confiance
Données manquantes
À mesurer
```

---

# 120. M7-T10 — Decision flow

Implement local-first:

```text
Accepter
Modifier
Reporter
Refuser
```

Acceptance:

- works offline;
- creates Outbox.

---

# 121. M7-T11 — Recommendation staleness

When relevant facts change:

```text
STALE
```

UX:

```text
À recalculer
```

---

# 122. M7-T12 — Execution tracking

Separate action entity.

Acceptance:

```text
Accepted ≠ Executed
```

---

# 123. M7-T13 — Post-action review

Remote analytics:

```text
before
during
after
```

Copilot summarizes observed result without causal overclaim.

---

# 124. M7-T14 — Counter-promotion scenario

Use deterministic scenario engine.

Acceptance:

```text
break-even threshold ≠ forecast
```

Unknown purchase cost blocks margin-based numeric recommendation.

---

# 125. M7-T15 — Offline recommendation decisions

Test decision created offline against recommendation that changes before sync.

Expected:

- preserve decision intent;
- conflict/stale handling;
- no silent execution.

---

# 126. M7 golden Copilot suite

Implement at least:

```text
waste spike high-quality
waste spike stock unknown
sales drop with stockout
strong substitute response
substitute simultaneously promoted
weekly pre-order deadline
market tension without store stockout
incomplete promotion execution
promotion growth with confounder
counter-promo known cost
counter-promo unknown cost
missing N-1
low-impact high percentage
critical data quality
AI unavailable
```

---

# 127. M7 exit gate

Copilot must:

- show max 3 priorities;
- use French;
- contain no unsupported number;
- keep facts vs interpretation separate;
- allow decisions offline;
- keep execution separate;
- survive AI outage.

---

# 128. Milestone 8 — Hardening & Pilot Release

**Goal:** Make the product safe and reliable for real store use.

---

# 129. M8-T01 — Full offline test matrix

Test:

```text
offline from launch
network loss mid-import
network loss mid-upload
network restored
app terminated with Outbox
app terminated during local import
```

---

# 130. M8-T02 — Two-device conflict suite

Required entities:

```text
Product
NeedUnit
StoreEvent
Recommendation Decision
ExecutionInstruction
```

---

# 131. M8-T03 — SQLite migration recovery

Test upgrade from each supported local schema version.

Outbox must survive migration.

Automated evidence (20 October 2026): `apps/mobile/src/db/migration-preservation.test.ts` exercises every declared v1–v60 upgrade/reopen, each pre-commit rollback/retry boundary and seven real process SIGKILL/WAL recoveries. Preserve queued command identities/payloads/order/attempts, files/bytes, device identity, conflict versions and cursors; retain sequence high-water marks and scope interrupted-send recovery. No runtime/migration change. This supports T03 but does not prove native hardware acceptance, corrupted-database repair or the T12 production restore rehearsal. See `../qa/M8_SQLITE_UPGRADE_PRESERVATION_2026_10_20.md`.

---

# 132. M8-T04 — Local DB recovery

Simulate corruption/rebootstrap recovery.

Preserve recoverable unsynchronized source files.

20 October increment: confirmed startup isolation, verified DB/WAL/SHM snapshots before close, installation-bound durable location routing, fresh migrated DB/re-authentication and canonical bootstrap exercised automatically. Originals/old unsent changes are retained without replay; same-owner metadata salvage and requeue plus native acceptance remain open. See `../qa/M8_LOCAL_DATABASE_RECOVERY_2026_10_20.md`; this does not close T04.

---

# 133. M8-T05 — Storage cleanup

Implement retention policy.

Never remove unsynchronized files.

---

# 134. M8-T06 — Security review

Check:

- token rotation;
- store authorization;
- source signed URLs;
- upload MIME validation;
- unauthorized entity access;
- command replay;
- logout local wipe behavior.

---

# 135. M8-T07 — Accessibility pass

Test:

- VoiceOver;
- TalkBack;
- dynamic type;
- touch targets;
- status labels.

---

# 136. M8-T08 — Performance benchmark

On representative iOS/Android devices:

- app startup from local DB;
- local XLSX parse;
- KPI recompute;
- product search;
- sync of normal backlog.

Document benchmark results.

---

# 137. M8-T09 — Battery/network review

Verify:

- no aggressive polling;
- no unnecessary background loops;
- no repeated AI requests;
- delta sync only.

---

# 138. M8-T10 — Observability dashboard

Track:

```text
crashes
sync error rate
oldest Outbox age
conflicts
local import failures
remote verification differences
AI failures
grounding failures
job latency
```

---

# 139. M8-T11 — Push notification hardening

Verify:

- token refresh;
- disabled permissions;
- local deadline notifications;
- push deep links;
- push failure does not break state.

---

# 140. M8-T12 — Production backup / restore rehearsal

Test:

```text
Mongo restore
source object access
read-model rebuild
```

---

# 141. M8-T13 — EAS release pipeline

Create:

```text
staging build
TestFlight build
Google Play internal build
production profiles
```

---

# 142. M8-T14 — Pilot checklist

Human pilot readiness review:

- correct store config;
- product master seeded/importable;
- auth email works;
- source storage private;
- notifications policy decided;
- monitoring live;
- support/recovery process documented.

---

# 143. M8 exit gate

MVP may be piloted only when:

```text
offline data survives restart
sync is idempotent
conflicts are recoverable
Mercalys local import works
KPI local/remote parity passes
waste flow works
commercial planning works
substitution works offline
Copilot grounding passes
backup/recovery tested
```

---

# 144. Cross-milestone testing rules

Every milestone runs:

```text
lint
typecheck
unit tests
integration tests
relevant native E2E
```

No milestone closes with ignored failing tests.

---

# 145. Golden fixture ownership

Keep anonymized fixtures in:

```text
packages/test-fixtures
```

At minimum:

```text
Mercalys sales XLSX
Mercalys waste XLSX
waste receipt image
commercial weekly PDF
analytics golden dataset
Copilot golden contexts
```

---

# 146. Fixture versioning

When intentional parser/business behavior changes:

- increment fixture expectation version;
- document reason;
- do not casually rewrite expected output to make tests pass.

---

# 147. API contract test policy

Every endpoint requires:

- valid request test;
- validation error test;
- authorization test;
- store-isolation test;
- response-schema validation.

---

# 148. Sync contract test policy

Every syncable entity requires tests for:

```text
create
update if allowed
duplicate command
pull propagation
stale version
delete/tombstone if applicable
```

---

# 149. Offline E2E policy

Every user-created syncable workflow must have at least one native E2E scenario with network disabled during creation.

---

# 150. AI test policy

CI uses deterministic fake AI.

Live-provider tests:

- separate;
- rate/cost limited;
- not required for every commit.

---

# 151. Grounding quality gate

A release cannot ship if automated tests show the Copilot can display unsupported numerical values.

This is a release-blocking defect.

---

# 152. Business invariant quality gate

Release-blocking examples:

- waste changes sales;
- missing reference displayed as zero;
- packaged receipt item classified as bulk solely due to source;
- accepted recommendation marked executed;
- card benefit converted into direct price reduction;
- market tension treated as store stockout;
- substitution relationship made symmetric automatically.

---

# 153. Offline-first quality gate

Release-blocking examples:

- field event cannot be created without network;
- receipt photo lost after app restart;
- primary screen requires remote request to display synchronized local data;
- duplicate retry creates duplicate entity;
- sync conflict silently overwrites local user change.

---

# 154. Security quality gate

Release-blocking:

- cross-store access;
- source file public access;
- refresh token stored in ordinary SQLite;
- AI secret present in native app;
- database credentials present in native app.

---

# 155. UX quality gate

Release-blocking:

- more than three primary priorities on Today/Week;
- critical sync failure hidden;
- ambiguous ticket product silently accepted;
- user cannot distinguish AI recommendation from enseigne instruction.

---

# 156. Recommended development phases for an AI agent

Do not prompt one agent:

```text
“Build the entire app.”
```

Use milestone/ticket execution.

Recommended workflow:

```text
Give agent:
1. canonical specs
2. one milestone
3. one ticket or tightly coupled ticket set
4. acceptance criteria
5. test requirements
```

Review before starting dependent tickets.

---

# 157. Agent context package

For each ticket, provide only relevant specs plus shared architecture files.

Example M4 receipt ticket context:

```text
TECHNICAL_ARCHITECTURE...
DATABASE_AND_API_CONTRACTS
UX_FLOWS...
DATA_INGESTION...
relevant Product spec sections
```

Avoid flooding context with unrelated details when not needed.

---

# 158. Agent output expected per ticket

Require:

```text
files changed
summary of implementation
migrations created
contracts changed
tests added
commands run
remaining risks
```

---

# 159. Agent must not self-approve architecture changes

If library/runtime incompatibility is discovered:

agent may propose alternatives.

Human must approve changes to:

```text
SQLite
sync architecture
Fastify
MongoDB
Expo
domain invariants
```

before implementation diverges.

---

# 160. Technical spikes

The following should be treated as explicit spike tickets before deep dependency:

```text
React Native XLSX parser compatibility
large XLSX mobile performance
HEIC handling
PDF source preview strategy
SQLite reactive query pattern
```

A spike returns evidence and recommended adapter.

---

# 161. Spike completion rule

A spike does NOT silently modify architecture.

It records:

- tested options;
- device/runtime;
- result;
- recommendation;
- risk.

Human accepts before architectural adjustment.

---

# 162. Backlog priority categories

Use:

```text
P0 — blocking architecture/data integrity
P1 — required MVP flow
P2 — MVP polish/efficiency
P3 — future
```

All milestone exit criteria are P0/P1.

---

# 163. Suggested issue template

```text
Title

Milestone
Priority

Objective

Relevant specifications

Dependencies

Implementation tasks

Acceptance criteria

Offline requirements

Sync requirements

Tests

Out of scope

Definition of done
```

---

# 164. Release candidate process

Before pilot:

```text
freeze schema changes
run all golden fixtures
run all offline E2E
run two-device conflict suite
run security suite
run grounding suite
build staging native apps
perform store-like manual test
```

---

# 165. Store-like manual test script

Minimum:

```text
Login
Go offline
Open Today
Import sales XLSX
Declare stockout
Find substitute
Capture waste ticket
Restart application
Confirm local data remains
Reconnect
Synchronize
Validate ticket AI result
Import commercial PDF
Validate operation
Complete weekly task offline
Accept recommendation offline
Synchronize
Mark action executed
Review sync dashboard
```

---

# 166. Pilot metrics to observe

Technical:

```text
crash-free sessions
sync success
oldest pending command
conflict rate
import parsing failures
AI extraction failure
grounding failure
```

Product-quality:

```text
manual product correction rate
receipt extraction correction rate
commercial extraction correction rate
recommendation acceptance/rejection
```

These metrics are diagnostic, not automatic product optimization.

---

# 167. First pilot feedback loop

After first real usage:

review:

- slow flows;
- recurring sync issues;
- product matching misses;
- import discrepancies;
- excessive alerts;
- confusing recommendation wording;
- missing offline data.

Do not add speculative features before fixing reliability.

---

# 168. MVP completion definition

The MVP is complete when these end-to-end flows work reliably.

## Daily

```text
Import Mercalys offline
→ local KPI
→ Today
→ record tension
→ see substitute
→ receive max 3 priorities
→ decision
→ execution
→ review
```

## Waste

```text
capture offline
→ persist
→ sync
→ AI extract
→ validate
→ local/remote waste observation
```

## Weekly

```text
import commercial PDF
→ extract/validate
→ week plan
→ deadlines
→ substitutions
→ checklist offline
→ sync
```

## Learning

```text
stockout event
→ synchronized sales evidence
→ deterministic substitution evidence
→ conservative score update
→ improved future context
```

---

# 169. What is NOT MVP completion

The following do not count as finished product by themselves:

```text
dashboard only
AI chat only
PDF summary only
receipt OCR without validation
server-only data flow
online-only workflows
substitution list without evidence model
recommendations without decision/execution tracking
```

---

# 170. Deferred post-MVP backlog

Examples:

```text
direct Mercalys connector
barcode scanning
headquarters multi-store views
native tablet optimization
advanced demand forecasting
competitor price intelligence
automatic purchasing
advanced inventory management
customer-level loyalty analytics
voice assistant
```

Do not mix these into MVP milestones unless explicitly reprioritized.

---

# 171. Final implementation invariant

The implementation sequence must preserve:

```text
offline-first reliability
before feature breadth
```

```text
deterministic truth
before AI explanation
```

```text
human validation
before critical business publication
```

```text
stable local IDs
before synchronization
```

```text
data lineage
before derived recommendation
```

```text
decision
before execution
```

```text
observed change
before any causal interpretation
```

---

# 172. Final instruction to the development agent

Build the project milestone by milestone.

Never treat the specification set as a prompt for generating the full application in one pass.

For every milestone:

```text
implement
test
demonstrate acceptance criteria
review
then continue
```

The first critical proof is not an AI recommendation.

The first critical proof is:

```text
Create useful business data offline
→ close the app
→ reopen it
→ synchronize it exactly once
→ observe the same trusted state on another device.
```

Once that foundation is reliable, all higher-level business intelligence becomes safe to build.

# M7 scope extension — T16 through T29 (approved 11 October 2026)

Deliver in the dependency order in `../M7_CONVERSATIONAL_DELIVERY_PLAN.md`, not numeric order alone.

- **M7-T16 — Native chat UX prototype and owner gate:** approve file-to-discussion, targeted form, bulk correction, source detail and interruption/retry journeys before production UI.
- **M7-T17 — Conversation/message/attachment persistence:** stable IDs, local-first history/drafts, durable remote restoration, pagination, conflict/idempotency and store/user access rules.
- **M7-T18 — Versioned business-tool registry and authority:** typed inputs/results, per-tool read/write/confirmation rules, complete manual-function coverage inventory; no raw SQL/Mongo or model-controlled scope.
- **M7-T19 — Contextual read/calculation and web-research tools:** daily/product/period/operation numbers, sources/PDF/photo analysis, stockouts/substitution, commercial and calendar/weather context; all official calculations via shared engines. Required public-web search/read supports relevant retail/shopper/store research with source links and freshness, keeping external claims separate from canonical store facts.
- **M7-T20 — Product/catalogue CRUD tools:** products, units/nature, identifiers/aliases, needs/memberships/directed relations; safe batch preparation, review, existing validators, history and explicit authority.
- **M7-T21 — Field/commercial/workflow CRUD tools:** observations and closure, drafts/choices/plans/TG/tasks, decisions/executions and supported store settings; local transaction/Outbox and version conflicts unchanged.
- **M7-T22 — Missing-information dialogue and inline forms:** typed targeted date/number/unit/choice/dimension/file fields; partial answers, cancel, offline draft and resumption; no full-catalogue mandatory campaign.
- **M7-T23 — Conversation/email-bound source intake:** receive Mercalys/PDF/receipt/other authorized photos from chat or the approved Resend development inbox; persist immutable originals and processing state; use existing parse/match/reconcile/publish services; multiple Mercalys sales/CA and waste workbooks or a ZIP with immutable per-file archive lineage; independent waste-photo batches and explicit long-ticket photo grouping; persisted batch manifest, bounded archive expansion/concurrency, per-item progress/retry and critical ambiguity review.
- **M7-T24 — Shared authorized memory:** distinct store facts, confirmed preferences/decisions, source-derived hypotheses and conversation-private data; provenance, correction/forgetting and invalidation without rewriting canonical history.
- **M7-T25 — Context budgeting/compaction:** versioned summaries preserve intent/decisions/open questions/source IDs, retrieve exact facts with tools, paginated original history; no invented numbers or silent loss of constraints.
- **M7-T26 — Produce-retail/shopper expertise reference:** curated versioned knowledge and explainable hypotheses; distinguish expertise from measured store facts and aggregate behaviour from individual customers.
- **M7-T27 — Constrained implantation scenario model:** collect actual/declared island/TG geometry, capacities and passages; validate placements/counts/collisions through deterministic checks; mark unknown dimensions explicitly.
- **M7-T28 — Implantation visual generation:** produce a canonical schematic plus generated illustrative view anchored to T27; original/photo provenance, source retrieval, private asset storage, revision/constraint comparison and configured provider/cost limits.
- **M7-T29 — Complete primary-Copilot acceptance:** file → persisted trusted numbers → discussion → targeted clarification → correction/plan → explicit decision/execution → review; two conversations share authorized knowledge without context leakage; compacted/offline/restart/retry flows and constrained visual scenario.

Expanded M7 exit: all current manual business-function tools have coverage or an explicit owner-approved deferral, chat UX is accepted on the pilot iPhone, grounding/authority/privacy gates pass, source imports persist correctly, shared memory/compaction are inspectable and one constrained implantation scenario is accepted. No silent operational write from source text/model output.


### M7-T13a — current-plan task outcome review (18 October 2026)

Code-ready scope: expose the existing deterministic product-period and field-event readers as one bounded primary-chat review for an exact current-plan task/product, with explicit before/during/optional-after windows, source citations, declaration identity and no causal overclaim. Acceptance checks cover scope, stale/oversized targets, missing versus zero, partial/different-duration periods, nonexecution, Paris DST, paginated events, concurrent change refusal, SDK/context bounds and private reply/restart replay. No business mutation or additional native module. See `docs/qa/M7_ACTION_REVIEW_SCENARIOS.md` for pending real dialogue acceptance. This is not completion of T10–T13/T15: the durable initial recommendation/decision linkage, archived context and complete offline-to-review pilot gate remain open.


### M7-T10a/T15a — durable choices on conversational advice (18 October 2026)

Code-ready scope: prepare an exact source-bound advice card in chat, explicitly record Accept/Modify/Postpone/Reject in SQLite with Outbox, retain versioned user intent across restart/sync, compare contradictory devices, and allow the model to inspect synchronized latest choices. Ordinary conversational advice is not automatically a formally eligible action candidate. Repeated cards for the same owned original quote continue one workflow; execution remains separate. Migrations are SQLite 46 and Mongo 39, with private capability/adoption negotiation and backward-compatible omission.

Acceptance checks cover offline/restart/no-op, failed enqueue/cancellation rollback, ownership before replay, immutable source/history, scope loss, local edit preservation on pull, exactly-once synchronization, two-device contradiction and fresh explicit resolution, source archive, French report dates, bounded history/capacity and source-qualified model reads. See `docs/qa/M7_RECOMMENDATION_DECISION_SCENARIOS.md` for pending real dialogue/native acceptance. The complete M7 gate remains open: changed-fact invalidation, formal operational recommendation lifecycle, decision-to-execution linkage and source-grounded full pilot review remain required.


## M7-T13b delivery note — choice-context review (18 October 2026)

The bounded descriptive review can select one exact private retained choice/version and show it alongside the separately selected task declaration and canonical before/during/after comparison. Ownership, source visibility, version drift, unknown data and citations are checked without business writes. This does not complete T12 or the T10–T13/T15 gate: a user-confirmed persisted decision→execution association, formal candidate/current-fact invalidation and pilot acceptance remain open. See `docs/qa/M7_ACTION_REVIEW_SCENARIOS.md` for acceptance scenarios and the M7 seven-workstream tracker for grouped delivery state.


## M7-T12b/T13c delivery note — explicit versioned association (18 October 2026)

A capability-gated private preview and native confirmation associate an existing retained decision with a separately recorded commercial execution task. Link + Outbox and one-way withdrawal are local-first; exact snapshots/dates restore across devices and remain private. The model can read the association for the existing descriptive review without changing either original record. Duplicate replay, withdrawal, historical proof after changes, owner/legacy isolation and capacity refusal are checked. This advances T12/T13/T15 within the existing commercial-task scope; generic actual execution price/location/dates, operational eligibility/current-fact invalidation and real pilot acceptance remain open. See `docs/qa/M7_EXECUTION_LINK_SCENARIOS.md` and the seven-workstream tracker.

### M7-T12/T13 increment — declared actuals on commercial tasks (PR 256)

Capture nullable real dates, exact declared EUR price/unit and location with a reviewed chat preview or the existing manual task sheet. Canonical local transaction + Outbox, durable history and version conflict policy are reused. Legacy sync projections must not erase new fields; capability adoption restores them on upgrade. Immutable recommendation associations keep their original task snapshot shape. Review quotes actual details without substituting selected windows or changing official figures.

Acceptance evidence: domain constraints; offline atomicity, rollback and restart; canonical Mongo push/replay/conflict, old-client projection and omitted-field preservation; source qualification and SDK/API capability tests. Real iPhone acceptance remains grouped. Generic executions for arbitrary recommendation types, formal stale/eligibility handling and archived/new-topic withdrawal workflows remain open; this commercial-task increment does not close T12 in full.

### M7-T12 — generic conversational realization capture (PR 257)

Separate action execution records now cover explicit realization of an exact prior owned chat suggestion beyond commercial-plan tasks. Capture is independent of accepting a recommendation: preview, initially unchecked native review, offline transaction/Outbox, durable private synchronization and cross-device restore. The immutable source/action/details remain when a declaration is withdrawn; same-card retries coalesce without automatic reactivation.

Acceptance: source/actor/capability checks, atomic rollback, restart, sequential queue/old acknowledgements, real two-SQLite/Mongo synchronization, private cached replay and legacy projection, retained historical source and 500-record limit. Generic review reads these statements as user reports, with missing/page/history qualifications and no financial/causal inference. Formal eligible recommendations and staleness, actions without prior advice, cross-topic/archived-card correction/withdrawal and pilot acceptance remain open; this increment is not all of T12 or M7.


### M7-T13 — review beyond saved commercial tasks (PR 258)

The existing bounded canonical before/during/after metrics and field-event reads now also contextualize one exact private realization from T12. No accepted choice or commercial plan is required. Tests cover private owner/store scope, synchronization from native confirmation, withdrawals and concurrent drift, absent versus zero, source links, SDK boundary/capability and shared-commercial-review regression. This closes the generic-realization-to-review code gap within workstream 5, not the entire workstream: formal operational fact staleness and the full grouped-delivery pilot acceptance remain outstanding. No new native module, migration, paid model call or build is required for this increment.


### M7-T11/T15 increment — recorded-read invalidation (PR 259)

Capture bounded server-read fingerprints atomically with new private assistant replies and recheck the same canonical readers before a fresh tracking preview. Changed covered sources yield STALE/À recalculer and no new tracking card; unchanged reads remain distinct from full applicability/operational eligibility. Old or incomplete provenance is unverifiable. Preserve earlier decisions, offline intent and realizations without silent execution. Test private scope, immutable reply/provenance replay, transactional rollback, canonical read changes, source masking, failed/unsupported reads, metric/cache order and native historical choice synchronization after fact drift.

This advances the existing staleness criterion for captured database reads, without declaring the whole operational recommendation lifecycle complete. Unsupported tool/document dependencies, formal current eligibility and the full grouped pilot acceptance remain open. Mongo 42 precedes API delivery; no native schema/module or paid build is introduced. See `docs/qa/M7_FACT_CONTEXT_SCENARIOS.md`.


### M7-T06/T09/T29 consolidation — native tool discovery (PR 260)

Reduce duplicated agent-wide tool guidance and use installed SDK-native deferred loading for large authorized registries. Preserve the single-agent architecture, all existing business contracts and explicit action confirmations. No new business lifecycle or workstream. Acceptance covers initial catalogue reduction, deferred execution including same-step calls, capability exclusion, per-generation isolation, bounded discovery/final response, existing read limits, cross-domain analysis-to-correction preparation and true SSE streaming. Existing provider regression cases remain unchanged.

This is workstream 7 consolidation, not an additional closure of recommendation lifecycle or an assertion of human-level reasoning. Grouped API delivery, representative real-model dialogues and the complete pilot acceptance remain outstanding. See `docs/qa/M7_TOOL_DISCOVERY_SCENARIOS.md`; no schema migration, model/provider change or paid build is required.

### M7-T27 increment — provisional rectangular geometry preflight (PR 264)

A runtime-neutral commercial-core engine checks bounded rectangular what-if layouts (8 fixtures, 6 obstacles, 4 reserved access areas), integer-mm coordinates and 0/90° rotations. It reports expected fixture-count mismatches, bounds, collisions, reserved-access obstruction, declared minimum widths, height and kg-load limits. Unknown dimensions/inventories remain explicit; known violations are not suppressed by unrelated unknowns. The existing authenticated chat-tool catalogue exposes the calculation with server-owned source evidence and no write authority. All inputs/results remain hypothetical, not confirmed store measurements or a realized installation. Generic CM questions reuse T22; no prompt router, persistence model or native module is added.

This is the first T27 increment, not completion: measured/declared provenance and user confirmation, durable editable revisions, authoritative schematic, linked illustrative generation (T28) and real pilot validation remain open. Rectangles only; no inferred photo dimensions, regulatory compliance, route connectivity or stability guarantee. No API delivery, paid build/model/image call or business-data mutation is triggered.

### M7-T27/T28 clarification — store-owned physical reference (19 October 2026)

[STORE_LAYOUT_SPEC.md](STORE_LAYOUT_SPEC.md) governs the next workstream 6 increments. Store settings own the persistent physical plan; conversation scenarios do not replace it. Start from fleg as unconfirmed source data, map two eight-element islands (four fixed single-face elements per face), their distinct bacs/upper shelves, three TGs and optional separately identified selling mobiles. Mobiles have habitual positions under only some fixed elements; do not infer count or fit.

Delivery order: shared contracts/migrations → local repository/drafts/revisions and canonical sync/conflicts → interactive top-down store plan and element front view → authorized Copilot reads/reviewed edits → reference-bound commercial schematic and illustration. Preserve stable surface IDs and historical references. Furniture stays fixed in routine commercial proposals; a physical move is explicit. The PR 264 flat preflight requires adaptation for the full inventory and vertically overlapping mobile/fixture geometry; it is not this persistent hierarchy. Missing measurements and allocation granularity are collected progressively. This is specification, not completed code or pilot acceptance.

### M7-T27 increment — deliberate numeric placement and optional mobiles (PR 268)

Extend the existing native editor with room/island dimensions, identity, absolute top-left placement, quarter-turn orientation and under-furniture clearance. Shared runtime-neutral transforms move recorded descendants without materializing schematic fallbacks; ambiguous rotations are refused atomically. Explicit optional-mobile creation owns a distinct selling surface; host association is descriptive, removal affects only the current draft and immutable identities can be restored. Reuse existing revision/CAS/Outbox/authorization paths; no new migration or agent framework.

Acceptance covers 19-object preservation, optional inventory, rotations/translations of hosted hierarchies, unknown/zero/qualification distinctions, capacity, removal/undo, SQLite offline restart and exact historical restoration. Full hierarchy geometry validation, structural fixed/TG editing, direct manipulation, refusal repair, Copilot tooling and source-bound illustration remain open under the same workstream. See `docs/qa/M7_STORE_LAYOUT_PHYSICAL_EDITING.md`. API 266 compatibility precedes grouped native delivery; no paid EAS build or provider call is triggered.

### M7-T27 increment — complete canonical footprint/clearance preflight (PR 269)

Compute derived provisional geometry for the full canonical inventory (128 fixtures/32 groups), without rendering fallbacks or eight-object batches. Check recorded bounds, island membership, lateral pairs and conditional vertical overlap below fixtures. Preserve unknown/reference measurements and group-versus-furniture identity; a habitual mobile host is not evidence of fit or an invented confinement constraint. Native target links and frozen adoption review use the same result as the SQLite/remote adoption guard. Incompatible drafts remain saveable; known incompatibility cannot become a new reference.

Acceptance covers 19 real model elements, optional mobiles, all orientations, millimetre edge cases, partial impossible geometry, nonphysical group envelopes, all 8 128 pairs at the furniture limit, atomic local refusal and transactional remote rejection/replay. No stored schema/capability migration. API-compatible policy precedes grouped native delivery. Passage/obstacle/load/surface constraints, full store feasibility, native pilot and illustration remain open; see `docs/qa/M7_STORE_LAYOUT_GEOMETRY.md`. No paid build/provider or production deployment is initiated.

### M7-T27/T28 increment — scoped conversational physical-reference reads (PR 270)

Register a read-only `store_layout` tool on the existing SDK-native catalogue. Resolve authenticated store scope, exact adopted reference versus explicitly requested active draft, revision-pinned pages and assembly/furniture/surface targets. Retain qualified measurements, independent surfaces, bounded provisional geometry counts/issues and revision-bound French evidence. Keep full storage snapshots and actor metadata private; no model Mongo arguments, mutation or new agent/prompt layer.

Acceptance includes absent/unconfirmed data, immutable reference/draft separation, stable bounded pagination, targeted surfaces/mobiles, concurrent history lookup, foreign/tampered snapshot refusal, actual installed SDK transport tests, canonical source rendering and real Mongo isolation/no-write cases. Physical dependencies still make recommendation freshness incompletely verifiable until scenario/version linkage is implemented. Reviewed physical mutations, source-bound allocations/illustration and the real pilot remain open. See `docs/qa/M7_COPILOT_STORE_LAYOUT_READ.md`; API delivery and grouped native acceptance remain distinct from merge/test results.

### M7-T27 increment — reviewed physical draft edits in chat (PR 271)

Use the existing single-agent catalogue and a client capability to prepare one exact physical patch against the canonical head. Shared logic preserves qualified measurements, descendants, optional mobile/surface identities and an adopted reference after draft discard. Return a bounded comparison without full storage snapshots; persist a small private card atomically with the reply. Native review reuses the plan comparison/geometry and confirms a local SAVE_DRAFT via the unchanged canonical history/CAS/Outbox path, with private result in the same transaction. No direct model business writes, global prompt layer, new schema or native dependency.

Acceptance covers stale/foreign/absent data, field boundaries, optional-mobile initial dimensions and association/removal, one-time transforms, private-record integrity, role/deletion/cancellation, rollback, offline restart and exactly-once replay. Existing adoption remains a separate deliberate action. See `docs/qa/M7_COPILOT_STORE_LAYOUT_DRAFTS.md`; physical allocation/scenario/freshness/schematic/illustration and grouped measured pilot remain open under workstream 6. No paid build/provider call or production deployment.

### M7-T27/T28 increment — reference-bound allocations and native schematic (PR 272)

Prepare one bounded private allocation proposal through the existing single-agent catalogue, using exact adopted furniture/surface IDs and canonical active products/retained offers. Keep original offer dates and source lineage, separately identified mobile/shelf/bac targets and an explicit whole-furniture option where surface composition is unknown. Never change geometry, invent a fourth TG or derive quantities/capacity. Persist the small immutable card with its reply through the existing private producer, without a business write or migration.

The native sheet reuses the canonical map and exact historical revision, numbered targets and assignment list. An exclusive local read verifies private ownership/parent and rederives source state; changed adopted reference or item source requires review, missing cache remains unverifiable, refresh failure preserves the view. A newer unadopted draft does not replace the adopted reference. Acceptance includes shared/installed-SDK, actual SQLite restart/no-write, real transactional Mongo and compiled native-component visual proof. See `docs/qa/M7_STORE_LAYOUT_ALLOCATION_SCHEMATIC.md`.

This closes the proposed-allocation/schematic gap, not approval of a commercial preparation, field execution, full recommendation freshness, generated illustration or measured pilot acceptance. Workstream 6 remains in progress. Compatible API precedes grouped native delivery; no paid EAS/model/image or production deployment is initiated.

### M7-T27/T28 increment — reviewed allocation in the canonical commercial preparation (PR 273)

Extend the existing weekly DRAFT with an optional immutable physical allocation snapshot; preserve it into separately validated commercial plans/revisions. Confirm from the private chat card after source/before-state review, preserving notes/TGs and adding only absent retained offers. Commit preparation history, Outbox and private result atomically; do not invent promotions for assortment, assume capacity or declare field execution. Recheck the adopted reference and exact source versions at commercial approval locally and inside the canonical Mongo transaction. Expose the same historical schematic from preparation/plan and support explicit unlink without deleting source history.

Acceptance includes file-backed offline restart/exactly-once replay, rollback/cancellation, source/CAS/private scope/role refusals, actual SQLite-to-Mongo ACK and second-device restoration, separate commercial validation, legacy client projections/no implicit erasure and exact one-way hydration of previously projected immutable history. New capabilities are negotiated independently; no schema migration, new datastore, model tool or global instruction layer. See `docs/qa/M7_STORE_LAYOUT_COMMERCIAL_LINK.md`. Workstream 6 remains open for linked illustration, missing constraints/structural edits/gestures and measured native acceptance; compatible API precedes grouped binary delivery. No paid EAS/model/image or production deployment is initiated.

## Approved UX implementation increment — 19 October 2026 (PR 274)

The complete V1/M7 objective includes the UX arbitration recorded in `../ux/AUDIT.md`; the external mockups do not override canonical business invariants. `../ux/V1_REMAINING_ROADMAP.md` decomposes, but does not replace, the seven M7 workstreams. This increment replaces the unconditional native Analytics placeholder with local Day/Week/Month/Year exploration of canonical department monetary amounts. Shared ISO-week-year N−1/civil comparison policy qualifies closed-day pairing, missing/partial/zero/negative values and leap differences, without changing explicit J−7 requests elsewhere. Native context is stored privately per user/store in existing local metadata; no migration, alternate datastore or business sync entity is added. Five primary Stack domains expose the existing workflows, with Copilot as the initial workspace and shared dark semantic tokens. Source reads, file-backed context restart and production-component visual checks are covered; filters/contributors/deep links, remaining screen design/media and grouped iOS/Android acceptance remain open. See `../qa/M7_UX_ANALYTICS_EXPLORER.md`. No paid EAS/model call or production deployment is initiated by this lot.

## Explorer scoped drill and entry links — 19 October 2026 (PR 275)

Extend the local Explorer with current-catalogue category/nature/product filters, category and product monetary breakdown, ranking before 20-row pagination and complete intersecting ISO weeks from Month. Reuse the exact daily sum/coverage helper from the existing shared analytics query engine, then the Explorer closed-day comparison policy. Keep the unfiltered official department value distinct from observed product sums and never infer absent product-days as zero. Restore filters, page and both scroll axes from private local UI metadata, with backward-compatible defaults. Native Today/product links carry strict read-only selections and preserve the previous context; no tenant, arbitrary destination or operation is accepted. Citation links from chat remain open until structured analytical destinations are available. Validate real SQLite beyond one SQL page, scope separation, restart and hostile link refusal; test the production components separately from native acceptance and measure a representative two-year fixture. No business migration/sync/API entity, provider request, paid EAS build or deployment. See `../qa/M7_UX_ANALYTICS_FILTERS.md` and the unchanged full V1/M7/M8 gates.

## Structured analytical citation navigation — 19 October 2026 (PR 276)

Server evidence can retain an optional native analytical destination without exposing it as model instructions. Preserve exact free periods, explicit references/J−7, SUM/AVERAGE, department vs observed-product basis and query filters; preserve the original observed-product universe for DAY groups. The same calendar/aggregation engine drives local rereads, without inferring scope from prose or replacing dates with a month/ISO baseline. Quotes remain immutable while local current data can differ. Old evidence and readers stay compatible; navigation alone does not alter fact freshness, while conflicting actual facts or destinations remain rejected. Long messages keep the pre-existing source format if adding navigation would exceed the current transport bound; compact long-source transport remains an explicit open V1 gate. No business datastore, migration, mutation endpoint, provider instruction or paid call is introduced. See `../qa/M7_UX_ANALYTICS_SOURCE_LINKS.md` for data-chain/SQLite/model-projection tests, UI proof and native/delivery limitations; all full M7/M8 exit gates remain open until exercised.

### UX arbitrée — catalogue et édition des produits (19 octobre 2026)

Continue L5 from `../ux/V1_REMAINING_ROADMAP.md`: native virtualized catalogue with offline validated label/alias/code search, combined category/nature/state filters and user/store-private view restoration. Preserve existing product deep links as readable detail screens with an explicit editor, plus need/substitution/event/analysis functions. Protect uncommitted forms from background refresh and destructive navigation; compare the opened canonical snapshot inside the local aggregate/Outbox transaction before saving. Reuse existing recomputation and synchronization rules, with no migration or new native dependency. Automated and visual evidence, plus the grouped-device acceptance gate, are recorded in `../qa/M7_UX_PRODUCTS.md`. Other L5/L6/M7/M8 requirements remain open.

### UX arbitrée — Actions et signalements d’Aujourd’hui (19 octobre 2026)

Continue L5 using existing commercial execution and store-event modules. Put actual task follow-up before management shortcuts; select an ISO week and preserve that exact scope in plan/preparation links. Filter task display without changing canonical progress totals. Keep uncommitted execution details mounted across plan refresh and isolate asynchronously loaded revision data. Today must read recorded local events rather than display an unverified all-clear. Preserve explicit execution, conflicts, historical plan versions and all existing mutations. Native acceptance remains required; see `../qa/M7_UX_ACTIONS.md`.

### UX arbitrée — accès aux sources (19 octobre 2026)

Continue L5 with native receipt search/filter/listing, typed Mercalys batch publication filters and progressive document presentation. Preserve business dates versus capture/AI proposals, confirmed cashier edits, local publication versus pending/conflicted sync, original files and all existing correction/publication/reconciliation services. Keep the existing file-review sheet and its parent position. Reuse the authenticated original-PDF button before analysis availability. Never announce missing data from an unsuccessful read, or infer no published operations from this document-only screen. Accessibility states support native and web controls. See `../qa/M7_UX_SOURCE_LISTS.md`; native end-to-end acceptance and remaining V1 gates are still open.

### M7/L4 — compact analytical citation destinations (19 October 2026)

Close the long-answer source-navigation loss using an optional negotiated server-owned ASSISTANT presentation table, not another provider/tool layer. Preserve precise periods/aggregation/filters, private scope, durable JSON history, old-client projections and restart enrichment without changing immutable message content. Keep presentation outside model context and source-freshness identity; preserve TOOL contracts. Local suite: 2,226 passed/498 environment-dependent skipped, strict types/lint and API build/import passed. Exact-head push/PR CI must also pass transactional Mongo tests and native exports. QA/rollout/bounds: `../qa/M7_COMPACT_ANALYTICAL_SOURCES.md`; full seven-workstream scope and V1/M8 acceptance remain open. Parent PR 279 merged after both exact-head CI successes, branch removed. No production deployment, provider request or paid EAS build.

### M7/L5 — protected store settings and form error theme (20 October 2026)

Reuse the product navigation guard for Mon magasin, retain dirty inputs across focus/push returns, scope state by owner/store, reject stale editor snapshots inside the existing local mutation/Outbox transaction, preserve retry/error distinction and provide accessible zone selection/French field errors. Repair NativeWind development theme initialization and restore historical danger classes using the canonical critical colour. Local tests: 2,227 passed/498 environment-dependent skipped; strict types/lint passed. Exact-head CI/native export and grouped device acceptance remain required. See `../qa/M7_UX_STORE_SETTINGS.md`. Parent PR 280 merged after both exact-head CI successes; no provider spending, deployment or EAS build.

### M7/L5 — retained receipt edits and targeted corrections (20 October 2026)

Scope receipt detail to the active store/owner, retain UUID-indexed value drafts across regrouping/refresh, preserve explicitly cleared cashier input, provide compact source/line presentation and navigate from validation issues to native section coordinates. Check manual expected revisions and receipt editability on the same SQLite transaction as the update, reusing existing reviewed-tool transactions and deterministic validators. Read-only/missing targets retain a readable unsaved preview; post-publication processing failure must not claim the committed save failed. Local suite: 2,232 passed/498 environment-dependent skipped; strict types/lint/format and browser component navigation passed. Exact-head CI/native export and device acceptance remain required. See `../qa/M7_UX_RECEIPT_REVIEW.md`. Parent PR 281 merged after both exact-head CI successes. Next verified UX gap: catalogue selection outside extraction candidates, using the existing reviewed service. Full seven-workstream scope remains; no deployment, provider request or paid EAS build.

### M7 UX — receipt catalogue choice and create-return (20 October)

Expose the existing explicitly reviewed catalogue association from each receipt line, using the local product search/virtualized list and canonical product editor for separate creation. Keep the receipt mounted and preserve unrelated form drafts; freeze target identity and line revision, recheck both plus identity conflicts inside the existing SQLite draft transaction. Incomplete catalogue classification is not a prerequisite for waste capture. Do not publish, invent extraction confidence or learn an alias implicitly. Origin is limited to owned receipt/line UUIDs, and all editor state is scoped to owner/store. File-backed creation/selection restart and stale/foreign/deleted/conflict refusals are tested independently from synthetic presentation evidence. See `../qa/M7_UX_RECEIPT_CATALOGUE.md`; grouped native navigation/keyboard/restore/sync acceptance and the complete V1/M7/M8 scope remain open. PR 282 merged after successful exact-head push and PR CI; branches removed. No deployment, model/provider call or paid EAS build.


### M7-T27 / L10 — reviewed physical inventory parity

Continue the manually editable inventory (PR 303) through the existing physical-plan preview tool and native comparison/controller. Negotiate the new action variants separately; retain legacy edits/mobile cards. Assign bounded stable IDs during remote preparation and replay them exactly in the same local SQLite/history/Outbox transaction. Reuse structural add/copy/remove helpers, preserve unknown geometry and mobile identities, and never adopt or record execution implicitly. Cover shared contracts, installed-SDK arguments, offline file restart and Mongo/private-card/SQLite A-to-B synchronization. Acceptance, delivery state and remaining physical illustration/gesture/pilot gates are in `../qa/M7_COPILOT_LAYOUT_INVENTORY.md`; the seven workstreams and full V1 remain unchanged.


### M7-T27 / L10 — deliberate direct positioning

Add an explicit placement mode to the canonical 2D map; consultation pan/pinch never changes furniture. Translate only recorded X/Y through the same shared movement engine, including related mobiles/children once. Freeze the map frame during a gesture; keep intermediate previews ephemeral and commit one undo step only at successful end against the unchanged draft/authority. Unknown positions require the existing numeric editor, never materialize drawing fallbacks. Preserve explicit save/adoption and historical identity. Shared coordinate/undo tests, file-backed persistence and production-component browser interaction are distinct from native gesture/performance/accessibility acceptance. See `../qa/STORE_LAYOUT_DIRECT_PLACEMENT_2026_10_20.md`; linked illustration, measured pilot and full V1/M8 remain open.


### M7-T28 continuation — canonical source and image adapter (20 October 2026)

Compile the existing private allocation scenario and exact historical adopted physical revision into numbered PNG source pixels plus qualified structured inventory, hashes and limitations. Refuse missing floor geometry, foreign/private scope, mismatched targets/versions/geometry and collisions before provider submission. Implement a disabled, isolated Responses image adapter with one forced bounded PNG output, no implicit models, no retry and conservative uncertain outcome after submission. Intercept the real installed SDK for tests; preserve original output separately from normalized bytes. This does not activate a provider or expose generation in chat. Durable local-first intent/Outbox/sync, attempt reservation/budget, private source/result storage/cache, native comparison/freshness and measured pilot acceptance remain required. See `../qa/STORE_LAYOUT_ILLUSTRATION_SOURCE_2026_10_20.md`.

### M7-T28 continuation — unpaid durable illustration preparations (20 October 2026)

Persist one immutable, private source-bound preparation through SQLite/Outbox/Mongo and bounded bootstrap/history/pull; restore on a clean second database without losing its historical plan/card identity. Reuse the shared source compiler, standard chat ownership/command journal and existing scenario sheet. Explicit preparation is not permission for a provider call; no generation, adoption or execution is implied. SQLite 57/Mongo 49, role/revocation/source/idempotency/cancellation and capability/pagination tests precede grouped delivery. See `../qa/STORE_LAYOUT_ILLUSTRATION_PREPARATIONS_2026_10_20.md`. T28 paid-attempt/budget authorization, private assets/cache, generation recovery and result comparison, real provider approval and measured native pilot remain open. Seven-workstream scope and all eleven UX/M8 lots remain unchanged.

### M7-T28 continuation — private originals, restoration and comparison (20 October 2026)

Preserve source PNG/JSON, exact provider original and normalized viewing image as a private immutable bundle. Checkpoint before Blob writes, original first, publish only complete manifests; recover interrupted conservation from the same original and retain uncertainty when it never reached storage. Reuse source hashes, existing immutable Blob and native file-verification ports; no public write route or generation invocation. An owner can restore the bound result through authenticated GETs into SQLite/owned file cache and reopen offline; compare source/image/original in the same scenario sheet with historical-source and network-error states. Mongo 50/SQLite 58, strict contracts and tests precede compatible grouped delivery. See `../qa/STORE_LAYOUT_ILLUSTRATION_FILES_2026_10_20.md`. Explicit generation authorization/attempt/cost reservation, durable provider handoff, cache retention bounds, actual activation approval and measured native pilot remain open; no V1/M8 closure follows.


### M7-T28 continuation — bounded private download copies (20 October 2026)

Reuse the illustration manifest table and native private file adapter for a 64 MiB per-store/account download budget. Count real bytes, preserve user-retained copies/current preparation, reclaim only described recoverable copies in recency order and refuse unknown/unreclaimable capacity before downloading. Persist the offline preference and register a verified remote manifest before the first file so partial transfers remain recoverable. No new business action, provider permission or remote retention policy. See `../qa/STORE_LAYOUT_ILLUSTRATION_CACHE_2026_10_20.md`. Durable generation authorization/reservations/worker/result recovery, explicit provider/cost activation and measured/native V1/M8 acceptance remain open.


### M7-T28 continuation — explicit generation and durable recovery (20 October 2026)

Bind a signed, expiring model/estimate quote to the private historical preparation; confirm through the existing SQLite/Outbox/processed-command transaction. Atomically limit daily global/store/owner admissions, durably claim one provider invocation, and recover only the same conserved original after duplicate events, restart or uncertainty. Reuse Inngest dispatch/recovery and owner-scoped bounded metadata sync. Preserve newer progress across late ACK and the previous usable image across interrupted downloads. Defaults remain disabled; no real provider activation/spend or model/cost assumption. See `../qa/STORE_LAYOUT_ILLUSTRATION_GENERATION_2026_10_20.md`. Real model/budget approval, image quality, native acceptance and measured pilot remain open, alongside the complete seven-workstream/eleven-lot V1/M8 objective.


### M7-T20/T21 continuation — known remote catalogue tombstones (20 October 2026)

Reuse the manual/Copilot canonical catalogue conflict resolver for explicit adoption of a complete, matching remote deletion. Require separate deletion consent, preserve local/remote/history and superseded Outbox records atomically, keep the DELETE snapshot and never issue a restoring mutation. Reject unknown remote absence, reassigned identity, unseen newer deletion or revoked/cancelled/stale comparison. Shared local request schema, file-backed restart/rollback and real Mongo conflict serialization/preview/SQLite adoption precede grouped delivery. See `../qa/M7_CATALOGUE_DELETION_CONFLICTS_2026_10_20.md`; broader refusals/missing-target cases and native/full V1/M8 acceptance remain open.

### M7-T20/T21 continuation — reviewed local catalogue deletions (20 October 2026)

Complete the existing catalogue comparison with explicit maintain/cancel choices for a local tombstone against a live same-identity synchronized record. Reuse the canonical DELETE writer after installing the reviewed live baseline in the same exclusive SQLite transaction, preserving both source versions/history and one new stable command with exact remote-version precondition. Cancelling adopts remote without a send; reversing inactive/rejected status requires its own consent. No new model tool, prompt, migration, business mutation protocol or cascade. Test real Mongo stale DELETE conflict/processed-command retry/pull into second SQLite, file-backed restart, manual/chat parity, late rollback, revoked authority and native choice reset. See `../qa/M7_CATALOGUE_LOCAL_DELETION_CONFLICTS_2026_10_20.md`; null/reassigned targets, multiple conflicts, full native acceptance and V1/M8 remain open.


### M7-T23 continuation — observed receiving access and metadata compatibility (23 October 2026)

The real received attachment failed after six attempts because the deployed sending-only key receives HTTP 401 / restricted_api_key. Add an optional dedicated server receiving credential, preserving the old full-access fallback and independent authentication sender. Accept both authenticated provider CDN host/path formats with exact email/file identity and all existing byte, expiry, authorization and redirect guards. Emit closed reason/status diagnostics without raw provider errors or signed URLs. Current account-wide Full access provisioning requires explicit owner approval and Secret storage before compatible API delivery; no read-only receiving scope is available. Use the existing authenticated exhausted-original retry, never direct database reset. See `../qa/M7_RESEND_RECEIVING_ACCESS_2026_10_23.md`. Code validation is not real original retention, explicit processing, native or cross-device acceptance. All seven M7 statuses and full V1/M8 gates remain intact.


### M8-T08 / M7 UX continuation — product read invalidation (23 October 2026)

Measure and remove catalogue/editor SQL repeated for synchronization counters and unrelated pending local jobs. Keep first-focus/return reads independent of network state, refresh real local saves and refused stale snapshots, preserve failed/offline content and successful pulls with unchanged counters. Reuse already-computed Outbox count as local context metadata; no new query, queue, polling or business writer. Extend real 500-edit/navigation and scoped SQLite measurements, slow-read/focus/error cases and actual provider count checks. See `../qa/M8_PRODUCT_SYNC_READS_2026_10_23.md`; representative iOS/Android latency/FPS, grouped delivery, all seven M7 workstreams and full V1/M8 acceptance remain open.
