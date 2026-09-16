# Technical Architecture & Implementation Specification — Native Offline-First Expo

**Product:** Fruits & Vegetables Copilot  
**Document:** `TECHNICAL_ARCHITECTURE_AND_IMPLEMENTATION_SPEC.md`  
**Version:** 2.0 — Native Offline-First Reset  
**Date:** 16 September 2026  
**Specification language:** English  
**Application language:** French (`fr-FR`)  
**Primary client:** Native iOS and Android application  
**Client foundation:** React Native + Expo  
**Architecture model:** Offline-first / local-first  
**Pilot scope:** One store, structurally ready for multiple stores  
**Status:** Canonical technical specification for the development agent.

---

# 1. Canonical platform decision

The product is a **native offline-first mobile application**.

The client MUST be implemented with:

```text
React Native
Expo
TypeScript
Expo Router
```

Target platforms:

```text
iOS
Android
```

This technical specification starts from a clean native baseline.

The mobile application is the operational application used on the shop floor.

---

# 2. Canonical offline-first decision

Offline-first is a **core architecture invariant**, not a degraded-mode feature.

The default data flow is:

```text
User action
   ↓
Local SQLite transaction
   ↓
Immediate local UI update
   ↓
Local deterministic business logic
   ↓
Outbox entry
   ↓
Background / explicit synchronization
   ↓
Remote synchronization hub
   ↓
Durable remote persistence
   ↓
Heavy processing / AI when required
   ↓
Incremental pull back to device
```

The application must remain operational during poor or absent connectivity for the primary field workflows.

---

# 3. Offline-first principles

## 3.1 Local reads first

Primary screens read from SQLite.

Remote APIs refresh local state; they do not block normal rendering.

## 3.2 Local writes first

Field actions are committed locally before remote synchronization.

## 3.3 Explicit pending state

A locally accepted action may be:

```text
LOCAL
PENDING_SYNC
SYNCING
SYNCED
CONFLICT
FAILED
```

## 3.4 Remote processing is asynchronous

AI, document extraction, weather refresh and other external processing may wait until connectivity returns.

## 3.5 Deterministic logic is shared

Where practical, deterministic domain logic is shared between mobile and remote runtime.

## 3.6 Server is a synchronization hub

The remote service coordinates durable persistence, cross-device consistency, heavy processing and AI.

## 3.7 AI never blocks field capture

A receipt can be captured offline even though AI extraction is pending.

---

# 4. Operational promise

If network connectivity disappears in the store, the user must still be able to:

```text
open the application
view the last synchronized dashboard
view products
view product history already stored locally
view current commercial plan already synchronized
view Need Units and substitutes
capture a waste receipt
import a Mercalys file
declare a tension
declare low stock
declare a stockout
declare a quality issue
record a decision
record an action note
mark an action locally
run deterministic KPI calculations on locally available data
```

The user must never lose a field action because connectivity is unavailable.

---

# 5. Functions naturally deferred while offline

The following can be queued until connectivity returns:

```text
AI receipt extraction
AI commercial document extraction
new remote weather forecasts
remote multi-device synchronization
Copilot generative wording
push delivery
large remote backup upload
```

The mobile UI must display the pending status explicitly.

Example:

```text
Ticket enregistré
Analyse IA en attente de connexion
```

---

# 6. High-level architecture

```text
┌──────────────────────────────────────────────────────────────┐
│               React Native + Expo Application               │
│                                                              │
│  Expo Router                                                 │
│  Camera / Files / Notifications                              │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                    SQLite Local DB                     │  │
│  │ Products / Sales / Waste / Plans / KPI / Actions      │  │
│  │ Need Units / Substitutions / Recommendations          │  │
│  │ Sync metadata / Outbox / Inbox cursor                 │  │
│  └─────────────────────────┬──────────────────────────────┘  │
│                            │                                  │
│  Shared deterministic logic│                                  │
│                            ▼                                  │
│  Local KPI / local rules / local candidate generation        │
└────────────────────────────┬─────────────────────────────────┘
                             │
                    Bidirectional sync
                             │
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                Remote Sync & Domain API                      │
│                 Node.js + TypeScript                         │
│                        Fastify                               │
│                                                              │
│ Auth / Sync / Commands / Queries / Upload authorization      │
└────────────────────┬───────────────────┬─────────────────────┘
                     │                   │
                     ▼                   ▼
            ┌────────────────┐   ┌────────────────────┐
            │ MongoDB Atlas  │   │ Google Cloud       │
            │                │   │ Storage            │
            │ durable state  │   │ sources / photos   │
            │ change log     │   │ PDFs / Excel       │
            │ audit          │   │ derivatives        │
            └───────┬────────┘   └─────────┬──────────┘
                    │                      │
                    └──────────┬───────────┘
                               ▼
                      ┌─────────────────┐
                      │ Background Jobs │
                      │     Inngest     │
                      │                 │
                      │ parsing         │
                      │ AI extraction   │
                      │ heavy analytics │
                      │ Copilot         │
                      └────────┬────────┘
                               │
                ┌──────────────┴───────────────┐
                ▼                              ▼
       ┌──────────────────┐          ┌────────────────────┐
       │ Context Providers │          │ AI Provider Layer  │
       │ Weather / Calendar│          │ Vision / Docs / LLM│
       └──────────────────┘          └────────────────────┘
```

---

# 7. Concrete technology stack

| Layer | Decision |
|---|---|
| Mobile framework | React Native |
| Native toolchain | Expo |
| Navigation | Expo Router |
| Language | TypeScript strict mode |
| Styling | NativeWind + native design system |
| Forms | React Hook Form + Zod |
| Remote state coordination | TanStack Query |
| Local UI state | Zustand |
| Local operational DB | expo-sqlite |
| SQLite ORM/query layer | Drizzle ORM |
| Secure secrets | expo-secure-store |
| Camera | expo-camera |
| Image selection | expo-image-picker |
| File selection | expo-document-picker |
| Local files | expo-file-system |
| Image preparation | expo-image-manipulator |
| Connectivity | expo-network |
| Notifications | expo-notifications |
| Local IDs | expo-crypto random UUID |
| App distribution | EAS Build / Submit / Update |
| Remote runtime | Node.js + TypeScript |
| Remote API framework | Fastify |
| Remote API validation | Zod |
| Remote database | MongoDB Atlas native driver |
| Object storage | Google Cloud Storage |
| Background workflows | Inngest |
| AI abstraction | Provider adapter compatible with AI SDK v6 |
| Remote Excel parsing | ExcelJS |
| Local Excel parsing | React Native-compatible pure JS XLSX adapter |
| PDF text parsing | pdfjs-dist remotely |
| Remote image conversion | Sharp |
| Decimal arithmetic | decimal.js |
| Error monitoring | Sentry |
| Tracing | OpenTelemetry |
| Unit tests | Vitest |
| Native E2E | Maestro |
| Monorepo | pnpm + Turborepo |
| Remote deployment | Google Cloud Run |

---

# 8. Why SQLite is a primary application datastore

SQLite is not a simple cache.

It stores the operational subset of domain data required for the native application to function independently of connectivity.

The local database holds:

```text
products
product identifiers
product aliases

Need Units
Need Unit memberships
substitution relationships

sales observations
waste observations
waste receipt drafts

commercial operations
offers
market signals
execution instructions

store events
stock observations

daily product KPI read models
daily department KPI read models

recommendations
decisions
action executions

sync outbox
sync cursor
sync conflicts
local source metadata
```

---

# 9. Local source of truth semantics

For **user-created field data**, local persistence is immediately authoritative for that device.

Examples:

```text
stockout declaration
quality issue
receipt capture
decision
action note
```

It becomes globally durable after successful synchronization.

For **remotely-originated data**, SQLite stores the latest synchronized version.

Examples:

```text
commercial plan
remote AI result
weather
cross-device changes
```

---

# 10. Remote source of truth semantics

The remote datastore is the durable cross-device coordination layer.

It is authoritative for:

- synchronized multi-device state;
- durable source document history;
- remote processing results;
- audit history;
- global change sequence;
- conflict resolution state.

This does not mean mobile writes must wait for remote confirmation before being usable locally.

---

# 11. Shared deterministic business packages

The following packages MUST be runtime-neutral TypeScript wherever possible:

```text
packages/domain
packages/analytics-core
packages/substitution-core
packages/commercial-core
packages/sync-contracts
```

They must avoid Node-only APIs.

These packages can run:

```text
on the mobile device
and
on the remote service
```

---

# 12. Shared vs remote-only packages

## Shared

```text
domain schemas
KPI formulas
comparison formulas
unit compatibility
candidate rules
substitution score formulas
commercial rule validation
money/decimal helpers
sync contracts
```

## Remote-only

```text
MongoDB repositories
Cloud Storage
AI providers
Inngest
remote PDF parsing
remote image conversion
weather provider access
push sending
```

---

# 13. Canonical calculation parity

A KPI formula must have one shared implementation.

Example:

```text
packages/analytics-core
```

is imported by:

```text
mobile local analytics
remote canonical recomputation
```

This prevents formula drift.

---

# 14. Local KPI state

The mobile app can compute deterministic KPI results from all locally available validated observations.

A local KPI result includes:

```text
LOCAL_CURRENT
LOCAL_PARTIAL
REMOTE_CONFIRMED
STALE
```

The UI may expose freshness when relevant.

---

# 15. Remote KPI confirmation

After synchronization, the remote engine recomputes using the durable global dataset.

The device receives confirmed read models incrementally.

If local and remote deterministic results differ, the system records a diagnostic mismatch.

Silent divergence is not allowed.

---

# 16. Local candidate generation

Transparent analytical candidates may also be generated locally when required inputs are present.

Examples:

```text
waste spike
sales drop
high waste contribution
stockout
deadline already synchronized
```

AI-generated prose can wait for connectivity.

---

# 17. Native repository layout

```text
/
├── apps/
│   ├── mobile/
│   │   ├── app/
│   │   ├── src/
│   │   │   ├── db/
│   │   │   ├── sync/
│   │   │   ├── components/
│   │   │   ├── features/
│   │   │   ├── hooks/
│   │   │   ├── services/
│   │   │   ├── stores/
│   │   │   └── theme/
│   │   ├── assets/
│   │   ├── app.json
│   │   └── eas.json
│   │
│   └── api/
│       ├── src/
│       │   ├── routes/
│       │   ├── sync/
│       │   ├── auth/
│       │   ├── plugins/
│       │   └── index.ts
│       └── Dockerfile
│
├── packages/
│   ├── domain/
│   ├── analytics-core/
│   ├── substitution-core/
│   ├── commercial-core/
│   ├── sync-contracts/
│   ├── db-remote/
│   ├── ingestion/
│   ├── products/
│   ├── recommendations/
│   ├── ai/
│   ├── storage/
│   ├── jobs/
│   ├── api-client/
│   ├── observability/
│   └── test-fixtures/
│
├── scripts/
├── docs/
│   └── adr/
├── turbo.json
└── pnpm-workspace.yaml
```

---

# 18. Expo Router structure

```text
apps/mobile/app/
├── _layout.tsx
├── index.tsx
├── (auth)/
│   ├── login.tsx
│   └── verify-code.tsx
├── (tabs)/
│   ├── _layout.tsx
│   ├── today.tsx
│   ├── week.tsx
│   ├── analytics.tsx
│   ├── waste.tsx
│   └── more.tsx
├── product/[productId].tsx
├── operation/[operationId].tsx
├── import/[importBatchId].tsx
├── receipt/capture.tsx
├── receipt/[receiptId].tsx
├── substitution/[relationshipId].tsx
├── sync/index.tsx
└── settings/index.tsx
```

---

# 19. Local database access

Use:

```text
expo-sqlite
+
Drizzle ORM
```

The mobile domain layer must access SQLite through repositories rather than ad-hoc SQL spread across components.

---

# 20. Local tables

Recommended initial SQLite tables:

```text
products
product_identifiers
product_aliases

need_units
need_memberships
product_substitutions

sales_observations
waste_observations
waste_receipts
waste_lines

commercial_operations
offers
market_signals
execution_instructions
merchandising_plans

store_events
stock_observations

product_daily_performance
department_daily_performance

analytical_candidates
recommendations
decisions
action_executions

local_sources
local_files

sync_outbox
sync_inbox_state
sync_conflicts
sync_entity_versions
app_metadata
```

---

# 21. Local database migrations

Use versioned SQLite migrations.

App startup sequence:

```text
open DB
→ run pending local migrations
→ validate schema version
→ open application
```

A failed migration must block writes and produce a recoverable diagnostic state.

---

# 22. Local IDs

New local entities receive IDs before synchronization.

Use secure random UUIDs.

IDs remain stable after synchronization.

The server MUST NOT replace client IDs for client-created entities.

---

# 23. Why stable client IDs matter

Stable IDs allow:

- offline relations;
- local action history;
- file references;
- idempotent sync;
- dependent commands before connectivity.

Example:

```text
local stockout event UUID
```

can already be referenced by a local note before remote sync.

---

# 24. Entity metadata for sync

Syncable entities should include:

```ts
type SyncMetadata = {
  id: string;

  storeId: string;

  version: number;

  updatedAt: string;

  deletedAt?: string | null;

  originDeviceId?: string | null;

  syncState?: "LOCAL" | "SYNCED" | "CONFLICT";
};
```

Local schema can keep sync fields separately if cleaner.

---

# 25. Outbox pattern

Every local mutation transaction writes:

```text
domain record
+
outbox command
```

in the SAME SQLite transaction.

This is mandatory.

Example:

```text
INSERT store_event
INSERT sync_outbox
COMMIT
```

The app must never create a local mutation without a corresponding sync intention when that entity is syncable.

---

# 26. Outbox command contract

```ts
type OutboxCommand = {
  commandId: string;
  storeId: string;
  deviceId: string;

  commandType: string;

  entityType: string;
  entityId: string;

  expectedRemoteVersion?: number | null;

  payload: unknown;

  createdAt: string;

  status:
    | "PENDING"
    | "SYNCING"
    | "ACKNOWLEDGED"
    | "CONFLICT"
    | "FAILED";

  attemptCount: number;
  lastAttemptAt?: string | null;
  lastErrorCode?: string | null;
};
```

---

# 27. Sync is bidirectional

Every sync cycle consists of:

```text
PUSH
local outbox commands
        ↓
remote apply / conflict response

PULL
remote changes after local cursor
        ↓
SQLite upsert transaction
        ↓
local recomputation
```

---

# 28. Sync cursor

Each device maintains:

```text
storeId
syncCursor
lastSuccessfulSyncAt
```

The cursor is opaque to the client.

The server advances it only through ordered durable change-log records.

---

# 29. Remote change log

Remote service maintains a store-scoped monotonic change stream.

Recommended collection:

```text
syncChanges
```

Each entry:

```ts
{
  storeId,
  sequence,
  entityType,
  entityId,
  operation: "UPSERT" | "DELETE",
  entityVersion,
  changedAt
}
```

---

# 30. Incremental pull

Request:

```text
GET /sync/changes?cursor=...
```

Response:

```ts
{
  changes: [...],
  nextCursor: "...",
  hasMore: boolean
}
```

Large backlogs are paginated.

---

# 31. Push endpoint

Recommended:

```text
POST /sync/push
```

accepting a bounded command batch.

Response per command:

```text
APPLIED
ALREADY_APPLIED
CONFLICT
REJECTED
RETRYABLE_ERROR
```

---

# 32. Command idempotency

The server stores processed command IDs.

A retried command returns:

```text
ALREADY_APPLIED
```

with the original result.

It must never duplicate the domain write.

---

# 33. Sync ordering

Commands from one device are ordered by creation time / local sequence.

The server does not assume ordering between unrelated devices.

Entity-version checks handle concurrent modifications.

---

# 34. Conflict policy by entity type

There is no universal last-write-wins rule.

Conflict strategy is domain-specific.

---

# 35. Append-style entities

Usually conflict-free:

```text
waste receipt
store event episode
decision
action note
source file
```

Each has its own stable ID.

---

# 36. Editable master data

Requires optimistic concurrency:

```text
Product
NeedUnit
ProductSubstitution
CommercialOperation
```

A stale edit returns conflict.

---

# 37. Server-generated entities

Examples:

```text
AI extraction
remote weather
remote Copilot recommendation
remote analytical confirmation
```

They are pulled to the device and normally not overwritten locally.

---

# 38. Conflict record

Local table:

```ts
type SyncConflict = {
  id: string;
  entityType: string;
  entityId: string;

  localVersionJson: string;
  remoteVersionJson: string;

  createdAt: string;

  status:
    | "OPEN"
    | "RESOLVED_LOCAL"
    | "RESOLVED_REMOTE"
    | "MERGED";
};
```

---

# 39. Conflict UX

French UI:

```text
Conflit de synchronisation

Cette donnée a été modifiée sur un autre appareil.

Examiner
```

Only safe resolution choices are offered per entity.

---

# 40. Tombstones

Deletes of syncable records use tombstones:

```text
deletedAt
```

until all active devices have had a chance to consume deletion.

Hard cleanup happens later according to retention policy.

---

# 41. Initial bootstrap

After first authentication, the device performs a bootstrap snapshot.

Recommended pilot dataset:

```text
complete active product master
identifiers and aliases
Need Units
validated substitution relations

configurable recent sales history
configurable recent waste history

current + future commercial operations
current market signals

recent KPI read models
active recommendations
active store events
```

---

# 42. Bootstrap history window

Initial recommendation:

```text
90 days
```

for raw daily sales/waste observations on the pilot.

The window is configurable.

Older aggregated history may be downloaded separately if needed.

---

# 43. Bootstrap endpoint

Conceptual:

```text
GET /sync/bootstrap
```

Response is chunked/paginated or compressed if required.

It returns:

```text
snapshot revision
entities
initial cursor
```

---

# 44. Re-bootstrap

Required when:

- local DB is reset;
- sync protocol version becomes incompatible;
- recovery is requested;
- local corruption is detected.

---

# 45. Local-first read pattern

Screen repositories query SQLite.

Example:

```text
Today screen
→ local DepartmentDailyPerformance
→ local recommendations
→ sync refresh starts in background
→ remote changes update SQLite
→ screen reacts to SQLite change
```

The screen does not wait for a remote HTTP read before rendering normal content.

---

# 46. Local reactive updates

Use a local data subscription layer around SQLite queries.

The UI should react when local repository data changes after:

- local write;
- sync pull;
- local recomputation.

---

# 47. TanStack Query role

TanStack Query is used primarily for:

- remote sync operations;
- job status;
- non-replicated remote operations;
- explicit refresh coordination.

It is not the sole holder of business state.

---

# 48. Zustand role

Zustand stores only ephemeral UI state.

Never store durable business facts solely in Zustand.

---

# 49. Local Mercalys import

Offline-first architecture should support Mercalys XLSX parsing locally.

Create an abstraction:

```ts
interface LocalSpreadsheetParser {
  detectSource(uri): Promise<DetectionResult>;
  parseMercalys(uri): Promise<LocalImportDraft>;
}
```

---

# 50. Local XLSX implementation

Use a pure JavaScript XLSX parser proven compatible with React Native and ArrayBuffer input.

Preferred implementation should be isolated behind an adapter.

Before milestone acceptance, test:

- real pilot XLSX;
- leading zeros;
- dates;
- decimals;
- file size;
- memory consumption on target iPhone/Android hardware.

If a chosen library fails these tests, replace only the adapter.

---

# 51. Local import workflow

```text
Document Picker
  ↓
copy source into app-owned file storage
  ↓
local checksum
  ↓
local parser
  ↓
local SourceDocument
  ↓
local normalized observations
  ↓
product matching
  ↓
local validation
  ↓
SQLite publication
  ↓
local KPI recomputation
  ↓
Outbox / file upload when online
```

---

# 52. Local source document

SQLite stores metadata:

```text
sourceDocumentId
sourceType
localFileUri
checksum
businessPeriod
processingState
remoteUploadState
```

The source file is stored in app-owned persistent file storage until remote durability is confirmed.

---

# 53. Local import authority

A locally validated Mercalys import may immediately affect local KPI/read models.

Its remote status is visible:

```text
Import local — synchronisation en attente
```

---

# 54. Remote import verification

After upload, the remote service may reparse the same source for integrity and durable publication.

Expected outcome:

```text
MATCH
```

If local and remote normalized results differ materially:

```text
IMPORT_VERIFICATION_CONFLICT
```

is created instead of silently replacing local data.

---

# 55. Parser parity

Whenever feasible, share pure parsing helpers.

If local and remote parser libraries differ, keep:

```text
same source schema
same normalized contract
same golden fixtures
same expected outputs
```

---

# 56. Receipt offline workflow

```text
capture
→ persistent local file
→ local receipt record
→ optional manual pre-validation
→ Outbox upload command
```

While offline, the user may manually set:

- waste date;
- note;
- obvious product context if desired.

AI extraction remains pending.

---

# 57. Receipt after sync

When online:

```text
file upload
→ AI extraction
→ remote extraction result
→ sync change
→ SQLite
→ local notification
→ human validation screen
```

---

# 58. Commercial PDF offline workflow

The PDF can be selected and stored locally while offline.

The user can see:

```text
Document enregistré
Analyse commerciale en attente
```

AI/document interpretation occurs remotely when connectivity returns.

---

# 59. Local commercial plan

All previously synchronized commercial operations and execution tasks remain usable offline.

The manager can mark tasks locally:

```text
done
skipped
planned
```

These changes enter the Outbox.

---

# 60. Local store events

Creation is immediate.

Example:

```text
OUT_OF_STOCK
productId
startedAt
```

The event locally influences relevant screens and local candidate generation before synchronization.

---

# 61. Local substitution lookup

Validated Need Units and substitution relationships are replicated to SQLite.

Thus:

```text
product → candidate substitutes
```

works fully offline.

---

# 62. Local substitution evidence

Canonical evidence remains remote-confirmed because it may depend on the complete synchronized dataset.

The device can still display the most recently synchronized evidence.

---

# 63. Local deterministic KPI engine

`packages/analytics-core` must be usable on the mobile runtime.

It computes:

- sales value;
- sold quantity;
- known waste cost;
- estimated waste cost;
- waste sales value;
- compatible ratios;
- J-7 when available locally;
- contribution to change;
- basic deterministic analytical candidates.

---

# 64. Remote deterministic KPI engine

The same core package runs remotely over durable synchronized data.

Remote outputs become cross-device confirmed read models.

---

# 65. Read model origin

A local read model stores:

```text
origin = LOCAL | REMOTE_CONFIRMED
```

and:

```text
computedAt
inputRevision
formulaVersion
```

---

# 66. KPI divergence diagnostic

If local and remote result differs beyond decimal/rounding tolerance:

- record diagnostic;
- prefer remote-confirmed state for synchronized historical data;
- do not hide the mismatch;
- trigger developer observability.

---

# 67. Local analytics recomputation triggers

Examples:

```text
local Mercalys import published
local waste corrected
store event created
product classification changed locally
sync pull changes source observations
```

---

# 68. Recompute scope

Do not recompute entire local history unnecessarily.

Scope by:

```text
product
date
operation
```

---

# 69. Local calculation scheduling

Small recomputations run synchronously/off-main-thread-compatible where possible.

Large import recomputation should be chunked to avoid freezing the native UI.

---

# 70. Mobile performance rule

No long calculation loop may block interaction for noticeable periods.

Use chunking/yielding and progress indication.

---

# 71. Authentication

Native email one-time-code flow.

```text
email
→ API challenge
→ 6-digit code
→ access token
→ rotating refresh token
```

---

# 72. Token storage

Refresh token:

```text
expo-secure-store
```

Access token:

```text
memory
```

Device sessions are revocable remotely.

---

# 73. Offline login behavior

A previously authenticated device may open the app offline using a valid local device session marker.

Sensitive remote commands remain pending until token refresh can occur.

A fully new login requires connectivity.

---

# 74. Local app lock

Optional future capability:

```text
expo-local-authentication
```

Not required for MVP.

---

# 75. Remote API

Use:

```text
Node.js
TypeScript
Fastify
```

The API is a sync/domain service for the native client.

---

# 76. Remote endpoints

Primary groups:

```text
/auth
/sync
/uploads
/jobs
/imports
/products
/analytics
/commercial
/events
/substitutions
/recommendations
/actions
/devices
```

Normal replicated business reads should primarily flow through sync/bootstrap rather than repeated per-screen fetching.

---

# 77. Sync API is first-class

The sync protocol is not an implementation detail.

It is a core product subsystem with versioned contracts.

Recommended:

```text
POST /api/v1/sync/push
GET  /api/v1/sync/pull
GET  /api/v1/sync/bootstrap
POST /api/v1/sync/reconcile
```

---

# 78. Sync protocol version

Client sends:

```text
syncProtocolVersion
appVersion
localSchemaVersion
```

Server can require re-bootstrap if incompatible.

---

# 79. Remote database

Use MongoDB Atlas native driver.

Mongo stores durable synchronized domain entities and remote-derived results.

---

# 80. Remote change sequence

Each accepted domain mutation that affects replicated state appends a `syncChanges` row/document with a monotonic per-store sequence.

Sequence allocation must be atomic.

---

# 81. Remote revisions

Syncable entities use:

```text
version
updatedAt
```

Commands with stale expected versions return conflict.

---

# 82. Object storage

Use Google Cloud Storage.

Source files are private.

---

# 83. Offline file durability

A source file selected/captured offline remains in application-owned file storage until:

```text
remoteUploadState = CONFIRMED
```

Only then may normal cleanup remove the local source according to policy.

---

# 84. File upload flow

```text
Outbox upload command
→ request signed URL
→ upload directly
→ confirm upload
→ remote job starts
→ sync extraction result back
```

---

# 85. Upload recovery

Store resumable metadata where platform/provider allows.

At minimum, failed upload restarts safely because:

- sourceDocumentId is stable;
- checksum is stable;
- remote upload completion is idempotent.

---

# 86. Background workflows

Use Inngest remotely.

Use cases:

```text
source verification
remote parsing
AI extraction
commercial PDF analysis
analytics confirmation
substitution evidence
Copilot generation
push notifications
action reviews
```

---

# 87. Inngest idempotency

All jobs have deterministic keys.

No retry may duplicate business mutations.

---

# 88. AI provider layer

Remote only.

Roles:

```text
receipt vision
commercial document extraction
semantic matching assistance
Copilot generation
```

The offline app never embeds provider credentials.

---

# 89. AI pending state

Local entities can carry:

```text
aiStatus =
  NOT_REQUIRED
  PENDING_UPLOAD
  QUEUED
  PROCESSING
  READY
  FAILED
```

---

# 90. AI output sync

AI output is persisted remotely, added to sync change log, then pulled into SQLite.

Push notification can alert the user but is not required for data correctness.

---

# 91. Copilot offline behavior

While offline, show:

- last synchronized Copilot recommendations;
- local deterministic candidates;
- explicit local alerts.

Do not invent new generative explanations offline unless an on-device model is introduced in a future version.

---

# 92. Deterministic offline recommendation templates

For high-value transparent cases, local templates can produce basic French guidance.

Example:

```text
Casse élevée sur Avocat.
46 € contre 27 € de référence locale.
Vérifier stock et qualité.
```

This is not a generative AI response.

---

# 93. Context providers

Weather / holidays / school holidays are remote-provider data.

Last synchronized context remains available offline.

---

# 94. Weather freshness

Local weather record stores:

```text
issuedAt
retrievedAt
validDate
type = FORECAST | OBSERVED
```

The UI can show stale forecast state.

---

# 95. Push notifications

Use `expo-notifications`.

Notifications:

- receipt extraction ready;
- commercial deadline;
- action review ready;
- sync problem requiring attention.

---

# 96. Push is optional delivery

All important state is synchronized through the database protocol.

If push is disabled, opening/syncing the app retrieves the same state.

---

# 97. Remote deployment

Fastify API runs in Google Cloud Run.

Use European region.

Background processing may run from separate Cloud Run worker when native dependencies or higher resources are required.

---

# 98. MongoDB topology

Pilot:

```text
one Atlas cluster
one application database
store-scoped entities
```

---

# 99. Core remote collections

```text
users
stores
storeMemberships
deviceSessions
devices

products
productIdentifiers
productAliases

needUnits
productNeedMemberships
productSubstitutions
substitutionEvidence
substitutionScoreHistory

sourceDocuments
importBatches
sourceRecords
ingestionAuditEvents
reconciliationDecisions

salesObservations
wasteReceipts
wasteLines
wasteObservations

commercialOperations
offers
preOrderWindows
deliveryWindows
executionInstructions
communicationInstructions
merchandisingRecommendations
merchandisingPlans
marketSignals
localCommercialActions
commercialExecutions

weatherRecords
calendarEvents
storeProductEvents
stockObservations

productDailyPerformance
departmentDailyPerformance
commercialOperationAnalytics

analyticalCandidates
weeklyCommercialCandidates

recommendations
recommendationProvenance
decisions
actionExecutions
actionReviews

syncChanges
processedCommands
pushTokens
aiGenerationLogs
schemaMigrations
```

---

# 100. Mongo schema validation

Use:

```text
Zod
+
MongoDB $jsonSchema
```

for critical entities.

---

# 101. Decimal arithmetic

Use `decimal.js` in shared deterministic logic.

Avoid native floating-point for financial/reconciliation-sensitive formulas.

---

# 102. Local decimal serialization

SQLite does not provide arbitrary precision decimal semantics suitable for all calculations.

Store canonical decimal values as:

```text
decimal string
```

or defined scaled integer according to contract.

`DATABASE_AND_API_CONTRACTS.md` must select one canonical encoding per field.

---

# 103. Shared domain serialization

The same serialized numeric representation must cross:

```text
SQLite
sync API
Mongo conversion layer
```

without implicit precision loss.

---

# 104. Product graph offline

The full active substitution graph relevant to the store is replicated locally.

No graph database is required.

SQLite indexes support:

```text
sourceProductId
needUnitId
status
```

---

# 105. Commercial plan offline

Replicate at least:

```text
current week
next week
future operations included in active source documents
```

plus execution tasks.

The user can prepare the week offline.

---

# 106. Recommendation lifecycle offline

A synchronized recommendation may be:

```text
accepted
modified
postponed
rejected
```

offline.

The resulting Decision enters Outbox.

---

# 107. Recommendation staleness after offline period

On sync, if recommendation inputs changed materially:

- preserve user's offline decision;
- mark recommendation stale;
- require reconciliation before executing a materially changed action if safety/business rules require it.

---

# 108. Local notifications

The device may schedule purely local reminders for already-known commercial deadlines.

This allows reminders without connectivity.

Remote changes cancel/update local schedules after sync.

---

# 109. Local deadline notification example

```text
Précommande à effectuer demain
```

can be scheduled from synchronized commercial data using `expo-notifications`.

---

# 110. Sync triggers

Mandatory triggers:

```text
after authentication
app foreground
explicit pull-to-refresh / Synchroniser
after local mutation when connected
connectivity restored while app active
before critical remote-only action
```

Optional optimization:

```text
background task
```

Never rely exclusively on background execution.

---

# 111. Network awareness

Use `expo-network`.

Connectivity state is advisory.

Actual request success determines online availability.

---

# 112. Sync backoff

Transient failures use exponential backoff with jitter.

User-requested sync bypasses long wait but still respects safety/rate limits.

---

# 113. Failed command UX

A command that cannot sync after repeated attempts appears under:

```text
Plus > Synchronisation
```

with:

```text
Réessayer
Examiner
```

---

# 114. Sync dashboard

Show:

```text
Dernière synchronisation
Éléments en attente
Conflits
Fichiers en attente d'envoi
Analyses IA en attente
```

---

# 115. Sync health states

```text
HEALTHY
PENDING
DEGRADED
CONFLICT
OFFLINE
```

French labels are localized.

---

# 116. Local data freshness

Every replicated collection/table includes enough metadata to show freshness when needed.

Do not mark historical data stale simply because the device is offline.

Staleness is domain-specific.

---

# 117. Source file checksums

Compute locally if practical.

Checksum supports:

- duplicate detection;
- upload idempotency;
- remote verification.

---

# 118. Local duplicate detection

Before queueing an identical source:

check:

```text
store
source type
checksum
```

Still let user review if prior import status is failed/cancelled.

---

# 119. Remote duplicate verification

Server independently verifies checksum and source semantics.

Do not trust the client checksum as security evidence.

---

# 120. Reconciliation offline

Simple exact duplicate handling works offline.

Complex overlapping historical reconciliation may be performed locally using synchronized observations and later remote-verified.

If full remote history needed is missing, status is:

```text
RECONCILIATION_PENDING_SYNC
```

---

# 121. Local Mercalys product matching

Available offline using:

```text
identifiers
approved aliases
canonical labels
local fuzzy matcher
```

AI-assisted matching is deferred when offline.

---

# 122. Fuzzy matching

Use a React Native-compatible fuzzy search implementation.

Fuse.js may be used in shared logic.

Fuzzy matches remain proposals.

---

# 123. Local product creation review

Unknown imports may create a local `TO_REVIEW` product placeholder with stable UUID.

It synchronizes later.

Server does not silently replace its ID.

---

# 124. Local source lineage

Local observations preserve:

```text
localSourceDocumentId
localSourceRecordId
```

After synchronization, these same IDs remain the durable lineage IDs when possible.

---

# 125. Mobile import progress

Large local files display progress:

```text
Lecture du fichier
Rapprochement des produits
Calcul des indicateurs
Prêt
```

The UI must remain responsive.

---

# 126. Local processing cancellation

Before local publication, user may cancel an import.

After local publication, use an explicit reversal/reconciliation action rather than deleting silently.

---

# 127. App termination recovery

Import state is persisted in SQLite.

If the OS terminates the app mid-import, reopening continues from a safe checkpoint or restarts idempotently.

---

# 128. Local job checkpoints

For local deterministic imports, persist coarse stages:

```text
SOURCE_COPIED
PARSED
MATCHED
VALIDATED
PUBLISHED
KPI_RECOMPUTED
QUEUED_FOR_SYNC
```

---

# 129. Remote verification status

Imported source can show:

```text
Local only
Upload pending
Remote verification pending
Verified
Conflict
```

---

# 130. Source lifecycle

```text
LOCAL_CAPTURED
→ LOCAL_PUBLISHED
→ UPLOAD_PENDING
→ REMOTE_RECEIVED
→ REMOTE_VERIFIED
→ SYNCED
```

AI-dependent sources add extraction states.

---

# 131. Offline-first security

Local SQLite contains business data.

The application must rely on platform application sandboxing and device security.

Sensitive credentials remain in SecureStore.

For higher-security deployment, database encryption can be evaluated before production rollout.

---

# 132. Logout data handling

On logout:

- revoke device session when online or queue revocation;
- clear refresh token;
- wipe local business SQLite database;
- delete private local source files;
- clear scheduled private notifications.

This prevents cross-user local data leakage.

---

# 133. Device loss

Remote admin/session management must support device-session revocation.

Device encryption/passcode policy remains outside application control.

---

# 134. Local backups

Do not automatically include private operational app data in user-accessible exports.

Platform backup inclusion/exclusion must be reviewed before production.

---

# 135. Observability

Monitor both mobile and remote.

Mobile:

```text
sync failures
SQLite migration failures
local import failures
crashes
slow local calculations
```

Remote:

```text
API
jobs
AI
remote verification
change-log backlog
```

---

# 136. Correlation IDs

A sync command carries:

```text
commandId
deviceId
requestId
```

Remote logs keep these for tracing.

---

# 137. Sync telemetry

Track:

```text
outbox size
oldest pending command age
sync duration
changes pulled
commands pushed
conflicts
failed files
bootstrap duration
```

---

# 138. Offline test matrix

Every milestone must test:

```text
online normal
offline from launch
network lost mid-action
network restored
app killed with pending commands
duplicate retry
two-device concurrent edit
stale recommendation decision
large local import
```

---

# 139. Native E2E

Use Maestro.

Critical offline scenarios:

```text
login once online
turn network off
capture receipt
declare stockout
view local substitute
import Mercalys
view locally recalculated KPI
restart app
verify data persists
turn network on
sync
verify remote confirmation
```

---

# 140. Sync contract tests

Shared `packages/sync-contracts` must have compatibility tests between:

```text
mobile encoder
API decoder
API response
mobile decoder
```

---

# 141. Deterministic parity tests

Run the same input fixture through:

```text
mobile-compatible shared analytics-core
remote analytics-core
```

Expected outputs must match exactly after serialization normalization.

---

# 142. Golden import tests

The supplied/anonymized Mercalys sample fixtures must be tested locally and remotely where both parsers exist.

Material differences fail milestone acceptance.

---

# 143. Performance target — local open

Previously synchronized primary screens should render from SQLite without waiting for remote network.

Target perceived opening:

```text
near-instant after local DB open
```

---

# 144. Performance target — local import

Pilot-sized Mercalys daily import should complete without UI freezing on supported devices.

Exact device benchmarks become milestone acceptance criteria after first prototype.

---

# 145. Performance target — sync

Normal incremental sync should exchange deltas only.

Do not transfer the whole 90-day dataset on each launch.

---

# 146. Data retention on device

Recommended local retention:

```text
active product master: complete
commercial current/future: complete relevant set
raw daily observations: rolling configurable window
aggregated/read models: longer window
source files: until remotely verified + configured local retention
```

---

# 147. History beyond local window

If user requests older history not locally available:

online app fetches a historical slice and stores it locally according to cache policy.

Offline UI clearly states:

```text
Historique non disponible sur cet appareil hors connexion.
```

---

# 148. Remote-only historical query

Historical fetch endpoint returns domain/read-model data which is then persisted in SQLite.

Screen still reads local DB after insertion.

---

# 149. Notifications

Use native local notifications for already-known deadlines.

Use push notifications for remote events such as:

```text
AI extraction complete
remote conflict requiring review
action review ready
```

---

# 150. Distribution

Use EAS:

```text
development builds
TestFlight
Google Play internal testing
App Store
Google Play
EAS Update
```

---

# 151. Remote deployment

Fastify API and workers deploy as containers to Google Cloud Run.

Prefer European regions.

---

# 152. CI/CD

GitHub Actions:

```text
install
lint
typecheck
unit tests
shared parity tests
API integration tests
mobile bundle validation
```

EAS builds are triggered according to environment/release workflow.

---

# 153. Technical milestone 0 — Offline-first native foundation

Deliver:

- Expo native shell;
- Expo Router;
- French design system;
- native auth;
- SecureStore;
- SQLite + Drizzle;
- local migration system;
- Outbox;
- sync cursor;
- Fastify sync API;
- MongoDB;
- processed command idempotency;
- bootstrap/push/pull protocol;
- Sentry;
- EAS environments.

Definition of done:

```text
authenticate online
open app later offline
create local test entity
restart app
entity remains
restore network
entity syncs exactly once
second device receives entity
```

---

# 154. Technical milestone 1 — Local Mercalys ingestion

Deliver:

- Document Picker;
- persistent local source files;
- local XLSX parser adapter;
- sales/waste format detection;
- local observations;
- product matching;
- local duplicate control;
- local KPI recomputation;
- remote upload/verification.

Definition of done:

```text
import pilot XLSX with network disabled
view local sales KPI
restart app
KPI remains
restore network
source and observations sync
remote verification matches
```

---

# 155. Technical milestone 2 — Shared analytics

Deliver:

- analytics-core;
- local and remote execution;
- parity tests;
- local read models;
- remote confirmation;
- Today screen.

Definition of done:

```text
same fixture
→ same local result
→ same remote result
```

---

# 156. Technical milestone 3 — Offline receipt workflow

Deliver:

- camera;
- persistent image;
- local receipt;
- offline queue;
- upload;
- AI extraction;
- pulled extraction result;
- validation;
- waste publication.

Definition of done:

```text
capture offline
kill app
reopen
receipt exists
restore network
sync
AI result returns
validate
waste KPI updates
```

---

# 157. Technical milestone 4 — Offline commercial planning

Deliver:

- PDF local capture;
- queued upload;
- remote extraction;
- synchronized commercial data;
- offline current/next week plan;
- local execution-task updates;
- local deadline notifications.

---

# 158. Technical milestone 5 — Offline substitution

Deliver:

- replicated Need Units;
- replicated directed graph;
- offline substitute lookup;
- offline store-event creation;
- remote evidence generation;
- pulled score updates.

---

# 159. Technical milestone 6 — Copilot + deterministic offline fallback

Deliver:

- remote Copilot;
- grounding;
- synchronized recommendations;
- local deterministic candidates;
- offline recommendation decisions;
- sync reconciliation;
- action review.

---

# 160. Technical milestone 7 — Hardening

Deliver:

- two-device conflict tests;
- storage cleanup;
- local DB recovery;
- sync diagnostics;
- battery/network review;
- accessibility;
- App Store / Play Store release readiness;
- backup/restore.

---

# 161. Architecture Decision Records

Create:

```text
ADR-001 React Native + Expo
ADR-002 Offline-first local SQLite
ADR-003 Bidirectional Outbox/Change-log sync
ADR-004 Shared deterministic analytics
ADR-005 Fastify remote sync/domain API
ADR-006 MongoDB durable remote store
ADR-007 Google Cloud Storage source files
ADR-008 Inngest remote workflows
ADR-009 Directed substitution graph in MongoDB/SQLite
ADR-010 AI provider abstraction
ADR-011 Client-generated stable UUIDs
```

---

# 162. Prohibited shortcuts

Do not:

- make normal screens network-dependent;
- use remote fetch as the only business data store;
- put all durable state in TanStack Query;
- discard local writes when offline;
- rely on background sync being guaranteed;
- use last-write-wins for all conflicts;
- regenerate entity IDs after sync;
- implement KPI formulas twice;
- let AI produce authoritative numbers;
- delete local source files before remote durability is confirmed.

---

# 163. Canonical offline-first invariant

For field workflows:

```text
local transaction first
→ user gets immediate result
→ synchronization second
```

The app must not implement:

```text
POST remote
→ wait
→ if success update UI
```

as the standard mutation pattern for syncable business entities.

---

# 164. Business truth invariant

The architecture must preserve:

```text
local pending truth
vs
remote synchronized truth
vs
derived analytical truth
vs
AI explanation
```

These states must remain explicit.

---

# 165. Final technical invariant

The implementation must always preserve:

```text
native Expo app
+
local SQLite operational database
+
shared deterministic domain logic
+
bidirectional incremental sync
+
remote durable coordination
+
remote heavy processing and AI
```

and:

```text
offline does not mean read-only
```

and:

```text
sync does not mean full re-download
```

and:

```text
retry does not mean duplicate
```

and:

```text
conflict does not mean silent overwrite
```

and:

```text
AI pending does not block field work
```

and:

```text
missing does not equal zero
```

---

# 166. Rule for all future technical specifications

All future technical specifications MUST assume this offline-first native baseline:

```text
React Native + Expo
iOS + Android
Expo Router
SQLite as local operational datastore
Drizzle local data access
Outbox local writes
incremental push/pull sync
stable mobile-generated UUIDs
shared deterministic TypeScript business logic
SecureStore credentials
native camera/files/notifications
remote Fastify synchronization/domain service
MongoDB durable coordination
remote heavy processing and AI
```

---

# 167. Next documents

The next specifications MUST be designed around the sync model:

```text
DATABASE_AND_API_CONTRACTS.md
UX_FLOWS_AND_SCREEN_SPEC.md
IMPLEMENTATION_PLAN.md
```

`DATABASE_AND_API_CONTRACTS.md` must define BOTH:

```text
SQLite local schema
MongoDB remote schema
sync protocol
conflict rules
API contracts
```

`UX_FLOWS_AND_SCREEN_SPEC.md` must explicitly cover:

```text
offline states
pending sync
conflicts
queued AI processing
local/remote freshness
native camera flows
local notifications
```
