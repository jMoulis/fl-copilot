# Database & API Contracts — Native Offline-First

**Product:** Fruits & Vegetables Copilot  
**Document:** `DATABASE_AND_API_CONTRACTS.md`  
**Version:** 1.0  
**Date:** 16 September 2026  
**Specification language:** English  
**Application language:** French (`fr-FR`)  
**Primary client:** React Native + Expo  
**Architecture:** Offline-first / local-first  
**Local datastore:** SQLite via Expo SQLite + Drizzle  
**Remote datastore:** MongoDB Atlas  
**Remote API:** Node.js + TypeScript + Fastify  
**Status:** Canonical database, synchronization and API contract for the development agent.

---

# 1. Purpose

This document defines the data and transport contracts required by the native offline-first architecture.

It specifies:

1. canonical entity identifiers;
2. local SQLite schema;
3. remote MongoDB schema;
4. shared serialization rules;
5. synchronization protocol;
6. Outbox command contracts;
7. remote change-feed contracts;
8. conflict handling;
9. bootstrap and incremental synchronization;
10. file-upload contracts;
11. authentication/session contracts;
12. domain APIs;
13. read-model APIs;
14. job-status APIs;
15. error contracts;
16. compatibility/versioning rules.

This document must be implemented together with:

```text
TECHNICAL_ARCHITECTURE_AND_IMPLEMENTATION_SPEC.md
PRODUCT_AND_SUBSTITUTION_FUNCTIONAL_SPEC.md
KPI_AND_ANALYTICS_ENGINE_FUNCTIONAL_SPEC.md
COMMERCIAL_PLANNING_AND_PROMOTION_ENGINE_FUNCTIONAL_SPEC.md
I_COPILOT_AND_RECOMMENDATION_ENGINE_FUNCTIONAL_SPEC.md
DATA_INGESTION_AND_DOCUMENT_PROCESSING_FUNCTIONAL_SPEC.md
```

---

# 2. Canonical data architecture

The system has two durable operational representations.

## Local operational representation

```text
SQLite
```

Used by the native application for:

- normal screen reads;
- local writes;
- offline field work;
- local deterministic analytics;
- pending synchronization;
- conflict retention.

## Remote durable representation

```text
MongoDB Atlas
```

Used for:

- cross-device state;
- durable synchronized history;
- audit;
- source records;
- remote processing;
- multi-device coordination;
- canonical remote revisioning.

These representations are synchronized but not byte-for-byte identical.

---

# 3. Core synchronization invariant

A syncable local mutation is committed as:

```text
business entity mutation
+
Outbox command
```

inside one SQLite transaction.

The remote service applies the command idempotently.

The remote service then emits a store-scoped change record.

All devices pull the change record and update SQLite.

---

# 4. Canonical identifiers

All domain IDs are string UUIDs.

Recommended format:

```text
UUID v4
```

generated on the client for client-created entities.

Examples:

```text
productId
receiptId
eventId
decisionId
actionId
sourceDocumentId
```

Remote-generated entities also use the same string ID format.

Do not expose MongoDB ObjectId as a domain identifier.

Mongo `_id` should equal the canonical string ID where practical.

---

# 5. Client-generated ID invariant

For entities created on device:

```text
local ID == remote ID
```

The server must not replace the ID after synchronization.

This is required for offline references and idempotency.

---

# 6. Entity version

Syncable mutable entities include:

```ts
version: number
```

Version starts at:

```text
1
```

and increments on every accepted remote mutation.

Append-only event entities may still carry a version for consistency.

---

# 7. Timestamps

Remote canonical timestamps use UTC ISO 8601.

Example:

```text
2026-09-16T14:42:11.412Z
```

Business dates use local calendar-date semantics:

```text
2026-09-16
```

Store timezone is used for business-day interpretation.

---

# 8. Date-time source metadata

User-created field events should preserve:

```text
occurredAt / startedAt
clientCapturedAt
serverReceivedAt
```

where useful.

This supports device-clock diagnostics without overwriting business intent.

---

# 9. Decimal serialization

Canonical API serialization for decimal business values:

```text
decimal string
```

Examples:

```json
"4.88"
"0.580"
"172.45"
```

Do not transport business-critical decimal values as binary floating-point JSON numbers.

---

# 10. Money serialization

```ts
type MoneyDto = {
  amount: string;
  currency: "EUR";
};
```

Example:

```json
{
  "amount": "46.00",
  "currency": "EUR"
}
```

---

# 11. Quantity serialization

```ts
type DecimalQuantityDto = {
  value: string;
  unit: "KG" | "PIECE" | "PACK" | "G" | "UNKNOWN";
};
```

Where the unit is already implied by the domain field, only the decimal string may be stored.

---

# 12. Score serialization

Scores in range `0..1` may be serialized as JSON numbers because they are not financial/reconciliation quantities.

Examples:

```text
relationshipScore
confidence
dataQualityScore
```

---

# 13. Shared sync metadata

Canonical syncable entity DTO:

```ts
type SyncEntityMeta = {
  id: string;
  storeId: string;

  version: number;

  createdAt: string;
  updatedAt: string;

  deletedAt?: string | null;
};
```

Local-only metadata is not part of the remote entity DTO.

---

# 14. Local sync metadata

SQLite tables may add:

```ts
type LocalSyncMeta = {
  syncState:
    | "LOCAL"
    | "PENDING_SYNC"
    | "SYNCED"
    | "CONFLICT";

  remoteVersion?: number | null;

  lastSyncedAt?: string | null;

  dirty: 0 | 1;
};
```

---

# 15. SQLite naming conventions

Use:

```text
snake_case table names
snake_case column names
```

Examples:

```text
product_identifiers
source_documents
sync_outbox
```

Domain TypeScript uses camelCase.

---

# 16. SQLite primary key convention

Every domain table:

```sql
id TEXT PRIMARY KEY NOT NULL
```

Store-scoped tables additionally include:

```sql
store_id TEXT NOT NULL
```

---

# 17. SQLite boolean convention

Store booleans as:

```text
INTEGER 0/1
```

Drizzle maps to TypeScript boolean.

---

# 18. SQLite JSON convention

Nested flexible metadata may be stored as JSON text.

Do not use JSON blobs for fields that need indexing/querying frequently.

---

# 19. SQLite local schema — stores

```sql
CREATE TABLE stores (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL,
  currency TEXT NOT NULL,
  country TEXT NOT NULL,
  postal_code TEXT,
  city TEXT,
  latitude TEXT,
  longitude TEXT,
  school_holiday_zone TEXT,
  opening_calendar_json TEXT,
  merchandising_capacity_json TEXT,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
```

The app typically stores only authorized stores.

---

# 20. SQLite local schema — products

```sql
CREATE TABLE products (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,

  label TEXT NOT NULL,

  category TEXT NOT NULL,
  nature TEXT NOT NULL,
  sales_unit TEXT NOT NULL,

  packaging_quantity TEXT,
  packaging_unit TEXT,
  packaging_source_label TEXT,

  family_id TEXT,
  subfamily_id TEXT,

  status TEXT NOT NULL,

  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,

  sync_state TEXT NOT NULL DEFAULT 'SYNCED',
  remote_version INTEGER,
  dirty INTEGER NOT NULL DEFAULT 0
);
```

Indexes:

```sql
CREATE INDEX idx_products_store_status
ON products(store_id, status);

CREATE INDEX idx_products_store_label
ON products(store_id, label);
```

---

# 21. SQLite — product identifiers

```sql
CREATE TABLE product_identifiers (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,
  product_id TEXT NOT NULL,

  type TEXT NOT NULL,
  value TEXT NOT NULL,

  source TEXT NOT NULL,
  status TEXT NOT NULL,

  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,

  sync_state TEXT NOT NULL DEFAULT 'SYNCED',
  remote_version INTEGER,
  dirty INTEGER NOT NULL DEFAULT 0
);
```

Unique active identity is enforced remotely.

Local index:

```sql
CREATE INDEX idx_product_identifiers_lookup
ON product_identifiers(store_id, type, value);
```

---

# 22. SQLite — product aliases

```sql
CREATE TABLE product_aliases (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,
  product_id TEXT NOT NULL,

  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,

  source TEXT NOT NULL,
  status TEXT NOT NULL,
  confidence REAL,

  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,

  sync_state TEXT NOT NULL DEFAULT 'SYNCED',
  remote_version INTEGER,
  dirty INTEGER NOT NULL DEFAULT 0
);
```

---

# 23. SQLite — Need Units

```sql
CREATE TABLE need_units (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,

  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,

  status TEXT NOT NULL,
  created_by TEXT NOT NULL,

  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,

  sync_state TEXT NOT NULL DEFAULT 'SYNCED',
  remote_version INTEGER,
  dirty INTEGER NOT NULL DEFAULT 0
);
```

---

# 24. SQLite — Need Unit memberships

```sql
CREATE TABLE need_memberships (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,

  product_id TEXT NOT NULL,
  need_unit_id TEXT NOT NULL,

  strength REAL NOT NULL,
  primary_flag INTEGER NOT NULL,

  source TEXT NOT NULL,
  confidence REAL NOT NULL,
  status TEXT NOT NULL,

  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,

  sync_state TEXT NOT NULL DEFAULT 'SYNCED',
  remote_version INTEGER,
  dirty INTEGER NOT NULL DEFAULT 0
);
```

Unique logical relation remotely:

```text
storeId + productId + needUnitId
```

---

# 25. SQLite — substitutions

```sql
CREATE TABLE product_substitutions (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,

  source_product_id TEXT NOT NULL,
  substitute_product_id TEXT NOT NULL,
  need_unit_id TEXT NOT NULL,

  need_compatibility REAL NOT NULL,
  usage_compatibility REAL NOT NULL,
  price_compatibility REAL,
  packaging_compatibility REAL,

  observed_substitution REAL,

  relationship_score REAL NOT NULL,
  confidence REAL NOT NULL,
  evidence_count INTEGER NOT NULL DEFAULT 0,

  status TEXT NOT NULL,
  source TEXT NOT NULL,
  last_evidence_at TEXT,

  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,

  sync_state TEXT NOT NULL DEFAULT 'SYNCED',
  remote_version INTEGER,
  dirty INTEGER NOT NULL DEFAULT 0
);
```

Indexes:

```sql
CREATE INDEX idx_substitution_source
ON product_substitutions(store_id, source_product_id, need_unit_id, status);

CREATE INDEX idx_substitution_target
ON product_substitutions(store_id, substitute_product_id, status);
```

---

# 26. SQLite — sales observations

Sales observations are mostly append/reconciliation driven.

```sql
CREATE TABLE sales_observations (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,

  product_id TEXT NOT NULL,
  business_date TEXT NOT NULL,

  quantity TEXT NOT NULL,

  purchase_value TEXT,
  rce_value TEXT,
  sales_value TEXT,
  vat_value TEXT,
  margin_value TEXT,
  margin_rate TEXT,

  source_document_id TEXT NOT NULL,
  source_record_id TEXT NOT NULL,

  validation_status TEXT NOT NULL,

  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,

  sync_state TEXT NOT NULL DEFAULT 'SYNCED',
  remote_version INTEGER,
  dirty INTEGER NOT NULL DEFAULT 0
);
```

Indexes:

```sql
CREATE INDEX idx_sales_date_product
ON sales_observations(store_id, business_date, product_id);

CREATE INDEX idx_sales_product_date
ON sales_observations(store_id, product_id, business_date);

CREATE UNIQUE INDEX idx_sales_source_record
ON sales_observations(store_id, source_record_id);
```

---

# 27. SQLite — waste receipts

```sql
CREATE TABLE waste_receipts (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,

  source_document_id TEXT,

  local_file_id TEXT,

  capture_date TEXT,
  detected_receipt_date TEXT,
  confirmed_waste_date TEXT,

  processing_status TEXT NOT NULL,
  ai_status TEXT NOT NULL,
  duplicate_status TEXT NOT NULL,

  note TEXT,

  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,

  sync_state TEXT NOT NULL,
  remote_version INTEGER,
  dirty INTEGER NOT NULL DEFAULT 0
);
```

---

# 28. SQLite — waste lines

```sql
CREATE TABLE waste_lines (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,

  receipt_id TEXT NOT NULL,

  source_line_index INTEGER NOT NULL,

  raw_label TEXT NOT NULL,

  quantity TEXT,
  weight TEXT,
  quantity_unit TEXT,

  unit_price TEXT,
  total_price TEXT,

  matched_product_id TEXT,
  match_status TEXT NOT NULL,
  match_confidence REAL,

  product_nature TEXT NOT NULL,

  extraction_confidence_json TEXT,
  source_region_json TEXT,

  validation_status TEXT NOT NULL,

  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,

  sync_state TEXT NOT NULL,
  remote_version INTEGER,
  dirty INTEGER NOT NULL DEFAULT 0
);
```

---

# 29. SQLite — waste observations

```sql
CREATE TABLE waste_observations (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,

  product_id TEXT NOT NULL,
  business_date TEXT NOT NULL,

  product_nature TEXT NOT NULL,

  quantity TEXT,

  purchase_value_known TEXT,
  purchase_value_estimated TEXT,
  sales_value TEXT,

  cost_quality TEXT NOT NULL,

  source_type TEXT NOT NULL,
  source_document_id TEXT,
  source_record_id TEXT NOT NULL,

  validation_status TEXT NOT NULL,

  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,

  sync_state TEXT NOT NULL,
  remote_version INTEGER,
  dirty INTEGER NOT NULL DEFAULT 0
);
```

---

# 30. SQLite — source documents

```sql
CREATE TABLE source_documents (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,

  source_type TEXT NOT NULL,

  original_filename TEXT,
  local_file_uri TEXT,

  checksum TEXT,

  source_generated_at TEXT,
  business_period_start TEXT,
  business_period_end TEXT,

  local_processing_status TEXT NOT NULL,
  remote_upload_status TEXT NOT NULL,
  remote_processing_status TEXT,

  parser_version TEXT,
  extraction_model_version TEXT,

  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,

  sync_state TEXT NOT NULL,
  remote_version INTEGER,
  dirty INTEGER NOT NULL DEFAULT 0
);
```

---

# 31. SQLite — source records

```sql
CREATE TABLE source_records (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,

  source_document_id TEXT NOT NULL,

  source_index INTEGER,
  source_page INTEGER,

  raw_payload_json TEXT NOT NULL,
  normalized_payload_json TEXT,

  status TEXT NOT NULL,
  error_codes_json TEXT NOT NULL,
  warning_codes_json TEXT NOT NULL,

  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
```

These may be retained locally only for the active/local-history window.

---

# 32. SQLite — commercial operations

```sql
CREATE TABLE commercial_operations (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,

  source_document_id TEXT,

  name TEXT NOT NULL,
  operation_nature_json TEXT NOT NULL,
  theme TEXT,

  announced_start TEXT,
  announced_end TEXT,
  actual_start TEXT,
  actual_end TEXT,

  applicability_status TEXT NOT NULL,
  planning_status TEXT NOT NULL,

  note TEXT,

  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,

  sync_state TEXT NOT NULL,
  remote_version INTEGER,
  dirty INTEGER NOT NULL DEFAULT 0
);
```

---

# 33. SQLite — offers

```sql
CREATE TABLE offers (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,

  operation_id TEXT NOT NULL,
  product_id TEXT,

  raw_product_label TEXT,

  mechanism_type TEXT NOT NULL,
  mechanism_json TEXT NOT NULL,

  purchase_condition_json TEXT,

  sale_start TEXT,
  sale_end TEXT,

  status TEXT NOT NULL,

  source_references_json TEXT NOT NULL,

  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,

  sync_state TEXT NOT NULL,
  remote_version INTEGER,
  dirty INTEGER NOT NULL DEFAULT 0
);
```

---

# 34. SQLite — market signals

```sql
CREATE TABLE market_signals (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,

  source_document_id TEXT,

  product_id TEXT,
  family_id TEXT,
  category TEXT,

  type TEXT NOT NULL,
  severity TEXT,

  valid_from TEXT,
  valid_to TEXT,

  raw_text TEXT NOT NULL,

  source_reference_json TEXT,

  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,

  sync_state TEXT NOT NULL,
  remote_version INTEGER,
  dirty INTEGER NOT NULL DEFAULT 0
);
```

---

# 35. SQLite — execution instructions

```sql
CREATE TABLE execution_instructions (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,

  operation_id TEXT NOT NULL,
  product_id TEXT,

  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  due_date TEXT,

  applicability_status TEXT NOT NULL,
  execution_status TEXT NOT NULL,
  completed_at TEXT,

  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,

  sync_state TEXT NOT NULL,
  remote_version INTEGER,
  dirty INTEGER NOT NULL DEFAULT 0
);
```

---

# 36. SQLite — store product events

```sql
CREATE TABLE store_events (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,

  product_id TEXT,

  type TEXT NOT NULL,

  started_at TEXT NOT NULL,
  ended_at TEXT,

  severity TEXT,
  source TEXT NOT NULL,
  comment TEXT,

  status TEXT NOT NULL,

  client_captured_at TEXT,
  server_received_at TEXT,

  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,

  sync_state TEXT NOT NULL,
  remote_version INTEGER,
  dirty INTEGER NOT NULL DEFAULT 0
);
```

---

# 37. SQLite — product daily performance

```sql
CREATE TABLE product_daily_performance (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,

  product_id TEXT NOT NULL,
  business_date TEXT NOT NULL,

  sales_quantity TEXT,
  sales_value TEXT,
  sales_purchase_value TEXT,
  sales_margin_value TEXT,
  sales_margin_rate TEXT,

  waste_quantity TEXT,
  waste_purchase_value_known TEXT,
  waste_purchase_value_estimated TEXT,
  waste_sales_value TEXT,

  commercial_operation_ids_json TEXT NOT NULL,
  context_event_ids_json TEXT NOT NULL,

  quality_score REAL NOT NULL,

  origin TEXT NOT NULL,
  formula_version TEXT NOT NULL,
  input_revision TEXT NOT NULL,

  computed_at TEXT NOT NULL
);
```

Unique:

```sql
CREATE UNIQUE INDEX idx_product_daily_unique
ON product_daily_performance(store_id, product_id, business_date);
```

---

# 38. SQLite — department daily performance

```sql
CREATE TABLE department_daily_performance (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,

  business_date TEXT NOT NULL,

  sales_value TEXT,
  purchase_value TEXT,
  margin_value TEXT,

  waste_purchase_value_known TEXT,
  waste_purchase_value_estimated TEXT,
  waste_sales_value TEXT,

  quality_json TEXT NOT NULL,

  origin TEXT NOT NULL,
  formula_version TEXT NOT NULL,
  input_revision TEXT NOT NULL,

  computed_at TEXT NOT NULL
);
```

---

# 39. SQLite — recommendations

```sql
CREATE TABLE recommendations (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,

  context_id TEXT NOT NULL,
  type TEXT NOT NULL,

  title_fr TEXT NOT NULL,
  summary_fr TEXT NOT NULL,

  entity_ids_json TEXT NOT NULL,
  source_candidate_ids_json TEXT NOT NULL,

  facts_json TEXT NOT NULL,

  interpretation_fr TEXT NOT NULL,
  proposed_action_fr TEXT NOT NULL,
  objective_fr TEXT NOT NULL,

  risks_fr_json TEXT NOT NULL,
  missing_data_fr_json TEXT NOT NULL,

  measurement_plan_json TEXT NOT NULL,
  confidence_json TEXT NOT NULL,

  priority_rank INTEGER,

  status TEXT NOT NULL,

  generation_version TEXT,

  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,

  sync_state TEXT NOT NULL DEFAULT 'SYNCED',
  remote_version INTEGER,
  dirty INTEGER NOT NULL DEFAULT 0
);
```

---

# 40. SQLite — decisions

```sql
CREATE TABLE decisions (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,

  recommendation_id TEXT NOT NULL,

  type TEXT NOT NULL,

  decided_at TEXT NOT NULL,

  modified_action TEXT,
  postpone_until TEXT,
  reason TEXT,

  user_id TEXT NOT NULL,

  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,

  sync_state TEXT NOT NULL,
  remote_version INTEGER,
  dirty INTEGER NOT NULL DEFAULT 0
);
```

---

# 41. SQLite — action executions

```sql
CREATE TABLE action_executions (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,

  recommendation_id TEXT,
  decision_id TEXT,

  action_type TEXT NOT NULL,

  planned_start TEXT,
  planned_end TEXT,

  actual_start TEXT,
  actual_end TEXT,

  actual_price TEXT,
  actual_price_unit TEXT,
  actual_location TEXT,

  status TEXT NOT NULL,
  notes TEXT,

  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,

  sync_state TEXT NOT NULL,
  remote_version INTEGER,
  dirty INTEGER NOT NULL DEFAULT 0
);
```

---

# 42. SQLite — analytical candidates

```sql
CREATE TABLE analytical_candidates (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,

  type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,

  urgency_score REAL NOT NULL,
  economic_impact_score REAL NOT NULL,
  deviation_score REAL,
  data_quality_score REAL NOT NULL,

  evidence_json TEXT NOT NULL,

  status TEXT NOT NULL,

  generated_at TEXT NOT NULL,

  origin TEXT NOT NULL
);
```

These are rebuildable.

---

# 43. SQLite — local files

```sql
CREATE TABLE local_files (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,

  source_document_id TEXT,

  local_uri TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  checksum TEXT,

  retention_status TEXT NOT NULL,
  upload_status TEXT NOT NULL,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

---

# 44. SQLite — Outbox

```sql
CREATE TABLE sync_outbox (
  command_id TEXT PRIMARY KEY NOT NULL,

  store_id TEXT NOT NULL,
  device_id TEXT NOT NULL,

  local_sequence INTEGER NOT NULL,

  command_type TEXT NOT NULL,

  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,

  expected_remote_version INTEGER,

  payload_json TEXT NOT NULL,

  created_at TEXT NOT NULL,

  status TEXT NOT NULL,

  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  last_error_code TEXT
);
```

Index:

```sql
CREATE INDEX idx_outbox_pending
ON sync_outbox(store_id, status, local_sequence);
```

---

# 45. SQLite — Inbox/sync state

```sql
CREATE TABLE sync_inbox_state (
  store_id TEXT PRIMARY KEY NOT NULL,

  cursor TEXT,
  last_successful_sync_at TEXT,

  protocol_version INTEGER NOT NULL,
  bootstrap_revision TEXT
);
```

---

# 46. SQLite — conflicts

```sql
CREATE TABLE sync_conflicts (
  id TEXT PRIMARY KEY NOT NULL,

  store_id TEXT NOT NULL,

  command_id TEXT,

  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,

  local_payload_json TEXT NOT NULL,
  remote_payload_json TEXT NOT NULL,

  local_expected_version INTEGER,
  remote_version INTEGER,

  conflict_type TEXT NOT NULL,

  status TEXT NOT NULL,

  created_at TEXT NOT NULL,
  resolved_at TEXT
);
```

---

# 47. SQLite — processed local job state

Recommended:

```sql
CREATE TABLE local_jobs (
  id TEXT PRIMARY KEY NOT NULL,

  type TEXT NOT NULL,
  entity_id TEXT,

  stage TEXT NOT NULL,
  progress REAL,

  payload_json TEXT,

  status TEXT NOT NULL,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Used for recoverable local import processing.

---

# 48. Remote MongoDB conventions

Collection names use camelCase or agreed repository convention.

Canonical string domain ID is stored in:

```text
_id
```

Example:

```json
{
  "_id": "1ee6...",
  "storeId": "..."
}
```

No separate public ObjectId.

---

# 49. Remote sync metadata fields

Syncable Mongo documents include:

```ts
{
  _id: string,
  storeId: string,

  version: number,

  createdAt: Date,
  updatedAt: Date,
  deletedAt?: Date | null
}
```

---

# 50. Remote decimal representation

MongoDB uses Decimal128 for business decimal values where arithmetic/indexing is useful.

Repository layer converts:

```text
API decimal string
↔ Decimal128
↔ decimal.js
```

No business package imports Mongo Decimal128 directly.

---

# 51. Remote products collection

```ts
type ProductDocument = {
  _id: string;
  storeId: string;

  label: string;

  category: "FRUIT" | "VEGETABLE" | "OTHER" | "UNKNOWN";
  nature: "BULK" | "PACKAGED" | "UNKNOWN";
  salesUnit: "KG" | "PIECE" | "PACK" | "UNKNOWN";

  packaging?: {
    quantity: Decimal128;
    unit: string;
    sourceLabel?: string | null;
  } | null;

  familyId?: string | null;
  subfamilyId?: string | null;

  status: "ACTIVE" | "INACTIVE" | "TO_REVIEW";

  schemaVersion: number;

  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
};
```

---

# 52. Remote product identifier uniqueness

Index concept:

```js
{
  storeId: 1,
  type: 1,
  value: 1
}
```

Unique for active/non-rejected records through partial-index policy.

Any conflict is a business validation error, not silent overwrite.

---

# 53. Remote product substitutions collection

```ts
type ProductSubstitutionDocument = {
  _id: string;
  storeId: string;

  sourceProductId: string;
  substituteProductId: string;
  needUnitId: string;

  needCompatibility: number;
  usageCompatibility: number;
  priceCompatibility?: number | null;
  packagingCompatibility?: number | null;

  observedSubstitution?: number | null;

  relationshipScore: number;
  confidence: number;

  evidenceCount: number;

  status: string;
  source: string;

  lastEvidenceAt?: Date | null;

  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
};
```

Unique logical edge:

```text
storeId + sourceProductId + substituteProductId + needUnitId
```

---

# 54. Remote sales observations

```ts
type SalesObservationDocument = {
  _id: string;
  storeId: string;

  productId: string;
  date: string;

  quantity: Decimal128;

  purchaseValue?: Decimal128 | null;
  rceValue?: Decimal128 | null;
  salesValue?: Decimal128 | null;
  vatValue?: Decimal128 | null;
  marginValue?: Decimal128 | null;
  marginRate?: Decimal128 | null;

  sourceDocumentId: string;
  sourceRecordId: string;

  validationStatus: string;

  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
};
```

Unique source record:

```text
storeId + sourceRecordId
```

---

# 55. Remote waste observations

Same canonical fields as functional contract, with Decimal128 for quantities/money.

Critical invariant:

```text
waste salesValue
does not mutate sales observations
```

---

# 56. Remote source documents

```ts
type SourceDocumentDocument = {
  _id: string;
  storeId: string;

  sourceType: string;

  originalFilename?: string | null;
  mimeType?: string | null;

  checksum?: string | null;

  objectStorageKey?: string | null;

  sourceGeneratedAt?: Date | null;

  businessPeriodStart?: string | null;
  businessPeriodEnd?: string | null;

  status: string;

  parserVersion?: string | null;
  extractionModelVersion?: string | null;

  versionGroupId?: string | null;
  versionNumber?: number | null;

  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
};
```

---

# 57. Remote syncChanges collection

```ts
type SyncChangeDocument = {
  _id: string;

  storeId: string;

  sequence: Long;

  entityType: string;
  entityId: string;

  operation: "UPSERT" | "DELETE";

  entityVersion: number;

  changedAt: Date;

  payloadRevision?: string | null;
};
```

Unique:

```text
storeId + sequence
```

Index:

```text
storeId + sequence
```

---

# 58. Per-store sequence allocation

Sequence allocation MUST be atomic.

Recommended collection:

```text
syncStoreCounters
```

Document:

```json
{
  "_id": "<storeId>",
  "nextSequence": 184728
}
```

Use atomic `$inc`.

---

# 59. Remote processedCommands

```ts
type ProcessedCommandDocument = {
  _id: string; // commandId

  storeId: string;
  deviceId: string;

  commandType: string;

  resultStatus:
    | "APPLIED"
    | "REJECTED"
    | "CONFLICT";

  entityType: string;
  entityId: string;

  resultingVersion?: number | null;

  responseJson?: unknown;

  processedAt: Date;
};
```

Command ID is globally unique.

---

# 60. Remote device sessions

```ts
type DeviceSessionDocument = {
  _id: string;

  userId: string;
  storeId: string;
  deviceId: string;

  refreshTokenHash: string;

  platform: "IOS" | "ANDROID";

  appVersion: string;

  createdAt: Date;
  lastUsedAt: Date;
  revokedAt?: Date | null;
};
```

---

# 61. Sync protocol version

Initial:

```text
syncProtocolVersion = 1
```

Every sync request includes:

```json
{
  "syncProtocolVersion": 1,
  "appVersion": "1.0.0",
  "localSchemaVersion": 1
}
```

---

# 62. Bootstrap request

```http
GET /api/v1/sync/bootstrap
Authorization: Bearer <token>
X-Store-Id: <storeId>
X-Sync-Protocol-Version: 1
```

Optional query:

```text
rawObservationDays=90
```

Server validates allowed limits.

---

# 63. Bootstrap response

```ts
type BootstrapResponse = {
  protocolVersion: number;

  store: StoreDto;

  snapshotRevision: string;

  cursor: string;

  historyPolicy: {
    rawObservationDays: number;
  };

  entities: {
    products: ProductDto[];
    productIdentifiers: ProductIdentifierDto[];
    productAliases: ProductAliasDto[];

    needUnits: NeedUnitDto[];
    needMemberships: NeedMembershipDto[];
    productSubstitutions: ProductSubstitutionDto[];

    salesObservations: SalesObservationDto[];
    wasteObservations: WasteObservationDto[];

    commercialOperations: CommercialOperationDto[];
    offers: OfferDto[];
    marketSignals: MarketSignalDto[];
    executionInstructions: ExecutionInstructionDto[];

    storeEvents: StoreEventDto[];

    productDailyPerformance: ProductDailyPerformanceDto[];
    departmentDailyPerformance: DepartmentDailyPerformanceDto[];

    recommendations: RecommendationDto[];
    decisions: DecisionDto[];
    actionExecutions: ActionExecutionDto[];
  };

  serverTime: string;
};
```

Large bootstrap may be paged by sections in implementation.

---

# 64. Bootstrap transactional local application

The mobile app applies bootstrap into a new/cleared SQLite transaction or staged import.

Only after successful local write does it update:

```text
sync cursor
bootstrap revision
```

---

# 65. Push endpoint

```http
POST /api/v1/sync/push
Authorization: Bearer <token>
X-Store-Id: <storeId>
X-Sync-Protocol-Version: 1
```

The endpoint accepts the oldest pending local Outbox commands first and processes each command independently.

---

# 66. Push command envelope

```ts
type SyncPushRequest = {
  syncProtocolVersion: number;
  appVersion: string;

  deviceId: string;
  storeId: string;

  commands: SyncCommand[];
};
```

---

# 67. Sync command

```ts
type SyncCommand = {
  commandId: string;

  localSequence: number;

  type: string;

  entityType: string;
  entityId: string;

  expectedRemoteVersion?: number | null;

  createdAt: string;

  payload: unknown;
};
```

---

# 68. Push batch limit

Initial maximum:

```text
100 commands
```

Configuration may adjust.

The client sends oldest pending commands first.

---

# 69. Push response

```ts
type SyncPushResponse = {
  results: SyncCommandResult[];

  serverTime: string;
};
```

---

# 70. Command result

```ts
type SyncCommandResult = {
  commandId: string;

  status:
    | "APPLIED"
    | "ALREADY_APPLIED"
    | "CONFLICT"
    | "REJECTED"
    | "RETRYABLE_ERROR";

  entityType: string;
  entityId: string;

  remoteVersion?: number | null;

  remoteEntity?: unknown;

  error?: ApiErrorDto | null;
};
```

---

# 71. APPLIED behavior

Client:

- marks Outbox command acknowledged;
- may update `remoteVersion`;
- waits for or immediately applies returned canonical entity when present.

The remote mutation also appears in pull change log.

The pull remains the canonical cross-device propagation mechanism.

---

# 72. ALREADY_APPLIED behavior

Equivalent to successful idempotent acknowledgement.

No duplicate local effect.

---

# 73. CONFLICT behavior

Client:

- stores `sync_conflicts`;
- marks entity `CONFLICT`;
- leaves local payload intact;
- continues syncing unrelated commands when safe.

---

# 74. REJECTED behavior

Used for permanent validation/business failure.

Example:

```text
invalid entity state
unauthorized product relation
stale operation already closed
```

Client marks command failed and shows user-facing resolution.

---

# 75. RETRYABLE_ERROR behavior

Used for transient infrastructure/provider errors.

Client returns command to pending with backoff.

---

# 76. Pull request

```http
GET /api/v1/sync/pull?cursor=<opaque>&limit=500
Authorization: Bearer <token>
X-Store-Id: <storeId>
X-Sync-Protocol-Version: 1
```

---

# 77. Pull response

```ts
type SyncPullResponse = {
  changes: SyncChangeEnvelope[];

  nextCursor: string;

  hasMore: boolean;

  serverTime: string;
};
```

---

# 78. Change envelope

```ts
type SyncChangeEnvelope = {
  sequence: string;

  entityType: string;
  entityId: string;

  operation: "UPSERT" | "DELETE";

  entityVersion: number;

  entity?: unknown;

  changedAt: string;
};
```

---

# 79. UPSERT pull application

Mobile:

1. compare remote entity version;
2. if no dirty local edit, apply remote;
3. if local dirty edit has lower expected remote version, create conflict;
4. update SQLite;
5. trigger local derived recomputation if needed.

---

# 80. DELETE pull application

Apply tombstone locally.

If local unsynchronized mutation exists, create conflict.

Do not silently delete the user's pending edit.

---

# 81. Cursor rule

Cursor advances only after the entire received pull page has been committed to SQLite successfully.

If transaction fails, the prior cursor remains.

---

# 82. Sync cycle order

Recommended default:

```text
PUSH pending commands
→ PULL remote changes
→ local recomputation
→ repeat PULL while hasMore
```

When large remote backlog exists, implementation may pull before pushing if compatibility requires it.

---

# 83. Sync lock

Only one active sync cycle per store/device.

Second trigger attaches/waits rather than starting a competing sync.

---

# 84. Command type registry

Initial commands:

```text
CREATE_STORE_EVENT
UPDATE_STORE_EVENT
CLOSE_STORE_EVENT

CREATE_WASTE_RECEIPT
UPDATE_WASTE_RECEIPT
VALIDATE_WASTE_RECEIPT

CREATE_SOURCE_DOCUMENT
PUBLISH_LOCAL_IMPORT

CREATE_PRODUCT
UPDATE_PRODUCT
CREATE_PRODUCT_ALIAS
VALIDATE_PRODUCT_MATCH

CREATE_NEED_UNIT
UPDATE_NEED_UNIT
UPSERT_NEED_MEMBERSHIP

CREATE_SUBSTITUTION
UPDATE_SUBSTITUTION
REJECT_SUBSTITUTION

UPDATE_EXECUTION_INSTRUCTION
CREATE_MERCHANDISING_PLAN
UPDATE_COMMERCIAL_OPERATION

CREATE_DECISION
UPDATE_DECISION

CREATE_ACTION_EXECUTION
UPDATE_ACTION_EXECUTION

ACK_RECOMMENDATION

CREATE_STOCK_OBSERVATION
```

Exact payload schemas are defined per command.

---

# 85. Example — CREATE_STORE_EVENT payload

```ts
type CreateStoreEventPayload = {
  event: {
    id: string;
    productId?: string | null;

    type:
      | "TENSION"
      | "LOW_STOCK"
      | "OUT_OF_STOCK"
      | "QUALITY_ISSUE"
      | "PRICE_INCREASE"
      | "SUPPLIER_SHORTAGE";

    startedAt: string;
    severity?: "LOW" | "MEDIUM" | "HIGH";
    comment?: string | null;

    clientCapturedAt: string;
  };
};
```

No `storeId` inside trusted payload is necessary; server scope comes from authenticated command envelope.

---

# 86. Example — CLOSE_STORE_EVENT

```ts
type CloseStoreEventPayload = {
  endedAt: string;
};
```

Requires:

```text
expectedRemoteVersion
```

if remote event already exists.

---

# 87. Example — CREATE_DECISION

```ts
type CreateDecisionPayload = {
  decision: {
    id: string;

    recommendationId: string;

    type:
      | "ACCEPT"
      | "MODIFY"
      | "POSTPONE"
      | "REJECT";

    decidedAt: string;

    modifiedAction?: string | null;
    postponeUntil?: string | null;
    reason?: string | null;
  };
};
```

---

# 88. Example — UPDATE_EXECUTION_INSTRUCTION

```ts
type UpdateExecutionInstructionPayload = {
  executionStatus:
    | "TODO"
    | "DONE"
    | "SKIPPED"
    | "NOT_APPLICABLE";

  completedAt?: string | null;
};
```

---

# 89. Source upload authorization

Endpoint:

```http
POST /api/v1/uploads/init
```

Request:

```ts
type InitUploadRequest = {
  sourceDocumentId: string;

  sourceType:
    | "MERCALYS_SALES"
    | "MERCALYS_WASTE"
    | "WASTE_RECEIPT"
    | "WEEKLY_COMMERCIAL_PDF";

  filename: string;
  mimeType: string;
  sizeBytes: number;

  checksum?: string | null;
};
```

---

# 90. Upload init response

```ts
type InitUploadResponse = {
  uploadId: string;

  objectKey: string;

  uploadUrl: string;
  expiresAt: string;

  headers?: Record<string, string>;
};
```

---

# 91. Upload authorization rules

Server validates:

- membership;
- source type;
- allowed MIME;
- file size;
- sourceDocument ID ownership;
- duplicate/known source state.

---

# 92. Upload complete endpoint

```http
POST /api/v1/uploads/{uploadId}/complete
```

Request:

```ts
type CompleteUploadRequest = {
  checksum?: string | null;
  sizeBytes: number;
};
```

Server verifies object presence and metadata.

---

# 93. Upload result

```ts
type CompleteUploadResponse = {
  sourceDocumentId: string;

  remoteUploadStatus:
    | "CONFIRMED"
    | "DUPLICATE"
    | "INVALID";

  jobId?: string | null;
};
```

---

# 94. Job status endpoint

```http
GET /api/v1/jobs/{jobId}
```

Response:

```ts
type JobStatusDto = {
  id: string;

  type: string;

  status:
    | "QUEUED"
    | "PROCESSING"
    | "WAITING_REVIEW"
    | "COMPLETED"
    | "FAILED";

  progress?: number | null;

  stage?: string | null;

  resultEntityIds?: string[];

  error?: ApiErrorDto | null;

  updatedAt: string;
};
```

---

# 95. Authentication — request login code

```http
POST /api/v1/auth/challenges
```

Request:

```ts
{
  email: string;
  deviceId: string;
  platform: "IOS" | "ANDROID";
  appVersion: string;
}
```

Response:

```ts
{
  challengeId: string;
  expiresAt: string;
}
```

---

# 96. Authentication — verify login code

```http
POST /api/v1/auth/challenges/{challengeId}/verify
```

Request:

```ts
{
  code: string;
}
```

Response:

```ts
type AuthSessionResponse = {
  accessToken: string;
  accessTokenExpiresAt: string;

  refreshToken: string;

  user: UserDto;

  stores: StoreAccessDto[];
};
```

---

# 97. Refresh session

```http
POST /api/v1/auth/refresh
```

Request:

```ts
{
  deviceId: string;
  refreshToken: string;
}
```

Returns rotated refresh token.

---

# 98. Logout

```http
POST /api/v1/auth/logout
```

Revokes current device session.

---

# 99. Device registration

```http
POST /api/v1/devices/register
```

Request:

```ts
{
  deviceId: string;
  platform: "IOS" | "ANDROID";
  appVersion: string;
  pushToken?: string | null;
}
```

---

# 100. Push token update

```http
PUT /api/v1/devices/{deviceId}/push-token
```

Can set token to null when notifications are disabled.

---

# 101. Product API philosophy

Products are replicated locally.

Direct product endpoints exist for:

- explicit historical fetch;
- admin/repair;
- source review;
- large detail not included in normal sync.

Normal screen reads use SQLite.

---

# 102. Product detail endpoint

```http
GET /api/v1/products/{productId}
```

Response includes:

- product;
- identifiers;
- aliases;
- Need Unit memberships;
- substitutions;
- recent evidence summary.

---

# 103. Product history endpoint

```http
GET /api/v1/products/{productId}/history
```

Query:

```text
from
to
```

Returns historical slice for insertion into SQLite.

---

# 104. Daily history endpoint

```http
GET /api/v1/history/daily
```

Used when user requests dates outside local retention.

Query:

```text
from
to
productId?
```

Response uses normalized observation/read-model contracts.

---

# 105. Commercial document detail endpoint

```http
GET /api/v1/commercial-documents/{sourceDocumentId}
```

Used for source review.

May return short-lived signed source read URL plus extraction metadata.

---

# 106. Source page endpoint

```http
GET /api/v1/commercial-documents/{sourceDocumentId}/pages/{pageNumber}
```

Returns authorized signed derivative or page reference if available.

---

# 107. Recommendations regenerate endpoint

```http
POST /api/v1/recommendations/regenerate
```

This is a remote-only operation.

Request includes:

```text
surface/context
entity IDs
```

Server derives facts itself.

The client cannot submit arbitrary KPI facts as trusted inputs.

---

# 108. Recommendation regeneration response

```ts
{
  jobId: string;
  existingRecommendationIds?: string[];
}
```

Results arrive through sync.

---

# 109. Analytics confirmation endpoint

Normal analytics arrive via sync.

For diagnostic/on-demand remote recomputation:

```http
POST /api/v1/analytics/recompute
```

restricted to authorized scenarios.

---

# 110. Import verification endpoint

Local Mercalys import sync may request remote verification:

```http
POST /api/v1/imports/{sourceDocumentId}/verify
```

Normally triggered automatically after upload.

---

# 111. Import verification result

```ts
type ImportVerificationResult = {
  sourceDocumentId: string;

  status:
    | "MATCH"
    | "DIFFERENCE"
    | "FAILED";

  localFingerprint?: string;
  remoteFingerprint?: string;

  differenceSummary?: {
    added: number;
    removed: number;
    modified: number;
  };
};
```

---

# 112. Import reconciliation API

```http
GET /api/v1/imports/{sourceDocumentId}/reconciliation
```

and:

```http
POST /api/v1/imports/{sourceDocumentId}/reconciliation/resolve
```

Resolution request is explicit and versioned.

---

# 113. Conflict reconciliation endpoint

```http
POST /api/v1/sync/reconcile
```

Request:

```ts
type ReconcileSyncConflictRequest = {
  conflictId: string;

  resolution:
    | "KEEP_LOCAL"
    | "KEEP_REMOTE"
    | "MERGE";

  mergedPayload?: unknown;
};
```

Allowed choices depend on entity type.

---

# 114. Conflict rules — Product

Stale product edit:

```text
manual resolution required
```

Do not automatic last-write-wins.

---

# 115. Conflict rules — Need Unit

Stale rename/description edit:

```text
manual resolution
```

Membership updates on different product relations may coexist.

---

# 116. Conflict rules — substitution relationship

Concurrent score changes from remote evidence and manual metadata changes require field-aware merge.

Canonical score/confidence remain remote deterministic outputs.

A mobile user may edit relationship status/business inputs, not overwrite canonical learned score blindly.

---

# 117. Conflict rules — store event

Different events have different IDs, so both coexist.

Same event edited concurrently:

```text
version conflict
```

Closing an already-closed event can be idempotent if `endedAt` matches.

---

# 118. Conflict rules — recommendation decision

One active decision per recommendation/user workflow.

If device A accepts and device B rejects before sync:

```text
manual/explicit conflict
```

No silent precedence.

---

# 119. Conflict rules — execution instruction

`DONE` vs stale `TODO`:

server rejects stale downgrade unless explicit reopening command exists.

---

# 120. Conflict rules — source observations

Imported observations are reconciled through import/version rules, not generic record editing.

Mobile arbitrary mutation of published sales observations is not allowed.

Corrections happen through source/import correction workflow.

---

# 121. Conflict rules — derived read models

No user conflict.

Remote-confirmed read model may replace local-derived copy when based on newer synchronized revision.

---

# 122. Conflict rules — recommendation prose

Remote-generated recommendation version is authoritative.

Local decision remains separate.

Do not merge recommendation text.

---

# 123. Delete semantics

Hard DELETE APIs are not exposed for normal business history.

Use:

```text
cancel
reject
deactivate
supersede
tombstone
```

according to domain.

---

# 124. Soft-delete sync

`deletedAt` is synchronized through UPSERT/DELETE semantic change.

The local row may remain tombstoned until retention cleanup.

---

# 125. Processed command retention

Keep processed command IDs long enough to cover realistic retry/device-offline windows.

Recommended initial:

```text
180 days
```

Final policy configurable.

---

# 126. Change log retention

Keep enough `syncChanges` to support offline devices within supported offline duration.

Recommended:

```text
at least 180 days
```

If cursor is older than retained history:

server returns:

```text
REBOOTSTRAP_REQUIRED
```

---

# 127. Rebootstrap error

API error:

```json
{
  "code": "SYNC_REBOOTSTRAP_REQUIRED",
  "messageFr": "Les données locales doivent être resynchronisées complètement."
}
```

---

# 128. API error DTO

```ts
type ApiErrorDto = {
  code: string;
  messageFr: string;

  retryable: boolean;

  details?: unknown;

  requestId?: string;
};
```

---

# 129. Common error codes

```text
AUTH_REQUIRED
AUTH_INVALID_CODE
AUTH_SESSION_EXPIRED
NOT_AUTHORIZED
NOT_FOUND
VALIDATION_ERROR
VERSION_CONFLICT
SYNC_REBOOTSTRAP_REQUIRED
SYNC_PROTOCOL_UNSUPPORTED
COMMAND_REJECTED
UPLOAD_INVALID_TYPE
UPLOAD_TOO_LARGE
UPLOAD_EXPIRED
IMPORT_FORMAT_UNSUPPORTED
IMPORT_VERIFICATION_CONFLICT
RECONCILIATION_REQUIRED
PRODUCT_AMBIGUOUS
PRODUCT_IDENTIFIER_CONFLICT
AI_UNAVAILABLE
GROUNDING_FAILED
EXTERNAL_PROVIDER_UNAVAILABLE
JOB_FAILED
RATE_LIMITED
```

---

# 130. HTTP status mapping

Recommended:

```text
400 VALIDATION_ERROR
401 AUTH_*
403 NOT_AUTHORIZED
404 NOT_FOUND
409 VERSION_CONFLICT / RECONCILIATION_REQUIRED
413 UPLOAD_TOO_LARGE
422 COMMAND_REJECTED / PRODUCT_AMBIGUOUS
429 RATE_LIMITED
503 provider unavailable
```

Sync command batches return per-command statuses rather than fail the whole batch for one business error.

---

# 131. API request ID

Every request receives:

```text
requestId
```

Client includes it in diagnostics when showing a support error.

---

# 132. Store scope header

Authenticated domain requests include:

```text
X-Store-Id
```

The server validates membership.

Never trust body storeId as authorization.

---

# 133. App compatibility headers

Recommended:

```text
X-App-Version
X-Platform
X-Device-Id
X-Sync-Protocol-Version
```

---

# 134. API versioning

Base path:

```text
/api/v1
```

Breaking contract changes require:

- new endpoint version; or
- compatible sync protocol evolution.

Do not break installed app versions silently.

---

# 135. Sync protocol compatibility

Server exposes:

```ts
{
  minSyncProtocolVersion: number;
  maxSyncProtocolVersion: number;
}
```

Unsupported client receives deterministic upgrade/rebootstrap response.

---

# 136. App version policy endpoint

```http
GET /api/v1/app/config
```

Response:

```ts
{
  minimumSupportedAppVersion: string;
  latestAppVersion: string;

  featureFlags: Record<string, boolean>;

  syncProtocolVersion: number;

  maintenance?: {
    active: boolean;
    messageFr?: string;
  };
}
```

---

# 137. Feature flags

Examples:

```text
receiptVision
commercialExtraction
copilot
substitutionLearning
pushNotifications
```

Flags may be scoped by:

```text
environment
store
user role
```

---

# 138. Job/event callbacks

Remote jobs do not call the mobile directly.

They persist result + append `syncChanges`.

Push notification is optional.

This guarantees consistency through the sync channel.

---

# 139. Server-side domain transaction rule

For a syncable mutation, remote transaction should atomically:

1. validate command;
2. mutate domain entity;
3. increment entity version;
4. append audit event if required;
5. append `syncChanges`;
6. persist `processedCommands`.

Use MongoDB transaction where multi-document atomicity is required.

---

# 140. Command idempotency transaction

`processedCommands.commandId` uniqueness must be checked inside the safe mutation flow.

Concurrent duplicate push requests result in one domain mutation.

---

# 141. Source publication transaction

Publishing a validated import should atomically or safely batch:

- observations;
- source states;
- audit;
- change-log signals.

For large imports, use deterministic batch publication plus publication version/idempotency.

---

# 142. Large import synchronization

Do not push hundreds of sales observations as individual mobile commands if a locally imported XLSX can be synchronized more efficiently.

Preferred:

```text
upload original source
+
send local normalized fingerprint/summary
+
remote verify/parse
+
remote publish canonical observations
+
pull canonical observations/read models
```

The local observations remain immediately usable offline.

---

# 143. Local-import sync command

Recommended command:

```text
REGISTER_LOCAL_IMPORT
```

Payload:

```ts
type RegisterLocalImportPayload = {
  sourceDocumentId: string;

  sourceType: "MERCALYS_SALES" | "MERCALYS_WASTE";

  checksum: string;

  businessPeriodStart: string;
  businessPeriodEnd: string;

  localNormalizedFingerprint: string;

  localRecordCount: number;
};
```

File upload is completed separately.

---

# 144. Import verification canonicalization

Remote parser is the cross-device canonical verifier.

If exact normalized parity:

```text
MATCH
```

Remote publishes canonical records.

If difference:

```text
IMPORT_VERIFICATION_CONFLICT
```

The local user is not silently overwritten.

---

# 145. Local receipt sync optimization

Receipt source file is uploaded separately.

The receipt business entity sync command references the sourceDocument ID.

AI result is remote-generated later.

---

# 146. File entity vs domain entity

File upload success does not equal business record publication.

Keep separate:

```text
source file durable
receipt draft
extraction result
validated waste observation
```

---

# 147. Source read authorization

Signed source URLs are issued only after:

- authenticated user;
- store membership;
- source ownership validation.

Expiry must be short.

---

# 148. MongoDB index requirements

At minimum:

```text
products:
storeId + status

productIdentifiers:
storeId + type + value

productAliases:
storeId + normalizedAlias

productSubstitutions:
storeId + sourceProductId + needUnitId + status

salesObservations:
storeId + date + productId
storeId + productId + date
storeId + sourceRecordId UNIQUE

wasteObservations:
storeId + date + productId
storeId + sourceRecordId UNIQUE

commercialOperations:
storeId + announcedStart
storeId + planningStatus

storeProductEvents:
storeId + productId + startedAt

recommendations:
storeId + status + priorityRank

syncChanges:
storeId + sequence UNIQUE

processedCommands:
_id UNIQUE

deviceSessions:
userId + deviceId
```

---

# 149. SQLite foreign keys

Enable SQLite foreign keys.

Use them selectively where offline lifecycle is safe.

Avoid cascades that could destroy audit/source history.

---

# 150. SQLite cleanup policy

Cleanup job may remove:

- remote-verified local source binaries after retention;
- old raw source records outside local window;
- expired read-model cache.

Do not delete:

- pending Outbox data;
- unresolved conflicts;
- local-only sources;
- unsynchronized user-created entities.

---

# 151. Local retention configuration

Initial:

```text
raw observations: 90 days
active product master: complete
Need Units/substitutions: complete active set
commercial current/future: complete active set
read models: 365 days where size permits
recommendations: active + recent history
```

Exact limits tuned during pilot.

---

# 152. Historical data fetch

Endpoint:

```http
GET /api/v1/history/slice
```

Request query:

```text
from
to
products?
includeRaw?
```

Result is persisted locally.

---

# 153. History slice contract

```ts
type HistorySliceResponse = {
  period: {
    from: string;
    to: string;
  };

  salesObservations?: SalesObservationDto[];
  wasteObservations?: WasteObservationDto[];
  productDailyPerformance: ProductDailyPerformanceDto[];
};
```

---

# 154. Local query contract

Mobile screens should access repositories such as:

```ts
ProductRepository
SalesRepository
WasteRepository
CommercialRepository
RecommendationRepository
AnalyticsReadRepository
```

Screens do not execute raw SQL.

---

# 155. Repository observability

Local repository errors include:

- entity type;
- operation;
- local schema version.

Do not log confidential row payloads by default.

---

# 156. Data contracts package

All DTOs shared between mobile and API live in:

```text
packages/domain
packages/sync-contracts
```

There must be no hand-written duplicate DTOs in both apps.

---

# 157. Schema validation package

Zod schemas are the canonical network contract.

Generate TypeScript types from Zod inference.

Do not maintain separate manually synchronized interfaces.

---

# 158. Command schemas

Each command type has:

```text
Zod payload schema
server handler
authorization policy
conflict policy
idempotency test
```

---

# 159. Entity sync registry

Create a registry describing:

```ts
type SyncEntityDefinition = {
  entityType: string;

  replicated: boolean;

  conflictStrategy: string;

  localTable: string;

  remoteCollection: string;

  serialize: Function;
  deserialize: Function;
};
```

This prevents arbitrary per-feature sync implementations.

---

# 160. Replicated entity registry — initial

Replicated:

```text
STORE
PRODUCT
PRODUCT_IDENTIFIER
PRODUCT_ALIAS
NEED_UNIT
NEED_MEMBERSHIP
PRODUCT_SUBSTITUTION
SALES_OBSERVATION
WASTE_OBSERVATION
WASTE_RECEIPT
WASTE_LINE
COMMERCIAL_OPERATION
OFFER
MARKET_SIGNAL
EXECUTION_INSTRUCTION
STORE_EVENT
PRODUCT_DAILY_PERFORMANCE
DEPARTMENT_DAILY_PERFORMANCE
RECOMMENDATION
DECISION
ACTION_EXECUTION
```

---

# 161. Remote-only entities

Examples:

```text
processedCommands
syncChanges
deviceSessions
aiGenerationLogs
audit internals
heavy source processing artifacts
```

---

# 162. Local-only entities

Examples:

```text
sync_outbox
sync_conflicts
local_jobs
local_files metadata
temporary wizard state
```

---

# 163. Derived replicated entities

Read models can be remote-confirmed but locally recomputable.

Examples:

```text
PRODUCT_DAILY_PERFORMANCE
DEPARTMENT_DAILY_PERFORMANCE
ANALYTICAL_CANDIDATE
```

Their sync handling differs from user-authored entities.

---

# 164. Derived entity replacement policy

Remote-confirmed derived result may replace same-key local-derived result when:

```text
remote input revision >= local synchronized input revision
```

Preserve diagnostics if values differ unexpectedly.

---

# 165. Recommendation sync policy

Recommendations are remote-generated and replicated.

Decisions/actions are user-authored and syncable.

A recommendation may become stale; decision history remains.

---

# 166. Recommendation version relation

Recommendation updates should create new version/revision or increment entity version while keeping decision link semantics explicit.

Do not mutate historical facts after a decision without audit.

---

# 167. Action review delivery

Remote action review is replicated after KPI review is complete.

Local UI can still show pending review state.

---

# 168. Sync conflict event to user

Critical conflict creates a replicated/local notification item or sync dashboard alert.

Do not interrupt field work with modal unless the operation cannot safely continue.

---

# 169. Device time skew

Server may compare:

```text
client createdAt
server receivedAt
```

If skew exceeds configured threshold:

flag metadata.

Do not automatically rewrite user-declared event business time unless required.

---

# 170. Security — refresh token

Store only hash remotely.

Refresh rotation:

```text
old token invalid after successful rotation
```

Reuse of revoked old token should revoke device session according to security policy.

---

# 171. Security — access token claims

Minimum claims:

```text
sub: userId
sessionId
deviceId
exp
```

Store authorization remains server lookup/cache, not untrusted static store list in token if access can change.

---

# 172. Security — API rate limits

Per user/device:

```text
auth challenge
sync push
upload init
AI regenerate
```

Sync limits should tolerate normal offline backlog.

---

# 173. Security — command authorization

Every command handler checks:

- authenticated user;
- store membership;
- entity ownership/store;
- role permission;
- business transition validity.

---

# 174. Audit command metadata

For accepted remote mutation, audit may retain:

```text
commandId
deviceId
userId
storeId
entity
previous version
new version
timestamp
```

---

# 175. Privacy — source payloads

Do not include full source binary/text in sync change payloads.

Replicate normalized entities only.

Source documents are fetched explicitly when user opens source review.

---

# 176. Pagination

List/history APIs use cursor pagination, not offset pagination for large data.

Sync itself uses sequence cursor.

---

# 177. Compression

Bootstrap and large history responses should support HTTP compression.

Do not prematurely custom-compress JSON unless measurements require it.

---

# 178. Sync payload size

Set bounded page sizes.

If one entity is exceptionally large, normalize it or fetch detail separately.

Avoid giant embedded histories in Product records.

---

# 179. Product detail normalization

Identifiers, aliases, memberships and substitutions remain separate sync entities.

Do not embed unbounded arrays inside Product.

---

# 180. Commercial source references

Offer source references may be stored in a bounded JSON array because one offer normally references few pages.

If this grows, normalize later.

---

# 181. Data model rule — references over duplication

Prefer stable IDs across domains.

Example:

```text
recommendation.entityIds
```

references Products/Operations.

Do not copy full product snapshots into every entity unless immutable evidence snapshot is required.

---

# 182. Evidence snapshots

Recommendation facts may preserve display values used at generation time because the recommendation must remain auditable even if KPI later changes.

Store:

```text
fact ID
display value snapshot
source
quality
```

---

# 183. API contract testing

Every public endpoint has:

- Zod request schema;
- Zod response schema;
- authorization test;
- success fixture;
- failure fixture.

---

# 184. Sync golden tests

At minimum:

```text
create offline entity → push → pull another device
duplicate push
stale update conflict
delete tombstone
cursor page retry
cursor older than retention → rebootstrap
mixed successful/rejected batch
```

---

# 185. Two-device conflict tests

Scenarios:

```text
Product edit on A and B
Event closed on A, edited on B
Recommendation decision differs
Execution instruction DONE vs stale TODO
```

---

# 186. Local database recovery

If local SQLite is corrupted:

- preserve source files when possible;
- move DB aside;
- create clean DB;
- re-bootstrap;
- re-enqueue unsynchronized recoverable local files if metadata allows.

Recovery strategy must be tested before production.

---

# 187. Schema compatibility

Local migrations MUST preserve Outbox.

Never release a migration that drops pending commands without explicit transformation.

---

# 188. EAS update compatibility

An over-the-air application update may not require a local schema change incompatible with installed native runtime.

Database migration compatibility must be considered before publishing updates.

---

# 189. Backend deployment compatibility

Remote API deploy must remain compatible with supported app/sync protocol versions.

Use additive fields before removing old fields.

---

# 190. DTO evolution

Rules:

```text
new optional field → compatible
new required field without default → breaking
enum removal → breaking
enum addition → client must tolerate unknown or protocol bump
field semantic change → breaking
```

---

# 191. Unknown enum handling

Mobile should map unknown replicated enum values to safe fallback where allowed.

For business-critical unknown states:

```text
TO_REVIEW
```

rather than crash.

---

# 192. API documentation

Generate OpenAPI from Fastify/Zod routes if practical.

The shared TypeScript client remains the canonical app integration.

---

# 193. API-client generation

Prefer a manually thin typed client based on shared schemas rather than opaque generated code if it keeps sync-specific logic clearer.

Do not duplicate endpoint URLs throughout features.

---

# 194. `api-client` responsibilities

```text
auth
token refresh
sync
uploads
jobs
history slices
source review
remote-only operations
```

---

# 195. Remote query minimization

Because normal business state is replicated:

do not create per-screen remote APIs for every local entity.

Only add APIs for:

- sync;
- remote heavy actions;
- historical slices;
- source file review;
- job status;
- admin/repair.

---

# 196. Native screen contract

Normal screen:

```text
SQLite repository
```

Remote refresh:

```text
SyncService
```

Not:

```text
screen → REST query → render
```

---

# 197. Remote command contract

Normal local mutation:

```text
Local domain service
→ SQLite transaction
→ Outbox
```

Not:

```text
screen → remote command → wait → local update
```

---

# 198. Sync service interface

```ts
interface SyncService {
  bootstrap(storeId: string): Promise<void>;
  sync(storeId: string): Promise<SyncSummary>;
  push(storeId: string): Promise<PushSummary>;
  pull(storeId: string): Promise<PullSummary>;
  resolveConflict(input: ResolveConflictInput): Promise<void>;
}
```

---

# 199. Sync summary

```ts
type SyncSummary = {
  pushed: number;
  pulled: number;
  conflicts: number;
  failed: number;

  cursor?: string;

  startedAt: string;
  completedAt: string;
};
```

---

# 200. Source sync service

Separate file transfer from entity command sync.

```ts
interface SourceUploadService {
  queueSource(sourceDocumentId: string): Promise<void>;
  uploadPending(): Promise<void>;
}
```

---

# 201. App bootstrap service

```ts
interface AppBootstrapService {
  ensureLocalSchema(): Promise<void>;
  loadLocalSession(): Promise<void>;
  openLocalStore(): Promise<void>;
  bootstrapIfNeeded(): Promise<void>;
  syncIfPossible(): Promise<void>;
}
```

---

# 202. Repository boundary

Feature code does not directly touch Drizzle tables.

Use repositories.

This allows migration/testing and keeps domain semantics explicit.

---

# 203. Local transaction boundary

Domain service creates both entity and Outbox in one database transaction.

Example:

```text
StoreEventService.createOfflineEvent()
```

owns transaction.

---

# 204. Remote transaction boundary

Command handler owns remote transaction and change-log creation.

Repositories should not append syncChanges independently without command orchestration.

---

# 205. Sync entity serializer

Each replicated entity defines:

```text
toWire
fromWire
toLocal
toRemote
```

Decimal conversion happens centrally.

---

# 206. Normalized wire date rule

Date fields remain ISO strings over API.

Remote repository converts Date object where appropriate.

---

# 207. Read model wire contract

Read models include:

```text
origin
formulaVersion
inputRevision
computedAt
quality
```

Local UI can distinguish local vs remote-confirmed.

---

# 208. Data freshness contract

```ts
type DataFreshnessDto = {
  state:
    | "CURRENT"
    | "LOCAL_ONLY"
    | "PENDING_SYNC"
    | "REMOTE_CONFIRMATION_PENDING"
    | "STALE";

  latestBusinessDate?: string | null;
  lastSyncedAt?: string | null;
};
```

---

# 209. Today screen data contract

Local composite query returns:

```ts
type TodayLocalView = {
  summary?: DepartmentDailyPerformanceDto;

  topCandidates: AnalyticalCandidateDto[];

  recommendations: RecommendationDto[];

  activeEvents: StoreEventDto[];

  syncHealth: SyncHealthDto;

  freshness: DataFreshnessDto;
};
```

This is a local repository projection, not a required REST endpoint.

---

# 210. Week screen data contract

```ts
type WeekLocalView = {
  period: {
    start: string;
    end: string;
  };

  operations: CommercialOperationDto[];
  offers: OfferDto[];
  instructions: ExecutionInstructionDto[];
  marketSignals: MarketSignalDto[];
  recommendations: RecommendationDto[];

  syncHealth: SyncHealthDto;
};
```

---

# 211. Product screen local contract

```ts
type ProductLocalView = {
  product: ProductDto;

  identifiers: ProductIdentifierDto[];
  aliases: ProductAliasDto[];

  needMemberships: NeedMembershipDto[];
  substitutes: ProductSubstitutionDto[];

  performance: ProductDailyPerformanceDto[];

  waste: WasteObservationDto[];

  activeEvents: StoreEventDto[];

  recommendations: RecommendationDto[];
};
```

---

# 212. Sync health DTO

```ts
type SyncHealthDto = {
  state:
    | "SYNCED"
    | "OFFLINE"
    | "PENDING"
    | "SYNCING"
    | "CONFLICT"
    | "ERROR";

  pendingCommands: number;
  pendingFiles: number;
  conflicts: number;

  lastSuccessfulSyncAt?: string | null;
};
```

---

# 213. Conflict detail DTO

```ts
type SyncConflictDto = {
  id: string;

  entityType: string;
  entityId: string;

  conflictType: string;

  localSummary: unknown;
  remoteSummary: unknown;

  allowedResolutions: Array<
    "KEEP_LOCAL" | "KEEP_REMOTE" | "MERGE"
  >;

  createdAt: string;
};
```

---

# 214. Source processing status DTO

```ts
type SourceProcessingStatusDto = {
  sourceDocumentId: string;

  localStatus: string;
  uploadStatus: string;
  remoteStatus?: string | null;
  aiStatus?: string | null;

  jobId?: string | null;

  validationRequired: boolean;
};
```

---

# 215. Remote notification event types

```text
RECEIPT_EXTRACTION_READY
COMMERCIAL_EXTRACTION_READY
SYNC_CONFLICT
ACTION_REVIEW_READY
DEADLINE_REMINDER
```

Notification is not the state itself.

---

# 216. API security headers

Remote API should set appropriate transport/security headers.

Mobile client validates TLS through platform defaults.

Certificate pinning is not required for MVP unless security review mandates it.

---

# 217. Audit access

No general audit download is required in MVP UI.

Support/admin tools may query audit by entity.

---

# 218. Support diagnostic endpoint

Restricted endpoint may provide:

```text
entity versions
sync cursor status
pending remote jobs
source lineage IDs
```

Never expose credentials or raw sensitive source by default.

---

# 219. Test fixture contract

Golden JSON fixtures should use the same wire DTO format.

This allows testing:

```text
local deserializer
remote serializer
sync transport
```

---

# 220. Contract ownership

Each entity contract has one owner package.

Examples:

```text
ProductDto → packages/domain/products
SyncCommand → packages/sync-contracts
KpiResult → packages/domain/analytics
```

---

# 221. Database/API acceptance criteria

## DBAPI-AC-01 — Stable client ID

Create event offline, sync it.

Expected:

```text
same ID local and remote
```

---

## DBAPI-AC-02 — Atomic Outbox

Simulate crash after business insert but before Outbox.

Expected:

```text
transaction rolls back both
```

---

## DBAPI-AC-03 — Duplicate command

Push same command twice.

Expected:

```text
one remote mutation
second ALREADY_APPLIED
```

---

## DBAPI-AC-04 — Pull cursor retry

Fail local transaction while applying pull page.

Expected:

```text
cursor not advanced
same page safely reapplied
```

---

## DBAPI-AC-05 — Two-device propagation

Device A creates event.

Device B pulls.

Expected:

```text
same event/version appears on B
```

---

## DBAPI-AC-06 — Product version conflict

Two devices edit same product version.

Expected:

```text
one accepted
one CONFLICT
```

---

## DBAPI-AC-07 — Independent events coexist

Two devices create different stockout events.

Expected:

```text
both persist
```

unless duplicate detection later identifies a business duplicate.

---

## DBAPI-AC-08 — Decimal parity

`0.580` kg local → remote → other device.

Expected:

```text
precision preserved
```

---

## DBAPI-AC-09 — Leading zero identifier

EAN `0000000003017`.

Expected:

```text
exact string preserved across SQLite/API/Mongo
```

---

## DBAPI-AC-10 — Sales import offline

Local import creates local observations and KPIs.

Expected:

```text
works without connectivity
```

---

## DBAPI-AC-11 — Import remote parity

Remote verifier returns same normalized fingerprint.

Expected:

```text
MATCH
```

---

## DBAPI-AC-12 — Import mismatch

Remote parser differs materially.

Expected:

```text
IMPORT_VERIFICATION_CONFLICT
no silent replacement
```

---

## DBAPI-AC-13 — Waste does not alter sales

Synchronizing a waste receipt.

Expected:

```text
no sales observation mutation
```

---

## DBAPI-AC-14 — Bootstrap

Fresh authenticated device.

Expected:

```text
local store usable after bootstrap
cursor initialized
```

---

## DBAPI-AC-15 — Old cursor

Device returns after change-log retention.

Expected:

```text
SYNC_REBOOTSTRAP_REQUIRED
```

---

## DBAPI-AC-16 — Derived read model replacement

Local KPI exists, remote confirmed arrives with newer revision.

Expected:

```text
remote-confirmed read model becomes canonical display
```

---

## DBAPI-AC-17 — Recommendation decision offline

Accept recommendation offline, sync later.

Expected:

```text
decision synchronized exactly once
```

---

## DBAPI-AC-18 — Stale recommendation decision

Recommendation changed before offline decision sync.

Expected:

```text
explicit stale/conflict handling
```

---

## DBAPI-AC-19 — File upload retry

Upload completion response lost, client retries.

Expected:

```text
no duplicate source document
```

---

## DBAPI-AC-20 — Source authorization

User requests signed URL for another store's source.

Expected:

```text
403
```

---

## DBAPI-AC-21 — Deleted entity

Remote tombstone pulled while no local edit.

Expected:

```text
local tombstone applied
```

---

## DBAPI-AC-22 — Deleted entity with dirty local edit

Expected:

```text
conflict, not silent deletion
```

---

## DBAPI-AC-23 — Mixed push batch

One command valid, one conflict.

Expected:

```text
valid command applies
conflict returned independently
```

---

## DBAPI-AC-24 — Auth refresh rotation

Use refresh token, receive new one, reuse old one.

Expected:

```text
old token rejected according to security policy
```

---

## DBAPI-AC-25 — Store authorization

Authenticated user for Store A requests Store B.

Expected:

```text
403
```

---

# 222. Out-of-scope database/API concerns

Not required for this MVP contract:

- public developer API;
- third-party OAuth API;
- Mercalys direct connector;
- streaming socket sync;
- peer-to-peer device sync;
- CRDT framework;
- generic conflict-free collaboration engine;
- database-per-device cloud replication service;
- customer-level analytics API;
- external partner webhook ecosystem.

---

# 223. Implementation order

Recommended order:

```text
1. Shared DTO/Zod packages
2. SQLite schema + Drizzle migrations
3. Mongo collections/indexes/validators
4. Auth/session contracts
5. Bootstrap endpoint
6. Outbox command engine
7. Push endpoint
8. Change-log writer
9. Pull endpoint
10. Conflict storage/resolution
11. File upload contracts
12. Local Mercalys import synchronization
13. Derived read-model synchronization
14. Recommendations/decisions/actions
15. Historical slice/source-review APIs
```

---

# 224. Final database invariant

The implementation must preserve:

```text
stable domain IDs
+
explicit entity versions
+
decimal-safe serialization
+
local Outbox transaction
+
idempotent remote commands
+
monotonic remote change feed
+
incremental pull
+
domain-specific conflicts
```

---

# 225. Final client/server invariant

Normal native screen behavior:

```text
read SQLite
write SQLite
queue Outbox
sync asynchronously
```

Remote infrastructure provides:

```text
durability
cross-device coordination
remote processing
AI
global verification
```

The app must not become remote-request-first after implementation.

---

# 226. Final contract invariant

The architecture must always distinguish:

```text
local unsynchronized entity
vs
remote synchronized entity
```

```text
user-authored data
vs
remote-derived data
```

```text
source document
vs
normalized observation
```

```text
raw observation
vs
derived KPI
```

```text
recommendation
vs
decision
vs
execution
```

```text
retry
vs
duplicate
```

```text
version conflict
vs
ordinary update
```

If those distinctions are lost, the offline-first contract is broken.

---

# 227. Next specification

After this document, create:

```text
UX_FLOWS_AND_SCREEN_SPEC.md
```

It must use:

- native Expo navigation;
- SQLite-backed screens;
- offline states;
- pending-sync states;
- conflict states;
- local/remote data freshness;
- queued AI processing;
- camera/file workflows;
- native notifications.

After UX:

```text
IMPLEMENTATION_PLAN.md
```

will sequence the actual development agent work.
