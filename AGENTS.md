# AGENTS.md — Fruits & Vegetables Copilot

This file is the permanent execution charter for any development agent working in this repository.

## 1. Product

The product is a native mobile copilot for a Fruits & Vegetables department manager.

Primary platforms:

- iOS
- Android

Application language:

- French (`fr-FR`)

Specification language:

- English

## 2. Canonical architecture — DO NOT REDESIGN

The primary client is:

```text
React Native
Expo
TypeScript
Expo Router
```

The architecture is **offline-first / local-first**.

The normal operational data flow is:

```text
User action
→ SQLite local transaction
→ immediate local UI update
→ shared deterministic business logic
→ Outbox command
→ asynchronous synchronization
→ remote durable persistence
→ heavy processing / AI when needed
→ incremental pull back to device
```

### Local runtime

Use:

```text
Expo
React Native
Expo Router
expo-sqlite
Drizzle
expo-secure-store
expo-camera
expo-image-picker
expo-document-picker
expo-file-system
expo-notifications
```

### Remote runtime

Use:

```text
Node.js
TypeScript
Fastify
MongoDB Atlas
Google Cloud Storage
Inngest
```

AI providers are accessed only through the remote AI adapter layer.

## 3. Offline-first invariants

These are non-negotiable.

1. Primary screens read from SQLite.
2. Syncable user actions write locally first.
3. A syncable mutation and its Outbox command are committed in the same SQLite transaction.
4. Client-created domain IDs are stable UUIDs and are never replaced after synchronization.
5. Synchronization is bidirectional and incremental.
6. Command retries are idempotent.
7. Conflicts are domain-specific; do not use universal last-write-wins.
8. Previously synchronized business data remains usable without connectivity.
9. Field capture must not be blocked by AI availability.
10. AI/document processing may remain pending until connectivity returns.
11. Never delete an unsynchronized source file or user action.
12. A normal screen must not depend on a synchronous remote request to render existing local state.

## 4. Shared deterministic logic

Canonical deterministic logic should live in runtime-neutral shared TypeScript packages.

In particular:

```text
packages/analytics-core
packages/substitution-core
packages/commercial-core
packages/domain
```

Do not create separate mobile and remote implementations of the same KPI formula.

Official business numbers are deterministic application outputs.

AI may explain them; AI does not own them.

## 5. AI rules

AI may:

- extract receipt lines;
- extract commercial-document structure;
- propose product matches;
- propose Need Unit/substitution candidates;
- explain facts;
- recommend actions.

AI must not:

- invent official KPI values;
- invent missing stock;
- invent purchase cost;
- invent elasticity;
- invent expected sales uplift;
- silently validate ambiguous product identity;
- silently validate a substitution relation;
- claim causality from simple observed variation;
- execute a business action without explicit user decision.

The Copilot must preserve:

```text
Fact
≠ Interpretation
≠ Recommendation
```

and:

```text
Instruction enseigne
≠ Observation magasin
≠ Recommandation IA
```

## 6. Business invariants

Never violate these rules.

### Waste and sales

Waste receipt amounts do not modify Mercalys Net Sales.

```text
€1,000 sales + €100 receipt waste
→ sales remain €1,000
```

### Waste source vs product nature

Source channel and product nature are separate.

A photographed waste ticket may contain both:

```text
BULK
PACKAGED
```

Classify each line from the matched Product.

### Missing vs zero

```text
null / unavailable
≠
0
```

Never collapse them.

### Units

Never aggregate incompatible units such as kilograms and pieces.

### Margin

Do not calculate aggregate margin rate by averaging line margin percentages.

### Commercial mechanics

Keep distinct:

```text
fixed price
strict price ceiling
threshold price
card benefit
lot
supplier purchase condition
```

### Commercial state

Keep distinct:

```text
source instruction
store applicability
store plan
store execution
observed result
AI recommendation
```

### Recommendations

Show at most three main priorities on:

```text
Aujourd’hui
Ma semaine
```

Do not fill to three with low-value recommendations.

### Decision and execution

```text
Accepted recommendation
≠
Executed action
```

Execution is recorded separately.

### Causality

Allowed:

```text
“Volume increased during the operation.”
“Compatible with substitution.”
```

Not automatically allowed:

```text
“The promotion caused the increase.”
“The stockout caused +35% sales.”
```

## 7. Product & substitution model

Product identity must keep distinct:

```text
category
nature
sales unit
packaging
identifiers
aliases
Need Units
substitution relationships
```

Identifiers such as ITM8, EAN and PLU are strings and must preserve leading zeroes.

Need Units represent customer purchase need, not order quantity.

Substitution edges are directed:

```text
A → B
```

does not imply:

```text
B → A
```

Behavioral substitute ranking and commercial recommendation ranking are distinct.

Canonical substitution score/confidence updates are deterministic and auditable.

Rejected relationships never silently reactivate.

## 8. Source ingestion rules

Original source documents are immutable and traceable.

Keep:

```text
original source
parsed source
normalized record
validated record
published business observation
```

separate.

Imports must be idempotent.

Exact duplicate:

```text
do not double-publish
```

Overlapping corrected import:

```text
reconcile
do not blindly add
```

Mercalys report generation date must not replace article business date.

Total/report metadata rows are not product observations.

## 9. Native UX invariants

Primary navigation:

```text
Aujourd’hui
Ma semaine
Analyses
Casse
Plus
```

The user must understand relevant states such as:

```text
Local
À synchroniser
Synchronisé
Conflit
Analyse IA en attente
Données incomplètes
```

Normal background synchronization must not replace existing local content with empty loading states.

When connectivity fails, preserve content and field actions.

## 10. Data ownership

Local operational store:

```text
SQLite
```

Remote durable/cross-device store:

```text
MongoDB Atlas
```

Large source binaries:

```text
Google Cloud Storage
```

The native client must never contain:

- database credentials;
- storage service-account secrets;
- AI provider secrets;
- job signing secrets.

## 11. Sync rules

Shared sync contracts live in:

```text
packages/sync-contracts
```

Remote sync service must support:

```text
bootstrap
push
pull
conflict reconciliation
```

Every syncable entity must have an explicit:

- local table;
- remote collection;
- serializer;
- conflict policy;
- idempotency tests.

Do not implement one-off synchronization logic inside feature screens.

## 12. Development sequence

Canonical milestone order:

```text
M0 Foundation
M1 Sync Core
M2 Product Master + Local Mercalys
M3 Analytics + Today
M4 Waste Receipt
M5 Commercial Planning
M6 Need Units + Substitution
M7 Copilot + Decisions + Execution
M8 Hardening + Pilot Release
```

Do not skip M1 in order to build visible business features faster.

The first architecture proof is:

```text
create useful data offline
→ close the app
→ reopen
→ synchronize exactly once
→ observe the same trusted entity on another device
```

## 13. Ticket workflow

Before implementing a ticket:

1. Read `IMPLEMENTATION_PLAN.md`.
2. Read the relevant functional specification.
3. Read the relevant technical/database/UX specification.
4. Confirm dependencies are complete.
5. Identify acceptance criteria.
6. Stop if specifications materially contradict each other.

For every ticket:

1. update shared Zod contracts first when data contracts change;
2. add migrations before repository use;
3. implement deterministic business logic with tests;
4. implement offline behavior where applicable;
5. implement sync behavior where applicable;
6. implement French UI states;
7. run lint, typecheck and relevant tests;
8. report files changed, tests run and remaining risks.

## 14. Definition of Done

A ticket is not done merely because the happy path renders.

It is done only when applicable requirements pass for:

- compilation;
- strict TypeScript;
- unit/integration tests;
- offline behavior;
- restart persistence;
- synchronization;
- idempotency;
- conflict behavior;
- loading/empty/error states;
- French labels;
- accessibility basics;
- acceptance criteria.

## 15. Architecture changes require human approval

If an implementation constraint suggests changing any of the following, STOP and propose the change rather than applying it:

```text
React Native + Expo
offline-first model
SQLite operational datastore
Outbox + incremental sync
stable client-generated IDs
Fastify remote API
MongoDB durable store
shared deterministic KPI logic
business invariants
```

A library compatibility spike may recommend an adapter change without changing these invariants.

## 16. Canonical specifications

Read specifications from `docs/specs/`.

Recommended order for a new agent:

1. `Copilot_FL_MVP_v0.4_EN.md`
2. `TECHNICAL_ARCHITECTURE_AND_IMPLEMENTATION_SPEC.md`
3. `DATABASE_AND_API_CONTRACTS.md`
4. `UX_FLOWS_AND_SCREEN_SPEC.md`
5. `IMPLEMENTATION_PLAN.md`
6. Feature-specific functional specs as required.

Do not use superseded technical documents from outside this repository.

## 17. Current implementation scope

The repository currently starts at:

```text
M0-T01 — Create monorepo
```

Do not implement later milestone behavior unless the current ticket explicitly asks for it.
