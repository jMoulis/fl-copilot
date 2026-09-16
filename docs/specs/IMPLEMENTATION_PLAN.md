# Implementation Plan — Native Offline-First Fruits & Vegetables Copilot

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
Google Cloud Storage source files
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

# 51. M2-T13 — GCS source upload

Implement signed upload authorization and native file upload queue.

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

Implement native issue-by-issue review.

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

# 119. M7-T09 — Recommendation detail UX

Implement sections:

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

---

# 132. M8-T04 — Local DB recovery

Simulate corruption/rebootstrap recovery.

Preserve recoverable unsynchronized source files.

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
