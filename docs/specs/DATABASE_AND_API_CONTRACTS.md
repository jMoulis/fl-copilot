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


# M4-T11 — Published receipt synchronization contract

`WASTE_RECEIPT_PUBLISH` targets a `waste_receipt_publication` aggregate with the stable receipt UUID. Its shared Zod payload contains the confirmed receipt, source metadata without a device URI, all retained lines (including explicit exclusions) and validated waste observations. One publication is immutable. A different payload for an already published receipt yields `WASTE_RECEIPT_ALREADY_PUBLISHED`; an identical payload or command retry never inserts observations twice.

SQLite uses the existing `waste_receipts`, `waste_lines`, `source_documents`, `source_records`, `waste_observations`, `local_jobs` and `sync_outbox` tables. Each published observation UUID equals its source line UUID, preserving occurrence identity across devices. The local transaction commits publication and Outbox together; the same IDs are retained remotely.

MongoDB collections are `wasteReceiptPublications` (aggregate serializer and synchronization version), `wasteReceipts`, `wasteLines`, `sourceRecords` and `wasteObservations`. Migration 11 initializes the aggregate's unique store/source index and receipt/line lookup indexes. Observation money and quantities use Decimal128; unknown purchase costs remain null. MongoDB's processed-command transaction stores the aggregate, entities and incremental change atomically.

Incremental pull exposes a `waste_receipt_publication` UPSERT envelope. Bootstrap adds the optional `entities.wasteReceiptPublications` array for published receipts. Mobile validates aggregate ownership and lineage before inserting foreign-key dependencies, acknowledging local publication or recovering published data on another device. Source images are retained on the originating device and in private Blob storage; bootstrap does not download an image or fabricate a local file path.

All participating devices need the M4-T11 client to understand the new entity type. Native acceptance must use the current build before publishing receipts.


## Receipt publication quality qualification

A validated `WASTE_RECEIPT` observation may carry `productNature = UNKNOWN` and `quantity = null` when its explicitly matched, non-deleted product reference is incomplete. Validated `salesValue` remains the recorded ticket amount; missing cost remains null with `UNAVAILABLE` quality. Original measures and units remain retained in the receipt aggregate.

The publication gate protects date, identity, source ownership/confirmation, duplicate handling, provided positive measures and arithmetic consistency. Product status, nature and unit completeness generate independent reference-quality warnings. The shared quantity resolver returns a value only for a known compatible unit; the API verifies that the observation quantity equals this interpretation, including null, and never fabricates a quantity from missing metadata.

The shared publication serializer permits unknown classification while preserving identity, lineage and amount checks. Native code and API must be deployed together for this qualification policy; older pilot clients cannot consume newly qualified aggregates until updated. Existing nullable SQLite/MongoDB observation fields require no migration.


## Receipt cashier metadata

Receipt fields are optional `detectedCashierNumber`, `confirmedCashierNumber` (nullable strings up to 64 characters) and `cashierNumberConfirmedAt` (nullable ISO timestamp). SQLite migration 15 persists `detected_cashier_number`, `confirmed_cashier_number` and `cashier_number_confirmed_at` as TEXT. A confirmation timestamp distinguishes an explicit empty human value from an unconfirmed AI proposal.

Vision schema `waste-receipt.vision.v2` requires nullable `cashierNumber`, `cashierNumberConfidence` and `cashierNumberRegion` evidence. The review draft adds optional `detectedCashierNumber`, allowing legacy extraction output to remain readable. The cashier identifier is never converted to a number or used as a KPI input.

Before publication, confirmation remains local review state. The immutable publication aggregate carries the receipt metadata with its existing Outbox command, transaction and incremental sync policy. The published receipt stores it in MongoDB, and the aggregate serializer preserves text and ISO confirmation timestamps for pull/bootstrap. Published metadata is read-only in this increment; no automatic re-extraction or metadata backfill is performed.

## Commercial PDF processing registration — M5-T02

A locally captured `WEEKLY_COMMERCIAL_PDF` uses existing `source_documents`, `local_files` and `local_jobs` contracts. The upload job ID is the stable source UUID and its payload is `{ storeId, sourceDocumentId, localFileId }`. Source/file creation and job insertion commit together. Previously captured sources without a job are registered transactionally during the normal upload cycle. No general Outbox command or business operation is emitted.

Once source upload is confirmed, `commercialDocumentJobs` holds a durable processing intent:

```ts
{
  _id: string; // sourceDocumentId, stable UUID
  storeId: string;
  sourceDocumentId: string;
  checksum: string;
  objectKey: string;
  pipelineVersion: "commercial-pdf.v1";
  status: "PENDING";
  stage: "TEXT_EXTRACTION";
  attemptCount: number;
  createdAt: Date;
  updatedAt: Date;
}
```

MongoDB migration 12 enforces unique `(storeId, sourceDocumentId, pipelineVersion)` and indexes pending-stage lookup by status/time. Source UUID also remains globally unique through `_id`. Insert-only registration preserves progress if completion is retried. A response lost after upload confirmation can retry registration without a second binary transfer. The existing `CompleteSourceUploadResponse.jobId` identifies this intent; it is not an extraction result. Inngest execution and page processing follow in the next increments, without introducing a replacement polling worker.

Local source upload becomes `CONFIRMED`, processing remains `UPLOADED`, and the local upload job completes. The original file stays `RETAINED`. Missing originals and metadata/processing-identity mismatches keep a visible local error. Manual retry only resets eligible pending/retry jobs; it does not replace invalid files, reset confirmed transfers or silently restart extraction. PDF source history is not yet part of bootstrap restoration.

## Commercial PDF page evidence — M5-T03

Inngest executes the registered intent behind signed `/api/inngest` callbacks. Upload-completion event data contains only `{ storeId, sourceDocumentId }`; no source text or bytes are sent to the orchestrator. A five-minute recovery function invokes extraction for at most five pending/expired sources per pass. Source checksum and store ownership are rechecked before reading.

Job claim uses `status`, `stage`, `leaseToken`, `leaseExpiresAt`, `nextAttemptAt` and incremented `attemptCount`. Eligible jobs are `PENDING/TEXT_EXTRACTION` with elapsed backoff or `PROCESSING/TEXT_EXTRACTION` with expired lease. Completion/failure updates require the claimant's token. Success is `TEXT_READY/AI_EXTRACTION`, with `parserVersion`, `pageCount` and `textPageCount`; it does not mean commercial validation or publication. Expected source errors are `FAILED` with sanitized codes; transient errors retain `PENDING` and backoff.

`commercialDocumentPages` stores the shared `CommercialPdfPage` contract plus stable `_id`, `storeId`, `sourceDocumentId`, registered checksum, parser version and creation timestamp. Mongo migration 13 enforces unique `(storeId, sourceDocumentId, parserVersion, pageNumber)`. Writes are insert-only, so partially persisted pages retain identity/content on retries. Raw page text and PDF-space span transforms remain separate from future normalized commercial records. Empty-text pages are preserved with `NO_EXTRACTABLE_TEXT`.

Page extraction does not change source dates, source binaries, Mercalys observations, receipt waste, offer/applicability/execution states or official analytics. Current limits and parser behavior are documented in `docs/progress/M5_COMMERCIAL_PLANNING.md`. Inngest callback execution and page readiness are not yet exposed as a mobile source-review UI.

## Commercial AI page proposals — M5-T04

`commercial-draft.v1` is a strict shared output schema for source content blocks and named literal fields with confidence and page/span/quote evidence. Model values are proposals. Deterministic anchoring verifies supplied source-page/span membership and quote/value containment; unsupported blocks are omitted and unsupported/conflicting fields become null. All retained fields/blocks are `TO_VALIDATE`, including high-confidence ones. The raw response remains separate for audit.

`commercialDocumentAiPages` records stable UUID, store/source identity, checksum, page number, parser/schema/model versions, claim status/token/expiry/attempt count, raw output, anchored draft, response/resolved model, token usage, context-page numbers and timestamps. Migration 14 uniquely indexes `(storeId, sourceDocumentId, parserVersion, schemaVersion, model, pageNumber)`. Claims allow pending or expired processing rows. Complete cache entries are reused; permanently failed pages are not retried blindly, and provider attempts are bounded to four.

The source job freezes `aiModel` and `aiSchemaVersion` when the validated page manifest is first prepared. Finalization counts cached pages/issues and becomes `TO_VALIDATE/DRAFT_REVIEW` only when every source page has a completed proposal. Incomplete work remains recoverable with backoff; permanent failures become `AI_FAILED`. No canonical operation/offer/task, validation decision, applicability or official observation is created. Mechanism normalization, de-duplication/conflict, mobile cache/review and publication remain subsequent work.

The signed Inngest document/page functions operate on identity/page-number metadata only. PDF text is read inside the worker, sent to the authorized AI Gateway model, and persisted privately; it is not returned in event or durable-step payloads. The existing request-context OIDC token is preferred over a cold-start fallback. Source text is untrusted, no tools are exposed, and OpenAI storage is disabled for these calls.

### Commercial AI runtime budget version 2

The model deadline is 90 seconds, the Vercel callback budget 120 seconds, and the claim lease 180 seconds. `runtimeBudgetVersion` and `budgetAttemptCount` bound provider attempts to four per execution-budget version; `attemptCount` remains the lifetime claim counter. A legacy unfinished temporary/attempt-limit failure with no draft may receive one new window. Complete drafts, schema/configuration failures and current-budget exhausted pages are not reset. `RETRY` rows require the new worker; the earlier worker's pending-only claim cannot consume them. Source reopening remains scoped to the frozen model/schema/parser and is refused while any matching permanent failed page remains. Failure diagnostics retain category/elapsed time only.

### Commercial AI output capacity and explicit retry — runtime budget version 3

A truncated structured response is identified from the SDK's `finishReason=length` and reported as `COMMERCIAL_AI_OUTPUT_TOKEN_LIMIT`; malformed schema output remains `COMMERCIAL_AI_OUTPUT_INVALID`. No partial JSON is parsed as accepted proposals. Bounded capacity is 12,000 output tokens, 180 seconds per model call, 240 seconds per callback and a 300-second claim lease.

Explicit confirmed-truncation maintenance may transactionally requeue one failed older-budget page with no draft, within its store/source/frozen model/parser/schema/checksum identity. It retains the UUID/lifetime attempts, records the previous error and retry reason, and opens one current-budget retry window. Completed or current-budget cache entries and completed source jobs are refused. Automatic permanent-schema recovery is unchanged. A successful retry still passes full schema and source anchoring and produces only `TO_VALIDATE` proposals.

## Implemented incremental extension — Store offer choices (M5-T07-E)

`CommercialOfferChoice` is a human retention decision for planning, distinct from the canonical `Offer`/`CommercialOperation` and from execution. The shared strict Zod contract lives in `packages/domain/src/commercial-offer-choice.ts` and is re-exported by sync-contracts. It retains a stable UUIDv8, store, immutable visual source/document/checksum/operation/item reference, source labels, confirmed Product UUID, exact sales dates, typed customer mechanism, explicit applicability/critical-field confirmations, RETAINED/WITHDRAWN status, note and revision/timestamps.

SQLite 18 stores its operational projection in `commercial_offer_choices`, alongside local audit actions in `commercial_choice_history`. Mongo 17 persists `commercialOfferChoices` and versioned `commercialChoiceHistory`; source-identity and active duplicate indexes enforce uniqueness. No original, pending action or previous choice is deleted when a choice is withdrawn or explicitly superseded.

The ordinary Outbox uses `COMMERCIAL_OFFER_CHOICE_UPSERT`, entity type `commercial_offer_choice`, stable command UUID and expected remote revision. Immutable source identity and creation time are preserved on revision. An authorized explicit conflict resolution may adopt the synchronized creation metadata while retaining the local draft/action in history. Active-product identity is checked for retention; a source/product unit difference remains explicit without forcing Product Master completion or guessing a conversion; withdrawal preserves its historic product reference without requiring the product to remain active.

Bootstrap/pull expose `commercialOfferChoices` only when `commercialChoices=true`. Older cursors advance past excluded choice changes; a capable native upgrade performs one adoption bootstrap. Each pull envelope's entity identity/version must match its DTO. Newer pending local choices survive old acknowledgements and remote snapshots. Conflicts require explicit comparison/rebase/adoption; failed/superseded queued commands remain auditable. Source-choice retention never writes canonical offers/operations, execution, sales/waste observations or KPI values.

## Implemented incremental extension — Weekly preparation (M5-T09-A)

`CommercialWeekPreparation` is a strict DRAFT-only planning DTO: stable store/week UUIDv8, Monday–Sunday bounds, declared nullable TG capacity, retained-offer UUID/revision references, named placement UUIDs/themes/offer assignments, optional immutable source-TG references, note and revision/timestamps. SQLite 19 stores the current projection and local audit; Mongo 18 stores `commercialWeekPreparations` and versioned `commercialPreparationHistory`.

The standard Outbox uses `COMMERCIAL_WEEK_PREPARATION_UPSERT` / `commercial_week_preparation` with expected revision, immutable period/identity and idempotent processing. Referenced choices must be retained in the store, at the exact saved revision and overlapping the week. Unsynchronized dependencies wait retryably; changed/withdrawn/outside-week references require review. Source inspirations are tenant/checksum/index-scoped. Bootstrap/pull only expose `commercialWeekPreparations` for `commercialPreparation=true`; native adoption restores previously skipped changes. Domain-specific conflict comparison/rebase/adoption preserves both versions. Draft preparation never asserts VALIDATED/EXECUTED status or publishes canonical offers, execution or KPI changes.

## Implemented incremental extension — PDF reference preference (M5-T08-B)

`CommercialVersionDecision` records a store-scoped pair of distinct PDF originals and immutable complete visual-reading UUID/checksum snapshots. A stable SHA-256-derived UUIDv8 identifies the unordered document pair; the old/new orientation remains immutable. `KEEP_PREVIOUS` / `PREFER_NEW` chooses a source reference for this comparison only, with explicit comparison-reviewed confirmation, optional note, revision and timestamps. It neither validates ambiguous offer identity nor activates a global source version or changes offers/TG drafts.

SQLite 20 persists the current decision and audit. Mongo 19 persists `commercialVersionDecisions` and versioned history. `COMMERCIAL_VERSION_DECISION_UPSERT` / `commercial_version_decision` uses transactional Outbox/processed commands, CAS revisions, complete tenant-scoped source checks and idempotent replay. Bootstrap/pull require `commercialVersions=true`; a native adoption bootstrap restores changes skipped by older clients. Newer pending decisions survive stale acknowledgement/pull. Domain-specific local-rebase/remote-adoption conflict resolution preserves previous payloads and superseded queued commands.

## Implemented incremental extension — Selected commercial offer validation (M5-T07-F)

`CommercialValidatedOffer` records an immutable retained-choice snapshot, status `VALIDATED`, source fields/evidence, explicit source-reviewed confirmation, version 1 and validation time. The entity UUIDv8 derives from store/choice UUID/choice revision. Source IDs/checksum/page/index and normalized customer terms remain traceable; raw supplier/deadline fields are not automatically promoted to purchase terms or executions.

SQLite 21 stores `commercial_validated_offers` and local validation audit. Mongo 20 stores `commercialValidatedOffers`, unique per store/choice/revision. The ordinary `COMMERCIAL_OFFER_VALIDATE` Outbox command captures the exact choice revision and immutable source proof. The server validates store/product/source ownership and waits retryably for earlier choice dependencies. Replay/equivalent confirmations converge to one business snapshot without overwriting the first accepted timestamp; mismatched content is rejected rather than using last-write-wins. A later choice revision/withdrawal invalidates **current use** of earlier validation but retains its history. Current validation is determined by exact equality with the retained current choice, not by the presence of an older record.

Bootstrap/pull require `commercialValidation=true`; capable upgrades adopt a fresh snapshot once. Applying validation snapshots cannot mutate choice/preparation/source/KPI rows. The validation itself does not finalize the weekly plan, group canonical operations or record execution. Shared readiness diagnostics remain distinct from a persisted validated plan.

## Implemented incremental extension — Validated weekly plan (M5-T09-B / T10-B)

`CommercialWeekPlan` is a strict VALIDATED store/week aggregate. It preserves the exact DRAFT preparation snapshot, current immutable commercial-offer-validation references, relevant PDF preference versions, active product label/revision references, canonical operation/offer snapshots and explicit grouping/final-validation confirmations. Actual execution dates are null. Source-announced and chosen planned dates remain distinct; raw supplier conditions are not promoted to invented purchase costs.

Stable SHA-256-derived UUIDv8 IDs identify the store/week plan, each plan revision and plan-scoped canonical children. Canonical grouping is proposed only within one source document/kind/exact normalized operation label/chosen period and is human-confirmed. Product/category/nature/unit completion is not required; active identity and exact captured product revision are rechecked. Shared source/offer/TG/ref readiness and exact deterministic child reproduction guard publication.

SQLite 22 persists current plans, local action audit, immutable confirmed revisions and derived `commercial_operations` / `offers` projections. Mongo 21 persists `commercialWeekPlans`, `commercialPlanRevisions`, `commercialOperations` and `offers` with tenant/plan indexes. `COMMERCIAL_WEEK_PLAN_UPSERT` / `commercial_week_plan` uses CAS, atomic processed commands and ordered local Outbox revisions; missing earlier dependencies wait retryably. Publication atomically replaces only that plan's derived children and inserts an immutable `commercial_week_plan_revision` envelope. Only the aggregate is user-mutated; child projections are not independently writable. Future execution remains a separate source/event model.

Capability `commercialPlans=true` gates both envelope types and current/revision bootstrap arrays; capable upgrades adopt once. Current plans and full confirmed history restore across devices. Old ACK/pull cannot roll back newer pending plans or their children. Conflict resolution explicitly compares actual product/price/date/TG selections, preserves local audit and either revalidates a local rebase against current dependencies or adopts the synchronized plan. A changed source/product/draft marks a saved plan for review without mutating its previous confirmation or recording execution. Historical versions remain inspectable.

## Implemented incremental extension — Commercial execution task declarations (M5-T11-A)

CommercialExecutionTask is a versioned field declaration for PRINT_SIGNAGE / INSTALL_TG, keyed by store, immutable plan revision/checksum and canonical target. It retains label, TODO/DONE/SKIPPED/NOT_APPLICABLE status, note, nullable completion declaration time and audit timestamps. A skipped/nonapplicable declaration requires a reason. DONE describes only the bounded task; it does not mutate the plan's null actual-operation dates or assert an actual cashier price.

SQLite 23 stores commercial_execution_tasks and commercial_execution_history. Mongo 22 stores commercialExecutionTasks and commercialExecutionHistory with unique tenant/plan-copy/target and task/revision indexes. COMMERCIAL_EXECUTION_TASK_UPSERT uses atomic Outbox/processed commands, exact plan-copy/target checks, CAS revisions and idempotent replay. Missing earlier confirmed plan revisions wait retryably; mismatched copies are refused without deleting local actual-work capture. Field capture may reference a known local validated/audited plan snapshot even if the plan awaits sync; remote acceptance still requires that exact confirmed copy.

Bootstrap/pull require commercialExecution=true, with one native adoption bootstrap. Older clients safely skip these changes. Ordered same-task commands, old-ACK protection and explicit conflict rebase/adoption preserve corrections and prior actions. The next plan revision starts independent task proposals; historical declarations are not copied automatically. Source/plan/canonical offer/product/observation/KPI data remain unchanged.

## Implemented incremental extension — Store context settings (M5-T12-A)

StoreContextSettings is a singleton per store (id = storeId), with commune, five-digit French postcode, country FR, Europe/Paris timezone, nullable A/B/C school zone, CITY/POINT location mode and nullable fixed device point/timestamp. POINT requires coordinates; CITY stores no device point. Only an explicit foreground action captures location; settings do not imply consent to background tracking or moving-store location.

SQLite 24 stores store_context_settings and local action history. Mongo 23 stores storeContextSettings / storeContextHistory with tenant/revision indexes. STORE_CONTEXT_SETTINGS_UPSERT uses atomic Outbox/processed commands, expected revisions and domain conflict comparison/rebase/adoption. Bootstrap/pull require storeContext=true; a capable upgrade adopts once. Older acknowledgements cannot overwrite newer pending edits. These settings are separate from plan/price/execution/KPI data. Remote cached context-provider entities and reminder preferences remain subsequent contracts.

## Implemented incremental extension — Derived weekly context (M5-T12-B)

`GET /api/v1/store/context?weekStart=YYYY-MM-DD` requires a Bearer session and authorized UUID `x-store-id`; the date must be a valid Monday. It reads the current synchronized `StoreContextSettings`; missing settings return `STORE_SETTINGS_NOT_SYNCED` (409). No caller-supplied coordinate, provider URL or school query is accepted. The strict `WeeklyContext` response binds store, exact settings fingerprint and Monday/Sunday week, with independent weather/public/school provider statuses, source links, retrieval/expiry and issues. Weather additionally has provider issue time and dated FORECAST-only records, sampled temperature extrema, complete-day rain totals or null and actual Paris day-hour coverage. School periods retain departure and exclusive return dates/population.

Mongo 24 `contextProviderCache` has a unique URL index, validated raw provider data, original retrieval/expiry/Last-Modified and bounded refresh lease. This shared cache contains public provider responses, never user tokens. SQLite 25 `weekly_context_cache` uses composite `(store_id, week_start, settings_fingerprint)` identity and strict payload validation. It caches derived downloaded provider context, without Outbox, conflict actions or an incremental-sync capability. User store settings continue using the established bidirectional sync and conflict protocol. Context download cannot change settings or commercial/operational entities. Expired snapshots remain readable; failed individual providers preserve last local context as stale, and configuration/tenant mismatches are rejected before local adoption.

## Implemented incremental extension — Device-local commercial reminders (M5-T13-A)

SQLite 26 adds `device_reminder_preferences` (store-local opt-in), `device_commercial_reminders` (UUID intent, unique store/operation, validated payload, scheduling state/native identifier) and `device_reminder_history` (immutable local user-action snapshot). A `CommercialReminder` pins store, operation, plan/revision UUIDs, canonical plan checksum, known planned start date and explicitly selected absolute reminder time, plus revision/audit timestamps. Enabled capture rechecks the current synchronized plan in the same local transaction as intent/history. Disabled historic intents remain cancellable after plan changes. Stale OS status writes cannot overwrite a newer intent revision.

These records configure an individual device's OS delivery, not a shared store business action. There is intentionally no Mongo collection, Outbox command or synchronization capability. Notification payloads contain only a typed reminder/store/operation/week/revision identity and scheduling fingerprint; navigation must recheck session/store ownership and local intent, then open a fixed operation route. They never carry an arbitrary URL or financial/source document content. Native scheduling/cancellation is an asynchronous, retryable projection of the local intent; it cannot share a transaction with SQLite. Stable request IDs, native-queue reconciliation and revision guards provide duplicate/crash recovery. No reminder is a declaration that an operation was executed.


## Implemented incremental extension — Customer-need catalogue (M6-T01)

`NeedUnit` keeps UUID identity/store scope, an uppercase internal code, editable French name/description, ACTIVE/TO_REVIEW/INACTIVE status, immutable creation origin (USER/AI/SYSTEM), revision and ISO timestamps. Mobile creation is USER-only; future AI/system proposals require their own authoritative producer. A unit is a customer purchase intention, not order quantity or category. Deactivation is an audited status change, preserving identity/history and reserving its confirmed code. Confirmed codes and origins are immutable.

SQLite 27 stores `need_units` (indexed code and validated JSON/current/remote revisions/dirty state) and `need_unit_history` (immutable local action snapshots). User mutation/history/NEED_UNIT_UPSERT Outbox commit atomically. A partial unique store/code index covers confirmed rows: a rejected unconfirmed duplicate can coexist with the restored confirmed catalogue until explicitly corrected. Local creation still checks every current code to prevent accidental local duplicates. Code correction is allowed only for a never-confirmed rejected creation; its UUID/history survive the revision rebase.

Mongo 25 creates `needUnits` with unique store/code including inactive units and `needUnitHistory` with unique store/unit/revision. Server ownership, UUID/revision/origin/code guards precede a transactional mutation/history/change. Retried commands return the processed result; stale edits produce an explicit same-entity conflict. Independent product memberships/graph relations are not created here.

Capability `needUnits=true` gates pull envelopes of entityType `need_unit` and the optional bootstrap `needUnitCatalogue` extension. The legacy required `needUnits` placeholder remains empty to protect installed older clients. A native adoption marker is written only when the explicit catalogue extension is present, ensuring one restoration bootstrap after previously skipped changes. Current inactive records remain replicated. Older ACK/pull never overwrites a newer pending edit; rejected local actions remain correctable. Conflict adoption/rebase retains history and retires superseded commands without counting them as active errors.

## Implemented incremental extension — Product/need memberships (M6-T02)

Strict `NeedMembership` contracts represent the natural store/product/need relation, independent finite strength/confidence in [0,1], primary flag, source, PROPOSED/VALIDATED/REJECTED status, humanConfirmed and revision/timestamps. `needMembershipId` derives UUIDv8 from a versioned tuple identity and injected SHA-256 digest. Validated/rejected records require explicit human confirmation. Numbers are declared classifications, not observed substitution evidence or official KPI values.

SQLite 28 `need_memberships` has unique store/product/need and current/remote payload/version/dirty state; `need_membership_history` retains each local action. Atomic selected-batch capture uses the established per-entity Outbox commands NEED_MEMBERSHIP_UPSERT. Mongo 26 `needMemberships` and `needMembershipHistory` enforce pair and revision uniqueness. The mutation validates canonical UUID, tenant/product/need identity, parent eligibility, immutable original references/source and explicit decision gates. Parent registration dependencies are retryable without permanently recording a rejection. Equivalent simultaneous first creations share one canonical pair/change/history; different values conflict. No physical relation deletion is used.

Capability needMemberships=true includes need_membership pull envelopes and optional bootstrap productNeedMemberships. Existing legacy required needMemberships remains empty. The extension alone writes the one-time native adoption marker. Local pending edits survive old ACK/pull; explicit conflict adoption/rebase preserves history and supersedes queued obsolete decisions. Rejected records remain replicated so later proposals cannot silently revive them.

The shared batch request includes only target IDs and explicit classification values. Trusted actor/human authority, authoritative parent/existing snapshots and expected version bases are supplied by the application executor. They must never be taken from an LLM-generated request. The current native entry point confirms selected batches; future M7 adapters reuse preparation/proposal/confirmation/rejection rules rather than bypassing entity guards. No AI provider is invoked or agent tool registered by this increment.

## Private Copilot conversation foundation — M7-T17

`copilot_conversation` / Mongo `copilotConversations` store stable id, storeId, ownerId, title, ACTIVE/ARCHIVED, version and UTC timestamps. `COPILOT_CONVERSATION_UPSERT` uses exact expected-version conflict rules and immutable identity; Mongo/local conversation history retains decisions. `copilot_message` / `copilotMessages` store version-one immutable text, USER/ASSISTANT/TOOL role, opaque attachment source IDs/filename/media type and optional reply/supersedes links. `COPILOT_MESSAGE_APPEND` accepts only authenticated-owner USER input; canonical assistant/tool records are server-origin only. A superseding user message preserves its original. Source reference metadata does not authorize file access.

Optional `copilotHistory=true` bootstrap/pull capability returns only the authenticated user's store-scoped records. Private processed-command identities include ownerId so cached outcomes cannot cross users. Bootstrap returns a partial recent window (up to 100 recent conversations plus related parents, 50 recent messages), owner metadata and an explicit partial flag. `/api/v1/copilot/history` is an authenticated store-scoped GET with optional conversationId, paired beforeCreatedAt/beforeId and limit up to 50; it returns owner-bound conversation/message pages. Incremental sync continues correctly across its 2 MiB response budget; old clients see no new private envelope.

SQLite migration 34 adds conversations/messages/history and device-local drafts. Mongo migration 31 adds private collections and scoped indexes. Draft persistence is not a shared-store fact and has no Outbox command. Real file bytes, model generation, collective knowledge and compaction use later dedicated services; no raw private conversation is silently shared with another user.

## M7-T18 — Local tool invocation and read-result identity

`product.inspect` schema version 1 accepts only `{productId}`; its strict invocation envelope adds a stable `operationId`, tool name and schema version. Store/owner/conversation and current read permission are trusted application context, not model arguments. Its typed result contains the canonical editor snapshot (product, identifiers, aliases and local sync states), French outcome, observation timestamp and stable operation identity. An unavailable/foreign product has the same null snapshot outcome. It does not authorize publication, mutation or remote file access.

SQLite migration 35 `copilot_tool_results` stores private device-local request/result snapshots. The runtime checks current permission and conversation ownership before cached replay; changed input with the same operation identity fails. Reads and snapshot insertion use an exclusive transaction; cancelled/failed work does not persist success. Same-ID retries return the original observed snapshot, while new IDs refresh the underlying records. No business Outbox command or remote collection is added. Later write adapters must commit operation identity alongside their canonical local mutations/Outbox; the read journal must not be reused as a non-atomic mutation wrapper. Coverage/remaining tool adapters are inventoried in `COPILOT_TOOL_COVERAGE.md`.

## M7-T19a — Internal contextual read schemas

The version-one tool envelope adds `analytics.daily` (`businessDate`), `waste.inspect` (`receiptId`) and `commercial.offers` (`start`, `end`, optional `afterId`, bounded/default `limit`). Dates must be real ISO calendar dates; offer periods are ordered and bounded to 366 inclusive days. Actor/store/SQL/URLs remain outside model input. Typed discriminated results reuse SQLite 35 operation snapshots and current authority-before-replay, with original observation timestamps.

Daily output is a projection of the existing Today service/shared calculations, with preserved decimal strings/nulls, J−7 source lineage/warnings and data quality; unavailable requested dates return null, not another date. Receipt output contains canonical receipt/lines with opaque IDs and no local source URLs. Commercial output carries retained period-overlapping choices and only still-current immutable validation, with source original/reading references, local sync state and explicit page continuation. Original URL retrieval, flexible analytical periods, web research and model/native wiring are later adapters; these read contracts grant no mutation or publication authority.

## M7-T19b — Store context read envelopes

`store.events` version 1 accepts an explicit normalized instant interval (strict start before end, up to 366 days), optional product ID/UUID cursor and limit up to 25. Its canonical event payloads retain source, closure/review and sync status. Overlap uses half-open intervals and never turns an event into a stock quantity or proven cause.

`substitution.lookup` accepts product/optional need, optional nonfuture evaluation instant and bounded candidate offset/limit. It delegates to the existing directed lookup snapshot and shared engine. Results include rule/evaluation versions, candidates and relationship provenance/declared-versus-learned basis, UNKNOWN availability, exclusion reasons/counts and an explicit partial-exclusion flag. It neither writes scores nor reactivates refused relationships.

`store.week` accepts a real Monday week start and reads only current store-settings fingerprint cache. The output includes nonsecret locality/sync metadata, provider dates/source links and explicit missing/stale context. Expiry projection changes only the returned operation snapshot. Existing SQLite 35 authority-before-replay/idempotent reads cover all three tools; no new migration, remote writer or provider request is introduced.

## M7-T19c — Source references versus public research

`source.reference` version 1 accepts only a UUID. Its owned local projection returns type, filename, period, processing/upload/sync status and, for a commercial PDF, an opaque original-opening action. Local filesystem paths, Blob object keys and temporary signed URLs never enter the conversation result journal. Opening is a trusted native renderer action through the existing local-first original button/authenticated original-link service, which revalidates access and issues a fresh expiring link. Metadata does not prove bytes are currently available. Other source kinds do not inherit PDF opening authority.

`PublicWebResearchRequest` is separate from private/local tool execution: strict UUID request identity, bounded screened public query and retail purpose only. `PublicWebResearchResult` is EXTERNAL_RESEARCH with raw French text, validated citation spans/HTTPS public links, unknown publication dates, access time and sanitized provider usage/model. No canonical figures or source URLs are implicitly forwarded. Known secret/URI screening is defense in depth; provider pages and user text never grant authority. The dormant bounded Responses adapter requires the existing key plus explicit generation model; no new environment value/paid route is activated. Owner/store authorization, durable paid-request/result idempotency, offline orchestration and native citation rendering must be added before model/UI exposure. Structural citations are not factual/causal certification.

## M7-T20a — Product classification write contract

`product.classify` version 1 uses a separate WRITE registry/runtime, with a strict input of 1–25 unique product IDs, exact current local versions and nonempty category/nature/salesUnit patches; an optional overwrite flag defaults false. App-generated operation/device/command identity and trusted authority are distinct from model arguments. Authority binds current store/user manage access, an ACTIVE private conversation, an immutable USER message ID and the exact normalized request JSON. A reviewed level is required for requested replacements of populated fields; a model-provided flag cannot grant it.

SQLite 35's operation journal also stores typed private before/after product snapshots, canonical Outbox command IDs, applied time, USER message and optional local recomputation-job ID. Its insertion is inside the same exclusive transaction as existing validated ProductMasterRepository writes/Outbox and analytical job scheduling. Exact replays first recheck authority and return the original result; mismatched request/message/scope fails. No-op patches keep versions and add no command. Cancellation/commit failure/stale later product rolls back the whole lot. Foreign/nonexistent/retired products share the same unavailable outcome. Domain errors may identify the requested product and affected field/version; raw SQLite/provider errors are redacted.

Canonical product sync/remote-version rules are reused and may still produce normal reconciliation conflicts for later pending edits. A queued local recomputation does not certify fresh analytics. No migration, remote writer, identifier/alias/packaging mutation, create/delete or native model/UI exposure is added by this adapter. Full catalogue tools, persistent cross-device result references and trusted conversational approval binding remain subsequent work.

## M7-T20b — Full catalogue draft and tombstone tools

`product.save` version 1 separates CREATE (no model product/child IDs or expected revisions) from UPDATE (UUID/exact local product revision plus complete expected child UUID/revision sets). The strict full draft bounds product labels/classification/packaging and 20 identifiers/20 aliases, preserves identifiers as strings and rejects repeated IDs/normalized aliases/identifiers. Trusted reviewed USER intent/owned active conversation/current cached permission are checked before mutation or cached replay. Independently changed/missing/foreign children, unresolved sync or a strong identifier attached to another product fail explicitly. Existing status/source and rejected alias decisions are not silently revalidated.

`product.retire` accepts only UUID/exact product revision and performs the canonical logical PRODUCT_DELETE, not physical deletion or a new retirement model. Existing rows, references and immutable historical observations remain. Recovery requires a future explicit tool.

Both adapters join the existing editor/repository's nested local operations to one already-exclusive transaction with all Outbox commands, private before/after result identity and applicable analytical recomputation job. Failure/cancellation rolls back the full aggregate; exact retries add no duplicate IDs, commands or jobs. The result includes command IDs and pending recomputation identity, not a claim of immediate remote synchronization/fresh analysis. Expected remote command versions use the canonical editor helper (dirty records reference their local entity revision; clean records their observed remote revision) without changing observed remoteVersion. No new remote writer/migration/native exposure is introduced. Typed catalogue input/result schemas and review UX still need native/model orchestration binding.

## M7-T20c — Need and relation tool contracts

`need.list` is an owner/store-authorized local read with bounded UUID pagination, typed canonical units/current versions/sync states and inactive code reservations. It uses SQLite 35 read-result identity and current authority-before-replay without business commands.

`need.save` CREATE accepts no entity identity/version; UPDATE requires exact UUID/version, name/description/status and unchanged code. New origin is USER; existing origin and creation identity are preserved. INACTIVE is a canonical status transition; code reuse/rewrites are rejected. `need.membership` and `substitution.save` require parent UUID/revisions, exact current association revision (null only when absent), declared editable values and an explicit VALIDATED/REJECTED decision. A specific refusal-reactivation flag is bound to reviewed USER authority. Raw source/humanConfirmed/evidence/learned score/confidence fields and actor/store permissions are not model input. Substitution IDs retain ordered A→B direction; no reverse record is generated.

The current catalogue-management reviewed operation gate joins existing need/membership/substitution repositories, audit and Outbox with a typed private before/after result in one exclusive SQLite transaction. Existing empirical learning/source values remain untouched; a separate declaredConfidence field is required for new manual memberships, null preserves existing confidence, and non-MANUAL confidence changes are rejected; canonical repository learning-read-only checks still apply. Parent scope/revisions/active validation and sync conflicts are checked; replays add no duplicate commands/audits and failed/cancelled transactions roll back. A new reviewed MANUAL membership uses the explicit human-declared confidence; it is not a measured AI certainty or an assumed default. Native proposal/form/batch/user-review and recovery bindings remain separate activation work; no remote writer/migration or automatic learned update is added.

## M7-T21a — Field observation write tools

`store.event.capture` version 1 accepts exact product UUID/revision, canonical event type and normalized start/optional end/severity/comment. Event/command identity, USER source, sourceDocumentId=null and capture time are produced by trusted app code, never model input. Dates must represent an observation already made according to the application clock; an active product with incomplete descriptive metadata is still eligible. Numeric stock/price and official KPI writes are outside this contract.

`store.event.close` requires scoped event UUID/exact local revision and normalized end time. The canonical closure only applies to USER observations; commercial document signals cannot be promoted or closed as observations. An identical already-closed timestamp returns a typed no-op; another date fails, and stale/unresolved records require domain reconciliation. The end must follow the start and not exceed capture time.

Both use reviewed USER intent bound to an ACTIVE owned conversation/exact normalized request and a distinct trusted field-capture capability. The shared store-operation gate does not convert field permission into product management; catalogue wrappers retain their own capability checks. Existing repository/history/Outbox writes and private before/after result identity commit inside one exclusive transaction. Exact restart replay adds no commands/events, failures/cancellation roll back, and the typed sync state remains distinct from successful remote synchronization or qualified analytical processing. No new schema migration, remote writer or native/model exposure is added.

## M7-T21b — internal weekly preparation tools (11 October 2026)

`commercial.preparation.inspect` reads the explicit Monday's local draft and sync state through the existing repository; absent data stays absent. `commercial.preparation.save` accepts a reviewed full draft plus its expected local version (null for creation). App code supplies store, deterministic week identity, command ID, clock and a distinct `canPrepareCommercialWeek` capability. It preserves creation time and advances the canonical revision.

The canonical preparation schema/repository enforce week boundaries, capacity, placements, offer versions/status/period and visual-source references. Changed offers and invalid TG sources return targeted French errors. Conflict/error drafts require dedicated recovery. Request/result identity, canonical history and Outbox save join one SQLite transaction; exact replay is checked only after current conversation/owner/permission authority. No publication, execution, calculated stock, paid AI call or native chat activation is added. Retain/withdraw choices, plan execution, recovery and native review binding remain separate T21 work.

Real SQLite tests cover offline save/read, exact replay after restart, revisions, reviewed permission, invalid capacity, changed choices, cancellation and failed commit rollback. No EAS build is required for these internal adapters.

## M7-T21c — internal commercial choice tools (11 October 2026)

`commercial.choice.inspect` reads an owned choice by ID, including withdrawals, with revision/sync state; missing data remains absent. `commercial.choice.save` records a reviewed, bounded full choice (create/update/withdraw), using the existing CommercialChoiceRepository. Store, deterministic source identity, clock and command ID are app supplied; `canManageCommercialChoices` is independent of catalogue permissions. A retained choice requires the associated active product's exact version, confirmed applicability/critical fields and the original reading's operation/item labels. Canonical mechanism validation and duplicate prevention remain in force.

Withdrawals require an existing exact-version choice and preserve its product, period and mechanism. Source/creation identity and all history remain canonical; withdrawal does not update a saved preparation or execute a plan. Conflicted/error records require separate recovery. Reviewed request authority, local mutation, history, Outbox and cached operation result join one SQLite transaction. Revoked/foreign authority cannot replay results. The adapter is internal: native chat/review binding, paid generation and dedicated recovery remain pending. No EAS build is required.

## M7-T21d — reviewed commercial plan tools (11 October 2026)

`commercial.plan.preview` reads an explicit week's preparation and canonical context, returning readiness issues or a deterministic candidate from `buildCommercialWeekPlan`. Its embedded VALIDATED-shaped candidate is provisional: the READ operation writes only its private result journal, never a business plan/Outbox. The app injects the digest function; it cannot be supplied by model input.

`commercial.plan.validate` accepts only the persisted preview operation ID. Trusted `canValidateCommercialPlan` authority must bind the exact request to a reviewed USER message in the same owner/store/conversation, dated at or after the preview. It rechecks the current plan revision, readiness and exact deterministic rebuild of the preview. Product/choice/preparation/reference changes require a fresh review. IDs, scope, version, clock and plan content come from canonical app services, never a model-authored plan. The final validation timestamp is the actual application time.

The existing CommercialPlanRepository atomically saves the plan, materialized operations/offers, canonical history and Outbox together with the tool result. Local history records the pending revision; remote revision snapshots arrive through normal synchronization. Exact replay after restart does not duplicate writes. No execution in rayon, AI generation, native chat activation or paid EAS build is introduced. Dedicated offer-validation tools, execution and conflict recovery remain follow-ups.

## M7-T21e — reviewed offer validation tool (11 October 2026)

`commercial.offer.validate` internally validates 1–25 exact retained choice revisions through the existing ValidatedOfferRepository. Model arguments contain only choice IDs, choice versions and expected product versions. App scope supplies a dedicated `canValidateCommercialOffers` permission, the exact reviewed USER request, device/command IDs and clock, plus trusted review attestations for every selected choice/version/reading/checksum. Model-supplied review booleans cannot grant authority. Native source-review UI binding remains pending; these internal attestations are not yet produced by a live chat.

The adapter checks active owned products, current versions and sync state; canonical source extraction preserves the original fields and evidence in immutable validation records. ERROR/CONFLICT require separate recovery. The complete batch, canonical history, Outbox and tool result share one SQLite transaction. A later unchanged request returns existing validation entities with null command IDs; exact operation replay retains its original result after restart, with permission/conversation and source-attestation checks still required. No plan or field execution is implicitly saved.

Real SQLite tests cover batch success/restart, unchanged no-op, stale versions, missing or mismatched source review, foreign/revoked authority, second-source failure, failed commit, cancellation and failed-record preservation. No paid AI call or EAS build is required. This completes the internal choice → offer validation → preparation → plan adapters; generation/native orchestration, execution and conflict/recovery tools remain pending.

## M7-T21f — internal commercial execution tools (11 October 2026)

`commercial.execution.inspect` returns the current explicit week's canonical signage/TG checklist, matching declarations, sync state and deterministic progress. Missing plans stay absent and tasks without declarations remain TODO. A DONE count is a user declaration, never automatic evidence of field execution; conflict/error states remain visible.

`commercial.execution.save` records a reviewed status/note for one current-plan target, with exact plan/task versions (null task version for creation). App code derives the target label, identity, revision/checksum and timestamps from the canonical checklist; model input cannot forge these or grant `canDeclareCommercialExecution`. DONE sets the application declaration time, a note-only edit preserves it, and explicit reopening clears it. Ignored/non-applicable tasks require a reason. Identical status/note is a no-op. Old plan targets cannot silently transfer to a new revision; historical-plan editing and dedicated conflict recovery remain follow-ups.

The existing CommercialExecutionRepository writes canonical history and Outbox in the same transaction as the private tool result. Exact replay survives restart without duplication and current authority is rechecked. Plans, offers, stock and analytics are not mutated; the tool does not print an actual sign. Tests cover checklist reads, declarations/restart/no-op, version chaining, date semantics, changed plans, authority, missing plans, conflicts, cancellation and failed-commit rollback. Native chat integration remains pending. No paid EAS build or AI call is required.

## M7-T21g — internal store settings tools (11 October 2026)

`store.settings.inspect` reads the owned store's canonical settings/version/sync state; missing configuration stays absent. `store.settings.save` accepts reviewed city/postal code/school-zone values and an explicit location policy (`CITY` or `KEEP`), with an expected local revision. Trusted `canManageStoreSettings` is distinct from catalogue/field permissions. IDs, country/timezone, versions and timestamps come from app code; model input cannot inject coordinates or claim a new DEVICE capture.

KEEP preserves a recorded point exactly; creation without prior settings uses CITY. An address change while keeping a DEVICE point requires explicit CITY selection or manual device recapture. CITY clears the old point through canonical settings save. Unchanged settings are a no-op. Conflicted/error settings require dedicated recovery. Canonical history/Outbox and the private operation result join one transaction; current authority is checked before exact replay after restart.

No GPS permission, OS setting, external geocoding/weather request or AI call is performed. A changed settings fingerprint excludes the previous weather/calendar cache from fresh `store.week` reads without deleting its history; provider refresh remains a separate operation. SQLite tests cover absence/read/save/restart/no-op, point preservation/explicit city selection, coordinate forgery rejection, revision chaining, cache isolation, stale versions, rights, conflicts, cancellation and commit rollback. Native chat/source/form binding remains pending and no EAS build is required.

## M7-T22a — contextual question schemas and local response drafts (11 October 2026)

Typed question definitions contain 1–8 unique contextual fields, a short explanation, reliable prefill candidates and parent USER/operation IDs. Supported fields are DATE, decimal NUMBER with explicit unit, bounded TEXT, enumerated CHOICE and opaque FILE source references. ISO calendar dates and available choices are checked; decimal strings accept a French comma and normalize without floating-point arithmetic. Partial/invalid values remain raw editable drafts and return field-keyed issues. Numbers with units and dimensions are facts to collect, not calculated business results.

SQLite migration 36 adds owner/store/conversation-scoped `copilot_forms`. The local repository checks an active owned conversation and parent USER before creation, preserves exact definition retry identity, and version-checks edits. Answer edits merge by field; null/empty clears a value. SAVE evaluates OPEN/READY, POSTPONE preserves answers and CANCEL terminates the question. A changed trusted app basis token marks the old question STALE while preserving its earlier answers. Tokens must be derived/rechecked by native orchestration, never accepted from model authority. Unknown or missing/deleted/foreign FILE references cannot become ready; attachment intake remains T23.

These are internal local drafts: READY does not publish observations, authorize a tool or prove verified financial data. No business Outbox/server record is generated; cross-device question replication, canonical answer consumption, actual chat resumption and inline rendering remain follow-ups. This increment does not claim the full T22 gate. SQLite tests exercise partial reply/restart, precise decimals, field errors, postpone/resume/cancel, obsolete questions, rights/version isolation, saved attachment scope, failed commit/cancellation and upgrade from schema 35 preserving pending sync/history. No EAS build or paid AI call is required.

## M7-T22b — submit a contextual response into private conversation history (11 October 2026)

The internal form submission service consumes only an exact READY form revision, with a trusted explicit submit confirmation bound to its ID/version and current app basis token. It rechecks owner/store/active conversation, readiness and live saved-source scope. It creates a canonical immutable USER reply linked to the original request, retaining exact normalized values (decimal strings, ISO dates, choice IDs and opaque source references) in the form's submission receipt. Human-readable text displays field labels, French dates and units; repeated source references produce a single attachment entry.

Message/history Outbox and ANSWERED receipt join the existing SQLite transaction. Exact retry after restart returns the same message/receipt, and a submitted form cannot be edited into a different answer. Existing migration-36 form payloads default to no receipt; no new migration or API business entity is required. Current permission/confirmation and basis are rechecked before replay. Wrong revisions, incomplete/obsolete answers or a deleted/foreign file return scoped errors and field issues without sending a message.

The canonical conversation append path adds an optional app-only `preserveDraft` flag: inline-form submission preserves an unrelated composer draft, while ordinary append retains its existing clearing behavior. This is conversation synchronization only; no product, observation, plan or financial figure is published. Source processing, automatic agent resumption and actual inline chat UI remain follow-ups, so T22's full gate is still pending. Tests use real SQLite for restart/replay, composer preservation, exact values, source revalidation/deduplication, stale/foreign authority, commit rollback, cancellation and old-payload compatibility. No paid AI or EAS build is needed.


## M7 conversational Mercalys assistance — 18 October 2026

`POST /api/v1/copilot/import-classification` accepts a strict label-only batch (one to fifty unique labels), authenticated current MANAGER store context and returns model/category/confidence/reason suggestions bound to those exact labels. It is read-only; no product ID, price, quantity, unit or mutation authority is model-controlled. Provider budgets/timeouts and no automatic transport retry apply; errors expose no credentials/provider detail. Native policy applies unknown-only semantic category completion and explicit-source nature/unit completion through canonical product/Outbox services.

Existing local `mercalys_intake_items.payload_json` may carry optional versioned assistance cache metadata (input hash, bounded attempted-label count, result/provenance). A native batch reserves at most two hundred attempts before provider calls, including failures; no migration or synchronized-manifest protocol is introduced. Native import USER records bind policy version and immutable owned manifest hash. Existing `copilot_tool_results` journals retain automatic preparation/classification/publication and explicit choice results; canonical business writers and current scope/conflict checks are unchanged. Partial files are not automatically published before their ambiguities are resolved.

Private USER outcome records link the originating import message and carry device-observed status/source/date references in at most twenty-file pages. They use the existing private history/Outbox and deletion rules, preserve draft text and are not KPI evidence or source-upload confirmation. Generation-history projection explicitly qualifies their provenance. The original binaries and intake manifests remain local working records; durable cross-device restoration remains separate outstanding scope.


### Native Mercalys catalogue choice receipt — 18 October 2026

The local import-resolution choice is strict: an exact resolution key, nullable target product ID and optional literal `catalogueSelection: true`; the latter requires a non-null target and is supplied only by the native reviewed catalogue picker. It is not an API/model mutation input. The existing exact native import/manifest/current-review proof remains required. Canonical identifier/alias commands retain their existing payloads, conflict policy and transaction boundaries.

The private `importAutomationResultSchema` gains optional `mapping` metadata (source label/indexes/identifiers, chosen product ID/label and SUGGESTION/CATALOGUE selection). Older receipts without this field remain valid; the result journal and canonical identity Outbox commit atomically. No new table, migration, synchronized business aggregate, provider contract or remote endpoint is introduced. Current permission precedes cached replay; file/catalogue changes require a new decision.


### Completing a partial Mercalys aggregate — 18 October 2026

The existing `MERCALYS_PUBLISH` aggregate/version protocol supports completing WARNING source records without changing its remote payload shape. Native continuation compares the retained checksum, source period/parser, every source index and canonical numeric record with the existing publication. Published matches/observation IDs remain historical; newly resolved WARNING records keep their IDs, become PUBLISHED at their next record version, and receive new stable observation IDs. Source bytes/raw payloads and previous observations are unchanged.

Continuation, analytics recomputation and a frozen Outbox snapshot commit together. `mercalys_publication` joins the per-entity ordered Outbox selector: an unacknowledged earlier packet blocks a later one, and FAILED/CONFLICT predecessors block continuation. An initial expected-null packet is followed by expected revision 1; subsequent snapshots advance the existing revision chain. No packet already queued or attempted is rewritten, and no foreign version is silently rebased. Existing server source validation, command idempotency and version conflicts remain authoritative.

Mobile pull/ack application now advances an existing source record only when its incoming record version is newer; an earlier acknowledgement cannot undo a local completion. Source/mapping metadata and records remain within the same aggregate. Private import-status items gain optional published/remaining counts and can reference the existing shared source while still under review; older status items without counts remain valid, and these counts remain device observations. No migration or new business command/endpoint is required.

Pull/bootstrap queries gain optional `mercalysRecordUpdates=true` alongside `mercalysPublications=true`. The first committed publication containing source-record revisions above 1 atomically marks the existing per-store sync counter with `mercalysRecordUpdatesRequired`; legacy reads use this indexed store marker rather than scanning publication rows. Once marked, pull freezes the entire Mercalys aggregate channel for legacy clients, whose record applicator only inserts. This also withholds later replacements/ordinary imports: delivering a replacement while omitting its revised predecessor could double-count old rows. Previously local data remains intact and cursors still advance. A compatible native reader advertises the capability and records per-store adoption during bootstrap. Its first adoption forces bounded replay from the beginning so that imports skipped by an older cursor are recovered after upgrade, without clearing local work. Deploy the compatible API guard before distributing a native build that completes partial sources; old binaries retain their previous data until upgraded.


### Progressive conversational Mercalys publication — 18 October 2026

No new table, business-mutation shape or synchronization capability is introduced. The private intake reference accepts policy versions 1 and 2: new native selections write version 2, while version-1 references retain whole-file publication until identity review is complete. Native clean nonoverlapping imports publish their ready rows through the canonical publisher, retaining unresolved records as WARNING. Subsequent safe subsets reuse the same stable source/record IDs and versioned MERCALYS_PUBLISH continuation protocol, immutable entity-ordered Outbox packets and transactional private result journal. Operation retry identity binds the full canonical summary and prior aggregate snapshot, and both are reread before mutation. REVIEW private status retains committed published/remaining counts; it is not remote KPI evidence.

The shared department builder accepts optional source-channel incompleteness flags resolved by canonical SQLite/Mongo readers for the exact store/date. Local WARNING records from active nonsuperseded Mercalys originals and current remote aggregate WARNING records qualify the corresponding department money availability as PARTIAL when an amount exists. Unavailable values remain unavailable. Sources with deleted observations (superseded aggregates) do not prolong the qualifier. The qualifier enters inputRevision; monetary formulas and wire output shape remain unchanged. Existing incomplete import numeric values can remain usable, but may not be presented as complete totals. The API reader guard from the preceding increment must still be delivered before the compatible native binary.


## M7 receipt recovery proposal (18 October 2026)

`x-copilot-receipt-recovery: 1` enables an optional read-only proposal tool in the existing authenticated chat turn. Model input is strict `{ sourceDocumentId, action }`, action in RETRY_PROCESSING / KEEP_BOTH / CONFIRM_DUPLICATE. Tenant, owner, permission, native receipt/version, task IDs and review proof cannot be supplied by the model. Owned source metadata is reused from the publication reader. Any publication whose `publication.source.id` equals the source makes recovery read-only, even when receipt and source UUIDs differ.

Server-only `WASTE_RECOVERY_PROPOSAL` schemaVersion 1 TOOL records retain assistant linkage, exact original metadata and requested action. They use existing private conversation/message persistence and incremental sync, not a new business entity. The verified proposal is atomic with the assistant response; a foreign artifact rolls back the complete response. Previously validated previews may survive final-prose grounding fallback. Older clients receive no recovery tool through their capability contract.

The local review hashes source/current receipt/complete lines/products, retained file metadata, bounded upload-job records and exact-duplicate candidate metadata. Current store/owner/conversation/permission and immutable private record checks precede mutation/replay. Existing `copilot_tool_results` stores request plus before/after processing/AI/duplicate statuses in the same SQLite transaction as canonical `retryProcessing` or `resolveExactDuplicate`. Retries reset the existing task; duplicate decisions preserve binaries/lines and can enqueue the canonical upload task when KEEP_BOTH requires it. These draft actions retain existing LOCAL_ONLY behavior and introduce no business Outbox entity; separate receipt publication owns observations and synchronization. No migration or new endpoint is required.


## M7 field/settings conflict proposals (18 October 2026)

Existing authenticated chat turns accept optional `x-copilot-store-conflicts: 1`. Strict model input contains FIELD_EVENT plus an existing event ID, or SETTINGS with null ID. Tenant/owner, permissions, conflict ID, remote version, command IDs, winner and review fingerprint are never model authority. The server reads `storeProductEvents` / `storeContextSettings` with store scope and bounded query time, then returns an owned revision. Settings use the existing coordinate-free visible projection; a SHA-256 fingerprint of the full canonical serialized record binds hidden coordinates without transmitting them to the model.

Private `STORE_CONFLICT_PROPOSAL` version 1 TOOL records bind input, remote revision and the assistant/USER chain. They reuse existing conversation persistence and private incremental sync; their atomic server transaction rolls back a foreign artifact along with its assistant response. The native review reads `sync_conflicts`, canonical event/settings and ordered relevant Outbox rows (101 read to detect an exceeded 100-row limit). One current open conflict and exact remote revision are required. Full local conflict/current/commands and the server binding contribute to the native review hash.

User selection KEEP_LOCAL / ADOPT_REMOTE is bound in the trusted request. The existing reviewed-operation transaction checks the private active conversation and original USER/ASSISTANT/artifact, current family permission, conflict and hash, then calls canonical `.resolve`. `copilot_tool_results` stores request and outcome together with canonical entity/history/conflict/Outbox writes. Adopting remote sends no new command; retaining local uses existing versioned event-close or settings-upsert commands. There is no new table, migration, endpoint or business synchronization contract. Cross-device canonical restoration remains the ordinary incremental serializer path, with stable entity IDs.


## M7 need-family conflict compatibility (18 October 2026)

`x-copilot-store-conflicts` accepts 1 or 2. Capability 1 retains the strict two-kind input; capability 2 extends it with NEED / MEMBERSHIP / SUBSTITUTION plus existing entityId. The server scopes reads of `needUnits`, `needMemberships` and `productSubstitutions` to the authenticated store and verifies entity identity/version. Existing event/settings previews omit all new optional fields, preserving their serialized version-1 shape. Need-family previews carry exactly one typed need/membership/substitution record; their private `STORE_CONFLICT_PROPOSAL` artifacts require schemaVersion 2. A v1 artifact claiming a new kind is rejected.

Native conflict resolution additionally requires manager authority for the need families. Current parents and their synchronization state are included in the review hash; full native records stay local. Existing canonical `.resolve` transactions preserve histories, superseded commands and conditional versioned Outbox commands. The optional native `reactivateRejected` request/result flag records the user's separate consent when choosing a non-rejected outcome over a rejection on either side. It is never accepted as model input. Existing request/result rows omit it and retain their canonical identity. No schema migration, new endpoint, entity or business command is introduced.

For substitution KEEP_LOCAL, canonical resolution copies synchronized observedSubstitution/relationshipScore/confidence/evidenceCount/lastEvidenceAt while retaining local declarations. Direction and parent identities remain fixed. Derived learning values are not editable through the model or this card. Remote adoption remains a local restoration with no new Outbox command. Canonical synchronization and second-device serializers are unchanged.


## M7 — reviewed commercial workflow conflicts (18 October 2026)

`x-copilot-store-conflicts: 3` extends the existing strict model input with commercial choice, weekly preparation and weekly plan kinds. Earlier 1/2 schemas remain isolated. The owned indexed reads use commercialOfferChoices / commercialWeekPreparations / commercialWeekPlans and canonical serializers with a two-second query bound and 96,000-character target-review limit. New optional typed choice/preparation/plan basis fields are omitted from all earlier artifact shapes; exactly one target is required. Commercial STORE_CONFLICT_PROPOSAL records require schemaVersion 3 and the existing private assistant/USER binding.

The optional native `retainWithdrawn` flag records separate human consent to reverse a withdrawal on either side. It is never model input. Current canManageCommercialChoices / canPrepareCommercialWeek / canValidateCommercialPlan flags are checked even on replay. Native proofs include complete relevant dependency sets (at most 500 records per commercial family, 2,000 products, and a 1,000,000-character aggregate review bound), current conflict and at most 100 relevant command records; no sampled dependency set authorizes KEEP_LOCAL. Canonical local resolvers remain the writers: history, superseded commands, projections, conditional Outbox and private result commit together. Existing sync serializers restore stable IDs on another device. No new table, migration, endpoint or business command is introduced.


## M7 — PDF reference and execution conflicts (18 October 2026)

The existing conflict header additionally accepts 4. `storeConflictV3InputSchema` freezes the earlier eight-kind enum; the newest strict input appends COMMERCIAL_REFERENCE / COMMERCIAL_EXECUTION. Optional typed reference/execution basis fields are omitted from earlier artifacts. Exactly one owned target is required. Only these two new families use STORE_CONFLICT_PROPOSAL version 4. `commercialVersionDecisions` and `commercialExecutionTasks` are read by owned ID with the existing two-second query and 96,000-character target limit. No endpoint, table, migration, domain entity or sync command is added.

Native current `canManageCommercialReferences` / `canDeclareCommercialExecution` authority gates both comparison and completed replay. PDF proofs bind both original metadata labels and complete visual-reading sets for the original pair. Retaining local uses shared source validation before and after mapping the selected document into the remote orientation. Execution proofs bind complete exact-archive/current/relevant-history sets; canonical checksum/checklist validation prevents plan/target reattachment. Preflight row/length totals enforce at most 500 records per relevant family and 1,000,000 source characters, with no sampled authorization; the existing 100 relevant-command gate still applies. Adopt-remote keeps canonical restoration semantics even when local dependency proof prevents resending local. Canonical history/retired commands/optional Outbox and private result remain atomic. Original task completion timestamps are retained; no plan projection or sales/waste observation is modified.


## M7 — catalogue conflict resolution (18 October 2026)

SQLite migration 42 adds product_master_remote_snapshots (store/type/id primary key, canonical version, UPSERT/DELETE, nullable payload) and product_master_conflict_history (stable action ID, store/type/id, local/remote/resolved snapshots, decision/time). Upgrade preserves all existing business/Outbox/conflict rows. Product-master pull/bootstrap/ack record monotonic remote revisions before applying existing dirty/expected-version guards; an equal-version DELETE cannot be resurrected by an UPSERT snapshot. Dirty local operational data remains untouched when a newer remote version arrives. These are local support tables, not new remotely replicated entities.

Native capability 5 adds PRODUCT / IDENTIFIER / ALIAS to the existing typed comparison input; earlier capabilities have exact frozen schemas. New optional typed product/identifier/alias basis fields are absent from earlier artifacts; catalogue artifacts require version 5. Server reads use products / productIdentifiers / productAliases and existing Decimal128/date serializers with the prior two-second query/review-size bounds. Current manager permission is still required on replay. Optional native activateProduct and existing reactivateRejected flags record separate user consent and are never model input.

One canonical local resolver serves manual and chat actions. It requires one open conflict, a complete current review, at most 100 relevant command rows, matching ownership and unchanged latest known remote revision. Child parent/source identity cannot be changed here. Existing shared alias ambiguity checks use the complete bounded active catalogue (2,000 products); exact code/alias collisions block local retention. Canonical ProductMasterRepository writes or applyProductMasterChange adoption, conflict/history, retired commands, optional ordinary PRODUCT_* Outbox, private result and queued deterministic recomputation are atomic. PRODUCT_MASTER_CONFLICT_SUPERSEDED is excluded from active error counts and does not block a replacement alias command. Local retention rebases creation metadata and version to the synchronized record and preserves synchronized alias confidence. No remote mutation shape, endpoint or domain entity is added. Deleted-entity/cross-parent restoration remains outside this supported path.

## M7 — local source-upload recovery and failed-command diagnostics (18 October 2026)

No API, model tool, capability, domain payload or migration is added. The device can inspect and explicitly expedite an existing `SOURCE_UPLOAD_AND_REGISTER` task for Mercalys sales/waste or a weekly PDF. The canonical local recovery repository binds a digest to the live owned source, exact retained file metadata and complete bounded task/file lookup. Confirmation rereads that basis in an exclusive transaction, checks current authority/cancellation before and after the write, and changes only the existing task's retry status/due time. Source UUID, file/checksum, lifetime attempts, originals, records, observations and Outbox commands stay unchanged. Confirmed originals do not re-trigger analysis. Running, terminal/invalid/missing-file, duplicate-task, mismatched-file, import-conflict and known server rate-limit-delay states cannot be expedited. Normal queue execution still checks the actual binary and uses the existing stable upload/completion identity. Its file join now enforces source/store/checksum/retention linkage before sending any bytes.

The chat's existing Mercalys file sheet restricts recovery lookup and confirmation to its live private conversation and owned intake manifest checksums. The manual sync dashboard shows the same canonical actions; the existing weekly-PDF button delegates to that repository with current role/store/account/focus checks. Physical original restoration and remote analysis-job reopening are not implemented by this action.

`OutboxRepository.listFailures` is read-only, paginated oldest-first and excludes the same superseded terminal rows as active-error counting. Private conversation/message/knowledge commands are filtered by payload owner/store before pagination; no payload body or unchecked error text is returned to the UI. Failed business commands are not reset: a durable `processedCommands` REJECTED result remains the result for the same command identity, even after prerequisites change. Correction must use the appropriate canonical business action/new command; generic automatic correction remains an explicit gap. Network/transient sync failures already retain their existing PENDING retry path.

## M7 — reselection of a missing immutable original (18 October 2026)

Shared `sourceOriginalRestorationSchema` validates a device-local operation UUID, exact review digest and bounded file-copy proof (private file URI, SHA-256, byte length and PDF/XLSX media type). There is no remote endpoint, model input or business command for that proof. SQLite migration 43 adds `source_original_restorations`, a local operation journal retaining the old/new location, source/file/task identities, request proof and time. Migration does not rewrite pending commands, observations, attempts or retained originals.

Only an unconfirmed Mercalys/PDF source with one consistent retained original and one FAILED upload task whose exact error is SOURCE_UPLOAD_LOCAL_FILE_MISSING is eligible. Source/type/checksum/size/media identity must remain known; active work, import conflicts, failed/conflicting publication commands, invalid/confirmed sources and ambiguous/mismatched metadata are blocked. Selection creates a new app-private copy before an exclusive transaction. Its actual checksum and size must equal the stored original. The transaction rechecks scope, authority, cancellation and current basis, then changes only the existing file/source locations and upload status, requeues the same task without resetting attempts, and writes the operation journal. Original filename, source UUID, business versions/records/observations and all frozen Outbox packets remain unchanged. Exact journal replay after restart returns the earlier outcome without requeuing a completed send. A changed operation identity is refused.

Filesystem copying cannot share a SQLite transaction. Copying never overwrites a selection or retained original. Failure removes only this attempt's unreferenced private copy; if reference/commit outcome is uncertain, the copy is retained. An app termination before attachment may leave an unreferenced private copy for future retention maintenance. No binary is deleted merely because a database operation is uncertain.

Immutable Mercalys intake JSON and private chat references are preserved. Batch preparation/manual examination can resolve the restored location through same-store checksum/size/file linkage and the restoration journal, with a bounded ambiguity check; the normal byte checksum validation still runs before parsing. PDF original access and the uploader recognize the new private copy directory if the app container moves. Receipt/multi-photo originals, lost manifests, already confirmed remote-only sources, and remote analysis-job recovery remain separate gaps.

## M7 — commercial PDF processing status and durable resume (18 October 2026)

`GET /api/v1/commercial/:id/processing` requires bearer/store authorization before and after reading a live confirmed owned PDF. Its strict DTO includes source UUID/checksum, metadata digest, observation time, French explanation, overall/three stage states, bounded ready/total page counts, optional wait time and resume eligibility. It excludes original paths, draft/visual content, provider errors and credentials. The bounded metadata projection is not a content-validation guarantee. `POST /api/v1/commercial/:id/resume` accepts only `{operationId, basisHash}` and requires current manager/device/user authority. A transaction rereads exact proof and eligibility, stamps only the source job's manual-resume cooldown and inserts a request; source/observation/result data and attempt budgets are unchanged.

Mongo migration 38 indexes `commercialDocumentRecoveryRequests` by source/time and pending delivery/time. The immutable operation binds store/source/actor/checksum/request JSON/accepted stages. Its delivery state is PENDING/DISPATCHED/DELIVERY_FAILED with token/lease, five-attempt bound and one-minute backoff. A stable `commercial-pdf.resume.v1:<operationId>` Inngest event is recoverable after lost delivery receipts through the existing cron. The worker intersects accepted stages with freshly eligible work, then reuses canonical processor leases; manual AI manifests disable legacy budget recovery. Terminal/received pages are never reset. Broker failure details are not exposed. This path does not claim to repair broker billing/configuration or a missing/invalid original.

SQLite migration 44 adds only `commercial_processing_cache(store_id,source_document_id,payload_json)`. Existing source/file/publication/Outbox rows remain intact. `COMMERCIAL_ANALYSIS_RESUME` is an operational local job, not a business command: its stable operation UUID, private owner/store/source/checksum/digest survive restart. Queue sending rechecks ownership/source identity and retains the same request after network loss or an uncertain local receipt commit. A permanent refusal requires a fresh verified state and a new user decision. Cache writes reject another source/checksum and older observations. No new model capability or publication serializer is introduced. Deploy the API before a compatible future native binary; old binaries do not call these routes.

## M7 — device-only receipt-photo selection and existing attachments (18 October 2026)

Shared `copilotReceiptPhotoBatchSchema` is a device-only strict selection with `mode: ONE_PHOTO_PER_RECEIPT`, one to ten URI/filename/MIME items. It is never a remote/model payload. Selection and actual copied metadata are bounded to 20 MiB per photo and 80 MiB per batch, with the existing ten total composer slots. Copied byte size, SHA-256 and supported original MIME are checked before business draft creation; size drift during copying is refused. Native storage uses unique app-owned filenames and preserves selected gallery originals.

No new table, command type or endpoint is required. For each accepted photo, canonical source, retained file, receipt, optional existing upload task and `copilot_drafts` attachment are written in one exclusive transaction. Store/owner/conversation status, current capture permission, cancellation and actual draft capacity are rechecked; the existing receipt duplicate query determines whether an upload job is appropriate. The composer draft's bounded attachment list, then the immutable USER message references, retain the accepted per-source batch membership across restart. Metadata/photo content never counts as published observations. Copies with an uncertain DB attachment outcome remain retained for later retention maintenance; a process death before association can leave an unreferenced private copy. No selected or referenced original is removed.

Receipt attachment binding requires a unique live same-store receipt/source/file linkage, matching source/file checksum and a retained supported image. Source summaries read only one bounded local aggregate with a line count; foreign/ambiguous/deleted sources are not exposed. Generic authenticated remote attachment lookup and receipt readers already handle the resulting WASTE_RECEIPT references and enforce upload status independently of captions/MIME captured in chat. Removal/deletion of a chat reference does not cascade into source/receipt deletion or reverse publication. Existing grouped API-before-native release requirements remain; no delivery or iPhone acceptance is claimed.


## M7 — immutable multi-view receipt source (18 October 2026)

`application/vnd.flcopilot.receipt+json` is an internal original-source container, admitted only for WASTE_RECEIPT by the existing upload initialization contract. `receipt-photo-bundle.v1` strictly contains `mode: ONE_RECEIPT_MULTIPLE_PHOTOS` and two to five ordered `{mimeType,sizeBytes,checksum,dataBase64}` originals (JPEG/PNG/HEIC/HEIF). Limits: 20 MiB per original, 48 MiB decoded total, 65 MiB container. Canonical serialization excludes filenames, timestamps, actor IDs and local URIs. Strict size/hash/base64 decoding rejects repeated identical frames and altered originals before any provider call. No new source type, endpoint or dependency is introduced. The immutable container remains in private Blob; derivatives never overwrite it.

SQLite migration 45 adds device-only `waste_receipt_photo_groups(source_document_id PK,store_id,checksum,payload_json)`. Its strict payload holds ordered private photo locations/MIME/size/hash, never base64. Parent source/file/receipt and private draft attachment commit atomically with this manifest. Attachment binding requires an owned live unique retained parent plus same-checksum group metadata; read/display refuses foreign or stale linkage. The existing canonical upload task transports the one container and retains its UUID across restart. A removed chat reference does not remove sources. Ambiguous/permanent group-analysis failures leave a FAILED task with a safe code, CONFIRMED original upload and no automatic/manual budget reset. Source/receipt/Outbox publication rules are unchanged.

Server normalization verifies the source checksum and each original, writes ordered JPEG derivatives under source-owned ordinal keys, and marks READY only after the complete manifest is recorded. Derivative hashes/sizes are checked before reading by vision; normalized input is bounded to 10 MiB/frame and 24 MiB total. Processing fields on sourceDocuments are internal metadata, not syncable business entities. Existing migration-8 extraction uniqueness is reused. Group schema `waste-receipt.vision.multiview.v1` remains separate from the unchanged single-photo v2 contract; its persisted sourceRegion JSON includes image indexes and a region relative to the first supporting view. Date/cashier and numeric values still pass through the existing deterministic arithmetic/matching/draft adapters. Both schemas remain compatible with the existing JSON provenance and publication contract.

Atomic source leases last 180 seconds; group requests time out at 90 seconds with SDK retries disabled. A maximum of four attempts and pinned pending provider/model survive replay; completed evidence is reused after configuration changes. Late workers cannot replace the newer lease owner's result. A renamed exact ordered group can reuse earlier extraction (`reusedFromExtractionId`) without another model call, while retaining separate source/line identities and the existing duplicate decision. Exact-duplicate ordering uses registration time/UUID to avoid mutual duplicate links. Neither this protocol nor AI declarations establish semantic identity between different crops/orderings. The [OpenAI image-input guide](https://developers.openai.com/api/docs/guides/images-vision) documents multiple image inputs in one request; this implementation preserves the existing provider/model routing and adds only receipt-local instructions.

Delivery requires compatible API code before the grouped native binary. Existing binaries never create this container; original single-photo behavior remains covered by regression tests. No remote-only group-original restoration or automatic publication is claimed.


## Native camera selection → canonical receipt intake (18 October 2026)

The strict device-only `copilotReceiptCameraSelectionSchema` uses mode `ONE_RECEIPT_CAMERA` and one to five existing receipt assets. It is an input to the native adapter, never a new API payload or business entity. Native captures require a local file URI, positive pixel dimensions and JPEG/PNG format; only URI/dimensions/format enter review state, with no EXIF/base64 payload. Expo orientation processing remains enabled. One asset dispatches to the existing single-photo capture; two to five dispatch to the ordered-view capture from PR 248. Existing size limits, scoped ownership/capacity checks and the transaction binding canonical receipt/source/file/upload with the private conversation draft all remain in force. No migration is added beyond existing version 45.

Review/capture state is ephemeral until explicit confirmation. Capture tokens fence late hardware results after interruption/close; failed replacement retains the previous image. Confirmation shares one promise and caches its successful result; role/abort authority is rechecked before durable intake. Failed copies/transactions retain originals and leave the review available to retry. These controls do not promise persistence of unconfirmed views after app termination. Confirmed canonical capture retains its existing offline/restart/idempotency guarantees. The server group contract from PR 248 is a prerequisite for the future multi-view client delivery; no server contract changes in this increment.


## Receipt correction capability 2 — catalogue association (18 October 2026)

`x-copilot-receipt-correction` accepts exactly `1` or `2`; absent/unsupported values expose no correction tool. The API client keeps boolean true as version 1 and explicitly supports numeric 2. Model input `receiptCorrectionInputSchema` is unchanged and rejects version/authority fields. The preview’s optional literal `schemaVersion: 2` is trusted host output; absence means version 1. Persisted `WASTE_CORRECTION_PROPOSAL.schemaVersion` accepts 1/2 and preserves the selected scope. The provider rejects returned versions not matching negotiated capability. Version 1 keeps candidate/current-match-only rules, including after an application upgrade.

For v2 ready previews, at most ten distinct requested product IDs must resolve to non-retired, non-deleted products of the authenticated store. Native review rechecks current product state and excludes ERROR/CONFLICT. The chosen full Product and up to twenty current validated, non-conflicted identifiers enter the fingerprint; a twenty-first code blocks rather than truncates identity. TO_REVIEW and UNKNOWN profile fields are allowed and do not become mandatory cleanup. At explicit confirmation the canonical receipt writer updates only draft association/label/nature, using null confidence for a newly selected non-candidate. It does not fabricate candidates or modify immutable extraction, Product metadata, alias memory or official observations. Existing private operation/result atomicity and publication protocols are reused; no migration or sync protocol change. The compatible API must precede the future native binary.


## Curated retail expertise — scoped read and citation snapshot (18 October 2026)

The shared strict input is `{topics: [...]}` with one or two distinct known enum values. The host supplies the reference edition and evaluation timestamp; every result card/evidence must exactly match the selected bundled edition. Edition `produce-retail.2026-10-18.v1` is reviewed from 18 October 2026 until the exclusive 18 April 2027 review deadline. Before/after that window, no usable cards/evidence are returned. An expired snapshot is not automatically re-dated or revalidated. Source content/scope changes require explicit version/edition review.

`copilotEvidenceSchema.retailExpertise` is optional, mutually exclusive with externalResearch and only valid for SOURCE_DOCUMENT/SOURCE_INSTRUCTION with exact `retail-expertise/{referenceId}/v{version}`, sourceId and positive sourceVersion. Metadata retains strict primary public URLs, publisher, country/study/access scope, nullable exact-day or month-only publication and review dates. It is not a canonical SourceDocument row, local KPI, store instruction or paid web journal. New clients negotiate exactly `x-copilot-retail-expertise: 1`; no header/unsupported values expose no reader. Existing boolean capabilities and all read budgets remain unchanged.

Server-produced `copilot-source:` links retain the reviewed citation in ordinary private message text. Existing private message ownership, immutable reply identity, replay, replication and local restoration apply; no new table/migration/Outbox command is introduced. Native decoding validates source kind/scope/public URLs and never fetches during render. The curated snapshot remains inspectable offline; opening the original primary URL is explicit and requires connectivity. Old ordinary and live-web citation formats stay supported. API compatible delivery precedes the future native binary.


## M7 — bounded descriptive action review (18 October 2026)

The optional SDK reader `commercial_action_review` takes `copilotActionReviewInputSchema`: known current-plan `weekStart`/`taskId`, one exact `productId`, explicit ordered before/during/nullable-after calendar ranges, aggregation SUM/AVERAGE and unique requested metrics. There is no model-supplied store/owner/decision/execution authority. Each window is at most 31 inclusive days and the whole span at most 93. Future ranges fail before database reads. The current-plan task must bind to that product's saved offers and the during range must fit their continuous covered dates. Historical/foreign/drifted targets are not rebound. Unknown/oversized/absent results do not query performance. These bounds apply to the combined review only; arbitrary-period analytics remains available separately.

The remote adapter reuses the shared checklist and existing scoped plan/task serializers, deterministic `readPeriodAnalysis` twice at most and `readFieldEvents` once (five-event page with cursor). Queries remain scoped/indexed with existing row/time bounds. Plan/declaration is reread before returning; differing reference values/coverage between comparisons refuse a mixed-reference result. Full cross-collection snapshot isolation is not claimed. Tool input, result periods/product/aggregation/metric coverage, exact declaration target, event dates/product/store and propagated evidence are checked by the SDK. Authorization precedes and follows the read; common read calls, context bytes and elapsed budget are unchanged. No new native capability header is required for this read-only tool and ordinary existing source citations.

One dated qualification evidence plus canonical comparison/event evidence becomes the existing private reply. Source links retain snapshot values and scope for offline reading; opening history does not recompute the result. No new table/collection/index/migration, business Outbox command, CRUD operation, accepted decision, physical execution or official causal KPI is introduced. Pending local-only data is not visible to this remote review. Archived-plan and persistent recommendation/decision linkage remain follow-up scope.


## M7 — private advice decision workflow (18 October 2026)

Conversational advice is represented by an immutable server-produced `RECOMMENDATION_TRACKING` message artifact, not by relabelling prose as a formally eligible operational candidate. Its strict basis retains source assistant ID, source time, SHA-256 of the canonical source message and exact quote. `recommendationTrackingIdentityPayload` binds store/owner/source conversation and basis; the digest derives the stable recommendation UUID. Presentation card IDs remain reply-specific. The same original advice therefore retains one per-user decision workflow after a new presentation. The private source message remains the auditable original; no official KPI snapshot is invented by this representation.

SQLite migration 46 creates `copilot_decisions(id,store_id,owner_id,conversation_id,payload_json,remote_payload_json,remote_version,sync_state,dirty)`. Mongo migration 39 indexes `copilotDecisions` by private scope/conversation and private UUID cursor, and creates the unique store/owner scope index for `copilotDecisionCounters`. `recommendationDecisionSchema` requires ID=recommendationId, the basis digest, source-advice creation anchor, up to fifty ordered revisions, latest update time and exact revision count/version. Each revision records choice, reviewed proposal-message ID, decision timestamp, optional reason and only the applicable modified-action or postponed calendar date. This is not an action execution entity. No business date, effective price, product classification or execution status is inferred from a choice.

`COPILOT_DECISION_UPSERT` / `copilot_decision` uses the existing private processed-command actor checks, versioned Outbox and incremental synchronization. Server validation requires an owned current source/card and exact digest, active/unhidden source topic, preserved identity/history prefix and version+1. The native editor validates the immutable synced card and current review fingerprint. A missing full local original does not destroy a captured intent; it remains based on the saved card and must pass the full server proof. Conflicting devices retain both versions with explicit local/remote comparison; fresh remote data invalidates the comparison. Adoption can remain possible for an archived source, but a new local choice cannot be silently applied to such a source. Failed/cancelled writes roll back decision, history and Outbox together. Old conflict payloads and superseded commands are retained with a non-active supersession code.

Bootstrap and pull negotiate `copilotDecisions=true` in addition to `copilotHistory=true` and authenticated owner. Bootstrap returns optional `copilotDecisions` and `copilotDecisionOwnerId`; native adoption has its own owner/store marker. The type participates in the existing private serializer, pre-replay authorization, failed-command/conflict ownership filters and version-specific acknowledgement. Legacy clients omit the flag and receive no decision entities. Pilot capacity is 500 workflows per owner/store, reserved through a transactional private counter before first creation; no history is silently removed. The native history and DTO cap revisions at fifty. These bounds are not a generic arbitrary-period analytics limit.

The separate capability header `x-copilot-recommendation-tracking: 1` exposes read/prepare model tools. `recommendation_tracking_preview` takes only source message ID and quote, never authority or a decision. `recommendation_decisions` takes nullable source-conversation/recommendation filters, nullable UUID cursor and limit 1–10. It returns latest choices, original basis where retained, history counts, source state and explicit page coverage; it does not revalidate current business facts or read the complete decision history into model context. State remains private to the same user/store across conversations. Mutation from a different conversation requires reopening the source conversation in this increment.

API delivery must precede the future compatible binary. Existing message source/deletion rules remain in force; explicitly recorded decisions are retained independently of hiding the conversation. No new paid service, provider, job worker or protocol-version replacement is introduced.


## M7 — selecting a private choice for a descriptive action review (18 October 2026)

`copilotActionReviewInputSchema` adds optional nullable `decision: { recommendationId: UUID, expectedVersion: 1..50 }`. Omission/null preserves the earlier task-only read. This is a selection, not decision/execution authority or a validated relationship. The API supplies the authenticated owner and scopes reads to that owner/store across owned conversations. Private content is not copied into the shared plan/task; no new persisted link is created.

The result adds optional nullable `decisionContext`, using `recommendationDecisionReadResultSchema` with exact UUID, no conversation filter/cursor, limit 1, no next page, one retained choice at most and its coverage evidence. A missing/foreign record gives `DECISION_UNAVAILABLE`; wrong expected version gives `DECISION_CHANGED`; an unverifiable source gives `DECISION_SOURCE_UNAVAILABLE`. These states keep task, comparisons and events null and do not read business facts. Archived/hidden but verifiable origins remain qualified historical context. The source state is not a business-fact validation. Re-reading the choice/source after the review detects changed revision/visibility/basis and refuses a mixed result. The leading review qualification and all decision/comparison/event evidence must survive typed scope validation, with at most 103 evidence items and unchanged SDK byte/time bounds. Existing task-only results lacking the optional field remain parseable. The API authorizes before and after; owner identifiers never come from the model.


## M7 — private decision/declaration association contract (18 October 2026)

This scoped association references the existing separate commercial execution task. It does not replace or complete the generic `action_executions` contract in §41. `copilotExecutionLinkSchema` contains id/proposalMessageId (the immutable server card UUID), authenticated storeId/ownerId, card conversationId, a snapshot with the exact decision id/version/source conversation/revision/original basis, plan week and complete declaration, confirmation `createdAt`, nullable `withdrawnAt`, and version 1/2. Version 1 requires no withdrawal; version 2 requires a withdrawal not before confirmation. The task belongs to the same store, the decision revision matches its version and weeks start Monday. All schemas are strict. Neither a choice nor a declaration is written by associating them.

SQLite migration 47 creates `copilot_execution_links(id PK, store_id, owner_id, conversation_id, payload_json, remote_payload_json, remote_version, sync_state, dirty)` and its owner-scoped index. Mongo migration 40 indexes `copilotExecutionLinks(storeId,ownerId,snapshot.decision.id,_id)` and the unique owner `copilotExecutionLinkCounters`. A transactional 500-record capacity check reserves creation; withdrawn records remain retained. The counter is not incremented for retries/withdrawals. Bootstrap refuses an overflow instead of truncating it.

Command `COPILOT_EXECUTION_LINK_UPSERT` / entity `copilot_execution_link`: stable card identity, version 1 with null expected version, then optional version 2 with expected version 1. Creation is authorized before replay, proves the owned immutable link card/snapshot/time, exact retained decision revision and original tracking basis, declaration current payload or retained `commercialExecutionHistory.plan`, and matching stored plan-revision week. A later decision/task revision is preserved and does not invalidate a previously confirmed historical association. Replaying the same card/core identity coalesces equivalent confirmations using the first canonical confirmation time; a withdrawn record cannot reactivate. Retraction only changes the withdrawal date/version and preserves all original references. Forged identity/foreign scope/invalid transitions fail without exposing remote private payloads. Storage/transient failures remain retryable through normal sync, not converted into permanent proof failures. Pending local retirement survives older pull/ack; no unsynchronized intent is pruned.

Opt-in bootstrap/pull flag `copilotExecutionLinks=true` is independent of earlier decision support and requires `copilotHistory=true` and the authenticated owner. Bootstrap emits `copilotExecutionLinks` plus `copilotExecutionLinkOwnerId`; the owner/store adoption marker forces initial collection on upgrade. Older clients see no association entities. API-client arguments are appended, preserving older positional parameters. The native private command queue, acknowledgement/error paths and diagnostics recognize the entity.

The API/model capability is `x-copilot-execution-links: 1`. `recommendation_execution_link_preview` accepts known recommendationId/decisionVersion and weekStart/taskId/taskVersion, with no actor/amount/permission fields. READY prepares an `EXECUTION_LINK_PROPOSAL` schema-version-1 card; it saves nothing. `recommendation_execution_links` accepts nullable recommendationId/afterId and limit 1..5, returns owned typed records with UUID pagination/coverage/evidence, never a chronological ranking. Withdrawal remains an explicit local action on the original active card, not a remote model write. Existing authentication before/after and model read/time/byte budgets remain unchanged. Cards and links are private; no private advice is copied into shared tasks.

## M7 — declared actual details of a commercial execution task (PR 256)

The separate `commercialExecutionTasks` entity can carry optional `actuals`: nullable `start` / `end` business dates (`YYYY-MM-DD`, Paris calendar), decimal EUR `price` string, `priceUnit` (`KG`, `PIECE`, `PACK`), and `location` (160 characters). Every subfield is present and nullable. Price and unit must be provided together; end requires start and cannot precede it. Dates cannot be future at declaration. Zero price is a known value, not missing.

Omitted `actuals` preserves existing details, including when an older client updates only status/note. Explicit null removes current details in a reviewed revision; complete preceding versions remain in execution history. No planned value, product unit, declaration timestamp or acceptance is copied to actuals. Status remains independent: reopening a task keeps declared details until explicit removal. These are user declarations, not sensor/payment-register verification.

Existing JSON payload columns and Mongo documents/history already support optional properties: no SQL table/index migration is needed. This increment does not replace the generic `action_executions` contract or cover arbitrary non-commercial actions.

Wire compatibility: `commercialExecutionActuals=true` on bootstrap/pull includes the optional field; bootstrap marks this capability in entities. Push uses optional boolean `commercialExecutionActuals` on the request envelope for acknowledgement/conflict/cached-response projection. Without capability, task wire entities omit actuals; stored canonical records/history remain complete. Native adoption bootstraps this capability even with an existing cursor. Never reorder existing API-client positional arguments; the flag is appended.

Chat preview uses `x-copilot-execution-actuals: 1` alongside execution-proposal capability. The same bounded preview tool accepts an actuals patch (only requested fields) only for capable clients. Omitted subfields retain prior values, nullable fields clear only after review, and price/unit remain paired after merging. It then requires explicit native confirmation and the canonical local writer/Outbox. Existing private decision/task associations retain their version-1 task snapshot shape (status, note, declaration timestamp and version), excluding new actuals; proofs compare this same projection on the historical task version. No association is retargeted or rewritten.

## M7 — private realizations of conversational advice (PR 257)

`actionExecutions` / SQLite `action_executions` are separate records for explicit user-reported actions beyond commercial-plan tasks. This first generic capture is private to account/store, matching the conversational advice/decision scope; it does not publish shared store execution tasks. An acceptance decision is not required or created. `recommendationId` is the same deterministic identity as tracking the exact source quote; `decisionId`, `plannedStart` and `plannedEnd` remain null rather than binding a later decision or inventing a plan.

The frozen snapshot contains the original recommendation basis (owned assistant message ID, creation time, digest and exact quote), an action description (1–1200 characters), nullable actual details using the commercial actuals contract, and nullable notes (1–1200). Missing real dates, price/unit and location remain null. Entity IDs equal their immutable proposal-message UUID. Status is `DECLARED_DONE` at version 1; explicit withdrawal is version 2 / `WITHDRAWN`, retaining the complete snapshot and first confirmation timestamp. A correction requires withdrawal and a new reviewed statement. Neither multiple cards nor statements are physical-action counts or sales effects.

The actor is verified before cached replay; the immutable owned server TOOL, original source digest/scope and recommendation identity are checked transactionally. A later hidden source can preserve already captured offline intent, but cannot produce a fresh preview. Two devices confirming the same card coalesce; withdrawal is one-way, and old create/replay cannot reactivate the canonical record. Capacity is 500 retained records per owner/store (including withdrawn), reserved transactionally in `actionExecutionCounters`; there is no pruning.

Mongo migration 41 indexes owned recommendation history/counters; SQLite migration 48 creates the local payload/remote-head/sync-state table. Mutation and Outbox command `COPILOT_ACTION_EXECUTION_UPSERT` / entity `copilot_action_execution` are atomic. Pending withdrawals survive older acknowledgements/pulls. History is private and included only with `copilotHistory=true`, `copilotActionExecutions=true`, authenticated owner and a matching bootstrap owner marker. Native adoption metadata is `copilot-action-executions:storeId:ownerId`. New query flags are appended to client method arguments; existing argument positions are unchanged.

`x-copilot-action-executions: 1` enables bounded preview/read tools and native artifacts. The read page has at most five statements, a UUID cursor, optional known recommendation filter and explicit local-only/page/history coverage. No arbitrary query, mutation by the model, financial recomputation or causal claim. API migration/capability must be delivered before the compatible native binary.
