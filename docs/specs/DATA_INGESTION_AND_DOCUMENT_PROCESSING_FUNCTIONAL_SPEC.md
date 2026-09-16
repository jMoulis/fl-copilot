# Data Ingestion & Document Processing Functional Specification

**Product:** Fruits & Vegetables Copilot  
**Document:** `DATA_INGESTION_AND_DOCUMENT_PROCESSING_FUNCTIONAL_SPEC.md`  
**Version:** 0.1  
**Date:** 16 September 2026  
**Specification language:** English  
**Application language:** French (`fr-FR`)  
**Primary user:** Fruits & Vegetables Department Manager — Intermarché  
**Scope:** Source ingestion, document storage, format detection, parsing, AI extraction, product matching, validation, deduplication, reconciliation, error handling, lineage, and publication of normalized business records to downstream engines.

---

# 1. Purpose

This document defines the **Data Ingestion & Document Processing subsystem** of the Fruits & Vegetables Copilot.

Its responsibility is to transform heterogeneous operational inputs into:

- traceable;
- validated;
- normalized;
- deduplicated;
- versioned;
- auditable

business records that can safely feed the Product, Analytics, Commercial Planning and AI Copilot engines.

The subsystem must handle five primary input families:

1. Mercalys Net Sales Excel;
2. Mercalys Waste Excel;
3. photographed waste receipts;
4. weekly commercial PDFs;
5. external context feeds such as weather and calendar data.

The ingestion layer is not an analytics engine.

It must not interpret commercial performance beyond what is required to:

- parse;
- normalize;
- validate;
- reconcile;
- publish trusted observations.

---

# 2. Core functional invariant

> **No source document or extracted field becomes business truth merely because it was successfully parsed.**

The ingestion lifecycle is:

```text
Source received
      ↓
Stored immutably
      ↓
Detected
      ↓
Parsed / extracted
      ↓
Normalized
      ↓
Matched
      ↓
Validated
      ↓
Reconciled
      ↓
Published
```

Only **published validated records** feed official KPIs and recommendations.

---

# 3. Architectural position

```text
Files / Photos / External APIs
        ↓
Data Ingestion & Document Processing
        ↓
Normalized business records
        ↓
Product & Substitution Engine
        ↓
KPI & Analytics Engine
        ↓
Commercial Planning Engine
        ↓
AI Copilot
```

---

# 4. Source types

Initial registry:

```ts
type SourceType =
  | "MERCALYS_SALES"
  | "MERCALYS_WASTE"
  | "WASTE_RECEIPT"
  | "WEEKLY_COMMERCIAL_PDF"
  | "WEATHER"
  | "PUBLIC_HOLIDAY"
  | "SCHOOL_HOLIDAY"
  | "MANUAL_EVENT"
  | "MANUAL_PRODUCT_DATA";
```

---

# 5. SourceDocument entity

All uploaded user-owned documents must be represented by a common source entity.

```ts
type SourceDocument = {
  id: string;

  storeId: string;

  sourceType: SourceType;

  originalFilename?: string | null;
  mimeType?: string | null;

  checksum?: string | null;

  fileSize?: number | null;

  importedAt: string;
  importedByUserId?: string | null;

  sourceGeneratedAt?: string | null;

  businessPeriodStart?: string | null;
  businessPeriodEnd?: string | null;

  status:
    | "UPLOADED"
    | "DETECTING"
    | "PARSING"
    | "EXTRACTING"
    | "TO_VALIDATE"
    | "VALIDATED"
    | "RECONCILING"
    | "PUBLISHED"
    | "FAILED"
    | "CANCELLED";

  versionGroupId?: string | null;
  versionNumber?: number | null;

  parserVersion?: string | null;
  extractionModelVersion?: string | null;

  createdAt: string;
  updatedAt: string;
};
```

---

# 6. Immutable original rule

The original source file must be retained unchanged.

Corrections to extracted or normalized data must never modify the original file.

The application must preserve:

```text
original document
+
parsed representation
+
validated normalized representation
```

---

# 7. Source checksum

A checksum should be generated for uploaded binary documents.

Use cases:

- exact duplicate detection;
- import idempotency;
- audit;
- troubleshooting.

Checksum identity alone does not solve overlapping-period reconciliation.

---

# 8. Import batch

```ts
type ImportBatch = {
  id: string;

  sourceDocumentId: string;

  storeId: string;

  sourceType: SourceType;

  status:
    | "CREATED"
    | "PROCESSING"
    | "TO_VALIDATE"
    | "RECONCILIATION_REQUIRED"
    | "PUBLISHED"
    | "FAILED"
    | "CANCELLED";

  totalSourceRecords?: number | null;

  parsedRecordCount: number;
  validRecordCount: number;
  warningRecordCount: number;
  errorRecordCount: number;

  startedAt?: string | null;
  completedAt?: string | null;

  failureReason?: string | null;
};
```

---

# 9. Source record

Every meaningful raw row or extracted element must remain individually traceable.

```ts
type SourceRecord = {
  id: string;

  importBatchId: string;
  sourceDocumentId: string;

  sourceIndex?: number | null;

  sourcePage?: number | null;

  rawPayload: unknown;

  normalizedPayload?: unknown | null;

  status:
    | "RAW"
    | "PARSED"
    | "VALID"
    | "WARNING"
    | "ERROR"
    | "IGNORED"
    | "PUBLISHED";

  errorCodes: string[];
  warningCodes: string[];

  createdAt: string;
  updatedAt: string;
};
```

---

# 10. File upload UX

French UI actions:

```text
Importer un fichier
Prendre une photo
Choisir une photo
Importer le PDF hebdo
```

The app should display:

- filename;
- detected source type;
- business period;
- number of records;
- validation status;
- issues to resolve.

---

# 11. File type detection

The system must detect:

- Excel;
- PDF;
- JPEG;
- PNG;
- HEIC if technically supported;
- unsupported file type.

Do not infer business source type only from file extension.

Example:

```text
.xlsx
```

may be:

- Mercalys sales;
- Mercalys waste;
- unsupported workbook.

---

# 12. Business format detection

For Mercalys Excel, detect source semantics using report content.

Expected signals may include:

```text
Statistique : Entrées / Sorties
Niveau de détail: Par Article
Détail Période: Par Jour
Flux: Vente Nette
```

or:

```text
Flux: Casse
```

---

# 13. Unsupported Mercalys format

If the uploaded workbook differs materially from the validated format:

```text
Format Mercalys non reconnu
```

The system must not guess column mappings silently.

It may:

- show detected columns;
- request manual mapping in a future version;
- reject the import for MVP.

---

# 14. Mercalys workbook parsing

The parser must identify:

```text
report metadata
selection period
business header row
article rows
report total row
line-count row
empty rows
empty worksheets
```

---

# 15. Mercalys business columns

Validated initial columns:

```text
ITM8 Prio
EAN Prio
Libellé
Date
Quantité
Valeur prix achat
Valeur RCE
Valeur prix vente
Valeur TVA
Val Marge
% Marge
```

Column names should be matched robustly against whitespace / formatting differences.

Do not silently remap semantically different columns.

---

# 16. Leading zero preservation

Identifiers such as:

```text
0000087003017
0000000003017
```

must remain strings.

Excel numeric coercion must not remove leading zeroes.

This requirement is critical.

---

# 17. Locale-aware numeric parsing

Mercalys values may be represented through spreadsheet numeric cells or locale-formatted text.

The parser must support:

```text
1.14
1,14
```

where source encoding requires it.

The normalized stored value uses numeric type, not localized string.

---

# 18. Date parsing

Article-row date is the business observation date.

The parser must support the validated source pattern, for example:

```text
15/04/2024
```

Store normalized ISO date:

```text
2024-04-15
```

---

# 19. Report generation date

A report may be generated long after the business period.

Example conceptual case:

```text
Report generated:
16/09/2026

Business observations:
15/04/2024
```

The ingestion system must keep both dates separately.

It must never assign report generation date to article observations.

---

# 20. Mercalys sales normalization

Each valid sales row becomes a normalized draft:

```ts
type NormalizedSalesRecord = {
  sourceRecordId: string;

  storeId: string;

  itm8?: string | null;
  ean?: string | null;

  rawLabel: string;

  businessDate: string;

  quantity: number;

  purchaseValue?: number | null;
  rceValue?: number | null;
  salesValue?: number | null;
  vatValue?: number | null;
  marginValue?: number | null;
  marginRate?: number | null;

  matchedProductId?: string | null;

  matchStatus:
    | "MATCHED"
    | "AMBIGUOUS"
    | "UNMATCHED";

  validationStatus:
    | "AUTO_VALID"
    | "TO_REVIEW"
    | "VALIDATED"
    | "REJECTED";
};
```

---

# 21. Mercalys waste normalization

The same row structure may feed waste.

```ts
type NormalizedMercalysWasteRecord = {
  sourceRecordId: string;

  storeId: string;

  itm8?: string | null;
  ean?: string | null;

  rawLabel: string;

  businessDate: string;

  quantity?: number | null;

  purchaseValue?: number | null;
  salesValue?: number | null;

  matchedProductId?: string | null;

  matchStatus:
    | "MATCHED"
    | "AMBIGUOUS"
    | "UNMATCHED";

  validationStatus:
    | "AUTO_VALID"
    | "TO_REVIEW"
    | "VALIDATED"
    | "REJECTED";
};
```

---

# 22. Report total handling

A Mercalys total row must be stored separately as import-control metadata.

Example:

```ts
type ImportControlTotals = {
  quantity?: number | null;
  purchaseValue?: number | null;
  rceValue?: number | null;
  salesValue?: number | null;
  vatValue?: number | null;
  marginValue?: number | null;
};
```

Do not publish this row as an article observation.

---

# 23. Line-count handling

A line such as:

```text
Nombre de Lignes : 27
```

must be recognized as report metadata.

Do not create a Product.

---

# 24. Import control reconciliation

The parser may compare calculated row totals with report totals.

Possible result:

```ts
type ImportControlResult = {
  field: string;

  calculatedValue?: number | null;
  reportedValue?: number | null;

  difference?: number | null;

  status:
    | "MATCH"
    | "WITHIN_TOLERANCE"
    | "MISMATCH"
    | "NOT_AVAILABLE";
};
```

---

# 25. Tolerance rules

Floating-point / accounting rounding may create tiny differences.

Tolerance must be configurable and deterministic.

Do not silently ignore large mismatches.

---

# 26. Mercalys import errors

Examples:

```text
Missing business header
Invalid date
Invalid quantity
Duplicate business row
Invalid identifier
Unparseable numeric value
Unexpected total mismatch
```

---

# 27. Exact duplicate document

If:

```text
checksum already imported
+
same store
+
same source type
```

show:

```text
Ce fichier a déjà été importé.
```

Do not publish duplicate observations.

---

# 28. Exact duplicate rows

Even when file checksum differs, source records may duplicate existing business observations.

Detection must use a source-specific fingerprint.

Example conceptual sales fingerprint:

```text
store
source type
business date
ITM8/EAN
raw source values
```

Exact technical fingerprint belongs to implementation specification.

---

# 29. Overlapping period import

A new Mercalys file may overlap an already-published business period.

This does not automatically mean duplicate.

The system must enter:

```text
RECONCILIATION_REQUIRED
```

when differences exist.

---

# 30. Reconciliation categories

For an overlapping import identify:

```text
UNCHANGED
ADDED
REMOVED
MODIFIED
AMBIGUOUS
```

---

# 31. Reconciliation summary

French UI example:

```text
Réconciliation nécessaire

152 lignes inchangées
3 lignes modifiées
2 nouvelles lignes
1 ligne absente du nouveau fichier
```

---

# 32. Modified row

A row is modified when the business identity is considered the same but one or more values changed.

Example:

```text
same product
same business date
quantity changed
```

The exact business key must be defined per source format.

---

# 33. Reconciliation decision

The user may choose a controlled action such as:

```text
Appliquer la nouvelle version
Conserver l'existant
Examiner les différences
Annuler l'import
```

Technical implementation may restrict available actions based on source type.

---

# 34. Reconciliation audit

Persist:

- previous source record;
- incoming source record;
- chosen action;
- user;
- timestamp.

Never destroy previous lineage.

---

# 35. Idempotent publication

Repeated publishing of the same validated import must not duplicate observations.

Publication must be idempotent.

---

# 36. Transactional publication

Where technically possible:

- publish an import atomically;
- avoid half-published datasets.

If partial publication is unavoidable:

status must clearly show incomplete state and support resume/rollback.

---

# 37. Interrupted import

If application or network interruption occurs:

the user should be able to resume.

Do not restart from zero if safely resumable.

Do not create duplicates on retry.

---

# 38. Import state visibility

French UI:

```text
Import en cours
Analyse du fichier
Rapprochement produits
À valider
Réconciliation nécessaire
Publié
Erreur
```

---

# 39. Product matching pipeline

Product matching is shared across:

- Mercalys;
- waste tickets;
- weekly PDF.

Recommended ranking order:

```text
Exact validated identifier
      ↓
Exact validated alias
      ↓
Canonical label
      ↓
Fuzzy / semantic candidate
      ↓
Human confirmation
```

---

# 40. Identifier-first matching

If a validated exact EAN / ITM8 / PLU match exists:

prefer it over semantic label matching.

Do not let fuzzy text override exact identity without a conflict warning.

---

# 41. Multiple identifier conflict

Example:

```text
ITM8 → Product A
EAN → Product B
```

This is a critical conflict.

Do not auto-match.

---

# 42. Exact alias matching

Approved ProductAlias may support auto-match.

Source-specific aliases may have higher confidence.

---

# 43. Fuzzy matching

Fuzzy / semantic matching may consider:

- normalized label;
- tokens;
- packaging;
- bulk/packaged terms;
- weight;
- category;
- known aliases.

It returns candidates, not truth.

---

# 44. Match candidate contract

```ts
type ProductMatchCandidate = {
  productId: string;

  score: number;

  reasons: string[];

  identifierMatch?: boolean;

  labelSimilarity?: number | null;
  packagingCompatibility?: number | null;
  natureCompatibility?: number | null;
};
```

---

# 45. Match confidence thresholds

Configurable states:

```text
AUTO_MATCH
REVIEW
AMBIGUOUS
NO_MATCH
```

Do not rely on one hardcoded threshold without configuration/versioning.

---

# 46. Human match confirmation

French UI:

```text
Produit détecté

POIRE CONFERENCE VRA
→ POIRE CONFERENCE VRAC

Confiance élevée

Confirmer
Modifier
```

---

# 47. Alias learning

After user confirms a repeated source label:

the system may propose creating a validated alias.

Example:

```text
POIRE CONFERENCE VRA
```

becomes alias of:

```text
POIRE CONFERENCE VRAC
```

---

# 48. Alias safety

Do not create alias when:

- ambiguous product;
- one source label maps to multiple products contextually;
- user explicitly rejects alias reuse.

---

# 49. Product creation from source

The system may create:

```text
Product.status = TO_REVIEW
```

for an unknown source product.

It must not invent category, nature, identifiers or packaging without marking them unvalidated.

---

# 50. Unknown product publication

Business observations may remain linked to a temporary review product or unresolved source record depending on implementation.

Official product-level analytics requiring classification must reflect unresolved status.

---

# 51. Waste receipt ingestion

The mobile workflow:

```text
Take photo
      ↓
Upload original
      ↓
Image normalization
      ↓
Vision extraction
      ↓
Structured receipt lines
      ↓
Arithmetic controls
      ↓
Product matching
      ↓
Human review
      ↓
Waste publication
```

---

# 52. Accepted image types

Target support:

```text
JPEG
PNG
HEIC
```

HEIC support may depend on runtime conversion.

If unsupported:

the UI must clearly ask for JPEG/PNG or convert server-side if available.

---

# 53. WasteReceipt entity

```ts
type WasteReceipt = {
  id: string;

  storeId: string;

  sourceDocumentId: string;

  captureDate?: string | null;

  confirmedWasteDate?: string | null;

  detectedReceiptDate?: string | null;

  status:
    | "UPLOADED"
    | "EXTRACTING"
    | "TO_VALIDATE"
    | "VALIDATED"
    | "PUBLISHED"
    | "FAILED";

  duplicateStatus:
    | "NOT_CHECKED"
    | "UNIQUE"
    | "POSSIBLE_DUPLICATE"
    | "CONFIRMED_DUPLICATE";

  createdAt: string;
};
```

---

# 54. Capture date is not waste date

The image metadata/upload date does not prove when waste occurred.

If receipt date is not reliably present:

the user must confirm the waste date.

---

# 55. Waste receipt Vision AI output

```ts
type ExtractedWasteLine = {
  sourceLineIndex: number;

  rawLabel: string;

  quantity?: number | null;
  weight?: number | null;

  quantityUnit?: string | null;

  unitPrice?: number | null;
  totalPrice?: number | null;

  extractionConfidence: {
    label: number;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
  };

  sourceRegion?: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
};
```

---

# 56. Vision AI must preserve uncertainty

Do not silently fill unreadable characters.

Use:

```text
unknown / uncertain
```

and request validation when critical.

---

# 57. Repeated waste lines

The same product can appear several times on the same receipt.

Do not treat these as duplicates automatically.

The UI may aggregate repeated compatible lines for convenience.

The raw occurrences remain stored.

---

# 58. Aggregated validation view

Example:

```text
FIGUE BIO BARQUETTE
8 occurrences
Total: 47,12 €
```

Opening detail should reveal the original 8 lines.

---

# 59. Waste arithmetic control

When available:

```text
weight × unit price ≈ total price
```

Check with rounding tolerance.

Example:

```text
0.580 kg × 4.99 €/kg ≈ 2.89 €
```

---

# 60. Arithmetic mismatch

If extracted values do not reconcile:

flag:

```text
Montant à vérifier
```

Do not silently change a value to force the equation.

---

# 61. Receipt-level total

If a usable total exists on receipt:

compare extracted line sum against total.

If absent:

do not invent one.

---

# 62. Waste line product nature

After product matching, inherit:

```text
BULK
PACKAGED
UNKNOWN
```

from Product.

Do not classify all photographed-ticket lines as BULK.

---

# 63. Packaged lines on waste receipt

Confirmed business rule:

> A photographed waste ticket may contain packaged/gencoded products, and these products must be treated as non-bulk waste even when they are absent from the Mercalys waste Excel.

The source remains:

```text
WASTE_RECEIPT
```

The product nature remains:

```text
PACKAGED
```

---

# 64. Waste ticket sales independence

Confirmed business rule:

> Waste ticket amounts do not appear in Mercalys Net Sales.

Therefore:

- publishing a waste ticket creates waste observations;
- it does not create negative sales;
- it does not modify imported net sales.

---

# 65. Waste cost from ticket

The ticket generally provides selling-price information, not purchase cost.

The ingestion subsystem must not set:

```text
purchaseCost = ticket price
```

---

# 66. Estimated purchase cost

A downstream/business service may find a compatible recent purchase cost.

If attached to waste observation:

```text
costQuality = ESTIMATED
```

with source lineage.

The ingestion layer preserves the original ticket values unchanged.

---

# 67. Waste receipt duplicate detection

Possible duplicate signals:

- same image checksum;
- perceptually similar image;
- same store;
- same date;
- same line set;
- same totals.

A possible duplicate requires review.

---

# 68. Duplicate receipt rule

Do not decide duplicate solely because:

```text
same product + same day
```

That can be legitimate repeated waste.

---

# 69. Cross-source waste reconciliation

Mercalys waste and waste tickets are different source channels.

The system must support reconciliation signals but not naive automatic deletion.

---

# 70. Confirmed current business process

Normally:

- waste receipt captures bulk;
- Mercalys waste captures packaged items.

However:

- packaged items may appear on receipt;
- these receipt packaged items may not appear in Mercalys waste Excel.

Therefore the ingestion design must not assume mutually exclusive channels purely by product nature.

---

# 71. Cross-source duplicate candidate

A potential duplicate may be suggested when:

- same product;
- same waste date;
- same/similar quantity;
- compatible value;
- process evidence suggests duplication.

It remains a candidate until reconciled.

---

# 72. Cross-source reconciliation outcome

Possible:

```text
DISTINCT
DUPLICATE_TICKET
DUPLICATE_MERCALYS
MERGED_REFERENCE
UNRESOLVED
```

The actual business rule may evolve with pilot evidence.

---

# 73. Weekly commercial PDF ingestion

Workflow:

```text
Upload PDF
      ↓
Store immutable original
      ↓
Page extraction / rendering
      ↓
Document AI
      ↓
Structured commercial blocks
      ↓
Product matching
      ↓
Duplicate / repeated-offer detection
      ↓
Critical-field validation
      ↓
Commercial publication
```

---

# 74. PDF page preservation

Every extracted item must retain page number.

Where possible also preserve:

- text span;
- visual bounding box;
- block ID.

---

# 75. PDF visual structure

The extractor must account for:

- multiple columns;
- tables;
- cards;
- text blocks;
- images with embedded text;
- page headers;
- repeated week labels;
- visual groupings.

Do not treat page text as one flat sequential paragraph when layout changes meaning.

---

# 76. Commercial extraction schema

Document AI should output candidates for:

```text
CommercialOperation
Offer
PreOrderWindow
DeliveryWindow
ExecutionInstruction
CommunicationInstruction
MerchandisingRecommendation
MarketSignal
ApplicabilityCondition
```

---

# 77. Commercial date extraction

Dates may refer to:

```text
sale period
pre-order period
delivery days
document week
future week
```

The extractor must label date semantics.

---

# 78. Date inference

If year is inferred from document context:

mark:

```text
INFERRED_TO_VALIDATE
```

until validation when material.

---

# 79. Price operator extraction

Must preserve:

```text
=
<
<=
from threshold
card benefit
lot
supplier discount
```

Do not normalize all into one numeric price.

---

# 80. Example strict ceiling

Source:

```text
Moins de 2,60 € le kg
```

Normalized:

```text
type = PRICE_CEILING
operator = LESS_THAN
amount = 2.60
unit = KG
```

---

# 81. Example threshold price

Source concept:

```text
3.49 €/kg
2.99 €/kg from 1 kg
```

Normalized into one conditional mechanism preserving both values.

---

# 82. Card benefit extraction

Source:

```text
20% avantage carte
```

Normalized:

```text
CARD_BENEFIT
PERCENT
20
```

Do not change actual till price.

---

# 83. Purchasing condition extraction

A supplier purchase discount is stored separately.

Example:

```text
-10% à l'achat
```

must not become:

```text
customer discount
```

---

# 84. Commercial operation de-duplication

The same offer may appear:

- detailed page;
- summary;
- TG recommendation page.

The ingestion layer must identify likely duplicates.

---

# 85. Repeated offer identity

Consider:

- product;
- sales dates;
- mechanism;
- amount;
- operation context.

If same offer:

attach multiple source references.

Do not create duplicate commercial events.

---

# 86. Commercial conflict

If apparent duplicates differ in:

- price;
- date;
- threshold;
- product identity;

flag conflict for human review.

---

# 87. PDF versioning

Corrected documents must be versioned.

Do not overwrite prior commercial extraction history.

---

# 88. PDF version reconciliation

Compare versions by structured objects.

Example:

```text
Offer unchanged
Offer price modified
Deadline changed
Operation removed
New operation
```

---

# 89. PDF review UI

French UI should allow:

```text
Document
↔
Données extraites
```

with quick navigation to source page.

---

# 90. Batch validation

Support:

```text
Valider les éléments fiables
Examiner les éléments incertains
```

Do not force line-by-line review of hundreds of high-confidence fields.

---

# 91. Mandatory commercial review

Require review for:

- ambiguous product;
- ambiguous price operator;
- conflicting offer;
- uncertain date;
- unclear applicability;
- duplicate conflict.

---

# 92. Context feed ingestion

Weather and calendars are structured external sources.

They should still be treated as source records with:

- provider;
- retrieval timestamp;
- valid date;
- source type;
- status.

---

# 93. Weather ingestion

Store separately:

```text
FORECAST
OBSERVED
```

Never overwrite a historical forecast with observed weather while losing the original forecast.

---

# 94. Weather record contract

```ts
type NormalizedWeatherRecord = {
  storeId: string;

  date: string;

  type:
    | "FORECAST"
    | "OBSERVED";

  temperatureMin?: number | null;
  temperatureMax?: number | null;
  rainfall?: number | null;

  provider: string;

  issuedAt?: string | null;
  retrievedAt: string;
};
```

---

# 95. Weather failure

Weather outage must not block:

- Mercalys imports;
- waste capture;
- PDF planning.

UI:

```text
Météo temporairement indisponible
```

---

# 96. Public holiday ingestion

Store explicit jurisdiction and date.

Do not infer store closure from public holiday alone.

---

# 97. School holiday ingestion

Store:

- territory/zone;
- start;
- end;
- source/provider.

Store configuration defines which zone applies.

---

# 98. Store location configuration

The weather/calendar reference location is the configured store.

Do not use mobile-phone current location for business analytics unless explicitly configured.

---

# 99. Manual event ingestion

Manual events include:

```text
TENSION
LOW_STOCK
OUT_OF_STOCK
QUALITY_ISSUE
PRICE_INCREASE
SUPPLIER_SHORTAGE
LOCAL_EVENT
STORE_EVENT
```

---

# 100. Manual event minimum fields

For product operational events:

```text
product
event type
start date/time
```

Optional:

```text
end date/time
severity
comment
```

---

# 101. Manual event validation

User-entered event is itself a validated store observation once saved by authorized user.

Still preserve:

- who;
- when;
- edits;
- source = USER.

---

# 102. Manual event editing

Edits must be audited.

Changing stockout duration may trigger downstream substitution reanalysis.

---

# 103. Validation framework

Validation operates at multiple levels:

```text
Document level
Record level
Field level
Business relationship level
```

---

# 104. Document-level validation

Examples:

- recognized format;
- readable file;
- store association;
- plausible period;
- no critical corruption.

---

# 105. Record-level validation

Examples:

- required fields present;
- numeric values parse;
- date valid;
- product match available or reviewable.

---

# 106. Field-level validation

Each AI-extracted field may have:

```text
value
confidence
validation status
```

---

# 107. Critical vs non-critical field

Critical examples:

```text
product identity
business date
quantity
selling price
waste amount
promo price
promo date
price operator
```

Non-critical examples:

```text
optional descriptive marketing sentence
```

---

# 108. Validation status

```ts
type ValidationStatus =
  | "AUTO_VALID"
  | "TO_REVIEW"
  | "VALIDATED"
  | "REJECTED";
```

---

# 109. Publication gate

A record may publish only when:

- critical validation passes;
- reconciliation is complete;
- no blocking conflict remains.

---

# 110. Partial publication

A document may contain some valid records and some unresolved records.

MVP policy can allow publishing valid records while unresolved records remain excluded.

The UI must make coverage visible.

---

# 111. Partial publication transparency

Example:

```text
Import publié partiellement

154 lignes publiées
3 lignes à corriger
```

Analytics must know the source is partial.

---

# 112. Error severity

```ts
type IssueSeverity =
  | "INFO"
  | "WARNING"
  | "BLOCKING";
```

---

# 113. Blocking error examples

- invalid format;
- business date unparseable;
- critical price conflict;
- identifier conflict;
- duplicate publication conflict.

---

# 114. Warning examples

- unknown category;
- low-confidence product match;
- total mismatch within review range;
- cost unavailable.

---

# 115. Error code registry

Use stable machine-readable codes.

Examples:

```text
FORMAT_UNRECOGNIZED
HEADER_NOT_FOUND
DATE_INVALID
NUMBER_INVALID
IDENTIFIER_CONFLICT
PRODUCT_UNMATCHED
PRODUCT_AMBIGUOUS
REPORT_TOTAL_MISMATCH
DOCUMENT_DUPLICATE
OVERLAPPING_IMPORT
RECONCILIATION_REQUIRED
RECEIPT_DUPLICATE_SUSPECTED
PRICE_OPERATOR_AMBIGUOUS
COMMERCIAL_CONFLICT
```

---

# 116. French issue messages

Error codes map to French UI.

Example:

```text
PRODUCT_AMBIGUOUS
→ Plusieurs produits peuvent correspondre.
```

---

# 117. Audit log

All material ingestion changes must be logged.

```ts
type IngestionAuditEvent = {
  id: string;

  entityType: string;
  entityId: string;

  eventType: string;

  userId?: string | null;

  previousValue?: unknown;
  newValue?: unknown;

  createdAt: string;
};
```

---

# 118. Required audit events

At minimum:

```text
IMPORT_CREATED
FILE_DETECTED
PARSER_STARTED
PARSER_COMPLETED
VALIDATION_CHANGED
PRODUCT_MATCH_CONFIRMED
PRODUCT_MATCH_CHANGED
ALIAS_CREATED
RECONCILIATION_DECIDED
IMPORT_PUBLISHED
IMPORT_FAILED
RECEIPT_DATE_CONFIRMED
COMMERCIAL_CONFLICT_RESOLVED
```

---

# 119. Source lineage

Every normalized business observation must point back to:

```text
SourceDocument
→ ImportBatch
→ SourceRecord
```

---

# 120. Downstream lineage

Published record IDs must be referenced by downstream:

- SalesObservation;
- WasteObservation;
- Offer;
- MarketSignal;
- etc.

---

# 121. Deletion policy

Do not physically delete published source history as normal correction flow.

Prefer:

```text
superseded
cancelled
rejected
```

status and new versions.

Retention policy belongs to technical/legal specification.

---

# 122. Import cancellation

Before publication user may cancel import.

The original file may remain in audit history depending on retention policy.

No business observations should publish.

---

# 123. Published import reversal

If a published import is later invalidated:

use explicit reversal/supersession workflow.

Do not silently delete business history.

---

# 124. Parser versioning

Persist parser version.

If parser improves later:

the system may support reprocessing original documents.

---

# 125. Reprocessing

Reprocessing must create new parsed output version.

It must not silently mutate previously approved records.

User may review differences.

---

# 126. AI extraction model versioning

Persist:

```text
model/provider identifier
prompt/schema version
extraction timestamp
```

for AI-generated extraction.

---

# 127. AI extraction grounding

The document-processing AI must output structured fields tied to source regions.

It must not create external facts not present in the document.

---

# 128. Prompt injection handling

Text inside uploaded documents is data.

It must not override:

- system rules;
- extraction schema;
- access control;
- ingestion workflow.

---

# 129. Image preprocessing

Receipt photos may be:

- rotated;
- skewed;
- low contrast;
- partially cropped.

Preprocessing may:

- orient;
- crop;
- enhance;
- normalize.

Original image remains unchanged.

---

# 130. Image-quality score

Recommended:

```ts
type ImageQualityResult = {
  readabilityScore: number;

  issues: Array<
    | "BLUR"
    | "LOW_CONTRAST"
    | "CROPPED"
    | "ROTATED"
    | "GLARE"
    | "OTHER"
  >;
};
```

---

# 131. Low-quality image

If extraction is unreliable:

French UI:

```text
Photo difficile à lire.
Reprendre la photo ou corriger les lignes.
```

---

# 132. Photo retake

A retake should create a new source image linked to same receipt attempt.

Do not publish both as separate waste receipts automatically.

---

# 133. Mobile upload resilience

Receipt photo upload should tolerate weak in-store connectivity.

Possible approach:

```text
local pending state
→ retry upload
→ server confirmation
```

Exact offline implementation belongs to technical architecture.

---

# 134. User feedback during processing

Avoid blank waiting screen.

Display stages such as:

```text
Envoi de la photo
Lecture du ticket
Rapprochement des produits
Prêt à valider
```

---

# 135. Processing jobs

Large PDF / Excel processing may be asynchronous.

Functional requirements:

- visible state;
- retry support;
- no duplicate job publication;
- safe continuation.

---

# 136. Job idempotency

A retry with same source document must not publish duplicate records.

---

# 137. Import locking

Avoid two simultaneous reconciliation decisions on the same overlapping data set.

Technical implementation should use concurrency control.

---

# 138. User permissions

At minimum:

```text
authorized store user
```

can upload and validate source data.

Future roles may separate:

- viewer;
- manager;
- admin.

---

# 139. Store isolation

Every source document, import batch and published record must belong to a store.

No cross-store leakage.

---

# 140. Document privacy

Uploaded:

- sales Excel;
- waste Excel;
- receipt photos;
- commercial PDFs

are private operational documents.

No public links by default.

---

# 141. External processing disclosure

If documents are sent to third-party AI/OCR providers:

the production architecture must explicitly document:

- provider;
- data transmitted;
- retention;
- region;
- security;
- privacy controls.

---

# 142. Data minimization

Only send the pages/images necessary for the extraction task where possible.

Do not expose unrelated store data to a model.

---

# 143. Ingestion output contracts

The ingestion subsystem publishes normalized domain objects.

---

# 144. Sales publication contract

```ts
type SalesObservation = {
  id: string;

  storeId: string;
  productId: string;

  date: string;

  quantity: number;

  purchaseValue?: number | null;
  rceValue?: number | null;
  salesValue?: number | null;
  vatValue?: number | null;
  marginValue?: number | null;
  marginRate?: number | null;

  sourceRecordId: string;

  publishedAt: string;
};
```

---

# 145. Waste publication contract

```ts
type WasteObservation = {
  id: string;

  storeId: string;
  productId: string;

  date: string;

  productNature:
    | "BULK"
    | "PACKAGED"
    | "UNKNOWN";

  quantity?: number | null;

  purchaseValueKnown?: number | null;
  purchaseValueEstimated?: number | null;
  salesValue?: number | null;

  sourceType:
    | "MERCALYS_WASTE"
    | "WASTE_RECEIPT";

  sourceRecordId: string;

  costQuality:
    | "KNOWN"
    | "ESTIMATED"
    | "UNKNOWN";

  publishedAt: string;
};
```

---

# 146. Commercial publication contracts

Publish structured:

```text
CommercialOperation
Offer
PreOrderWindow
DeliveryWindow
ExecutionInstruction
CommunicationInstruction
MerchandisingRecommendation
MarketSignal
ApplicabilityCondition
```

---

# 147. Product master update contract

Ingestion may create proposals for:

```text
new Product
new ProductAlias
new ProductIdentifier
packaging correction
nature classification
category proposal
```

Critical product changes must follow Product Master validation rules.

---

# 148. Need Unit / substitution proposals

Ingestion/document AI may identify product semantics useful to Product & Substitution Engine.

It may propose:

```text
Need Unit membership
Substitution candidate
```

It must not validate final behavioural relations.

---

# 149. Downstream invalidation events

When ingestion publishes/corrects records it should emit domain events conceptually equivalent to:

```text
SALES_DATA_CHANGED
WASTE_DATA_CHANGED
PRODUCT_MATCH_CHANGED
COMMERCIAL_PLAN_CHANGED
MARKET_SIGNAL_CHANGED
STORE_EVENT_CHANGED
```

These trigger downstream recomputation.

---

# 150. Recalculation scope

Events should include:

```text
store
affected dates
affected products
affected document/operation IDs
```

to enable scoped recomputation.

---

# 151. Ingestion dashboard

Under:

```text
Plus > Imports
```

show:

```text
Date
Source
Period
Status
Published records
Warnings
Errors
```

---

# 152. Import detail screen

Sections:

```text
Fichier
Métadonnées
Aperçu
Rapprochements
Erreurs
Réconciliation
Historique
```

---

# 153. Pending-work counter

French UI example:

```text
3 éléments à valider
```

This should link directly to unresolved issues.

---

# 154. Bulk review UX

For Excel:

allow efficient review of only:

- ambiguous products;
- invalid rows;
- reconciliation changes.

Do not force review of every valid line.

---

# 155. Receipt review UX

Receipt validation is more visual.

Show:

```text
source image
extracted lines
confidence warnings
product matches
```

---

# 156. PDF review UX

Show:

```text
page / source block
↔
structured offer / instruction
```

---

# 157. Import completeness

The ingestion layer should calculate:

```text
document parse completeness
record validation completeness
product match coverage
publication coverage
```

---

# 158. Publication coverage

Example:

```text
154 / 157 records published
```

Downstream data-quality engine can consume this.

---

# 159. Expected source cadence

Operational assumptions:

```text
Mercalys sales:
daily manual import

Mercalys waste:
periodic/daily manual import

Waste receipts:
as generated on field

Commercial PDF:
weekly

Weather:
automated recurring

Calendar:
automated / cached
```

Technical scheduling belongs to implementation spec.

---

# 160. Import freshness

Each source should expose latest published business date.

Useful for:

```text
latest complete day
```

determination.

---

# 161. Completeness coordination

Ingestion does not decide overall analytical completeness alone.

It provides source freshness/coverage to KPI Engine.

---

# 162. Failure isolation

One failing source must not block unrelated sources.

Example:

```text
PDF parser fails
```

must not block:

```text
daily Mercalys sales import
```

---

# 163. Retry policy

Transient failures may retry automatically.

Data/business validation errors require user action.

---

# 164. Permanent parse failure

French UI:

```text
Impossible de lire ce fichier avec le format actuel.
```

Offer:

```text
Réessayer
Voir les détails
Supprimer l'import en attente
```

---

# 165. No silent failure

No import may fail while dashboard still presents itself as fully current without warning.

---

# 166. Source-specific parser contract

Each parser should implement conceptually:

```ts
interface SourceParser<T> {
  detect(input): DetectionResult;
  parse(input): ParsedDocument<T>;
  validate(parsed): ValidationResult;
  normalize(parsed): NormalizedRecord[];
}
```

Exact code architecture is technical.

---

# 167. Source detector contract

```ts
type DetectionResult = {
  sourceType?: SourceType | null;

  confidence: number;

  formatVersion?: string | null;

  reasons: string[];

  status:
    | "DETECTED"
    | "AMBIGUOUS"
    | "UNSUPPORTED";
};
```

---

# 168. Detection ambiguity

If sales and waste flow cannot be distinguished:

do not guess.

Request user to confirm source type.

---

# 169. Schema version

Normalized record schemas should be versioned.

This supports future source format evolution.

---

# 170. Import metadata retention

Retain:

- source filename;
- checksum;
- store;
- source type;
- report selection period;
- report generation date;
- business period;
- imported by;
- imported at;
- parser version.

---

# 171. Time zone

Use configured store timezone for timestamps.

Business dates remain local-date semantics.

---

# 172. Monetary currency

Initial store currency:

```text
EUR
```

Do not infer from formatting only if future multi-country support exists.

---

# 173. Decimal precision

Preserve source numeric precision where practical.

Formatting/rounding is downstream/UI responsibility.

---

# 174. Raw source preservation

Never reconstruct original source solely from normalized values.

Keep raw source.

---

# 175. Parser regression protection

Create fixtures from the supplied example formats.

Required golden samples:

```text
Mercalys Net Sales example
Mercalys Waste example
Waste receipt example
Weekly Commercial PDF example
```

---

# 176. Golden Mercalys tests

Tests must verify:

- metadata lines ignored;
- correct header detection;
- article rows parsed;
- leading zeroes preserved;
- total row excluded;
- empty worksheets ignored;
- business date correct.

---

# 177. Golden waste ticket tests

Tests must verify:

- bulk line extraction;
- packaged line extraction;
- repeated lines preserved;
- weight × price validation;
- ambiguous line flagged;
- no implicit purchase cost;
- confirmed date required when absent.

---

# 178. Golden PDF tests

Tests must verify at least:

- multi-week dates;
- strict price ceiling;
- threshold pricing;
- card benefit;
- supplier discount;
- pre-order deadline;
- TG recommendation;
- market signal;
- repeated offer de-duplication.

---

# 179. Parser tests — exact duplicate

**Given:** same file uploaded twice.  
**Expected:** duplicate detected; no new published observations.

---

# 180. Parser tests — overlapping correction

**Given:** same date/product but changed quantity in later export.  
**Expected:** reconciliation, not blind addition.

---

# 181. Acceptance criteria

## DI-AC-01 — Sales source detection

**Given:** validated Mercalys Net Sales workbook.  
**Expected:** source type detected as `MERCALYS_SALES`.

---

## DI-AC-02 — Waste source detection

**Given:** validated Mercalys Casse workbook.  
**Expected:** source type detected as `MERCALYS_WASTE`.

---

## DI-AC-03 — Leading zeroes

**Given:** ITM8/EAN with leading zeroes.  
**Expected:** exact string preserved.

---

## DI-AC-04 — Business date

**Given:** report created in September 2026 containing April 2024 rows.  
**Expected:** observations published in April 2024.

---

## DI-AC-05 — Report total

**Given:** total line in waste workbook.  
**Expected:** used for control only; no product observation created.

---

## DI-AC-06 — Empty sheets

**Given:** empty workbook tabs.  
**Expected:** ignored without fake records.

---

## DI-AC-07 — Duplicate file

**Given:** same exact Excel imported twice.  
**Expected:** no duplicated observations.

---

## DI-AC-08 — Overlapping import

**Given:** corrected overlapping period.  
**Expected:** reconciliation summary shown.

---

## DI-AC-09 — Interrupted import

**Given:** network/process interruption.  
**Expected:** retry/resume does not duplicate publication.

---

## DI-AC-10 — Exact identifier matching

**Given:** EAN maps uniquely to Product A.  
**Expected:** A matched before fuzzy text candidates.

---

## DI-AC-11 — Identifier conflict

**Given:** ITM8 maps A and EAN maps B.  
**Expected:** critical review; no auto-match.

---

## DI-AC-12 — Alias learning

**Given:** user repeatedly confirms truncated label.  
**Expected:** system may propose validated alias reuse.

---

## DI-AC-13 — Unknown product

**Given:** no safe match.  
**Expected:** unresolved/TO_REVIEW product, no invented identity.

---

## DI-AC-14 — Receipt date

**Given:** ticket has no readable date.  
**Expected:** user must confirm waste date.

---

## DI-AC-15 — Receipt repeated lines

**Given:** same item appears eight times.  
**Expected:** eight raw occurrences preserved; UI may group them.

---

## DI-AC-16 — Ticket arithmetic

**Given:** 0.580 × 4.99 ≈ 2.89.  
**Expected:** arithmetic accepted within configured tolerance.

---

## DI-AC-17 — Ticket arithmetic mismatch

**Given:** extracted numbers do not reconcile.  
**Expected:** review warning; no silent correction.

---

## DI-AC-18 — Mixed receipt

**Given:** bulk tomato and packaged fig tray on same receipt.  
**Expected:** separate product-nature classification per line.

---

## DI-AC-19 — Packaged receipt waste

**Given:** packaged receipt item absent from Mercalys waste Excel.  
**Expected:** still published as packaged waste.

---

## DI-AC-20 — Waste does not alter sales

**Given:** €1,000 sales and €100 waste receipt.  
**Expected:** sales stay €1,000.

---

## DI-AC-21 — No ticket purchase-cost invention

**Given:** ticket has selling price only.  
**Expected:** purchase cost remains unknown/estimated by separate process, never copied from sales value.

---

## DI-AC-22 — Duplicate receipt photo

**Given:** same image uploaded twice.  
**Expected:** duplicate warning, no automatic double publication.

---

## DI-AC-23 — Cross-source same product/day

**Given:** same product appears in Mercalys waste and receipt.  
**Expected:** not automatically deleted as duplicate.

---

## DI-AC-24 — PDF source page

**Given:** extracted offer.  
**Expected:** page/source reference preserved.

---

## DI-AC-25 — Multi-week PDF

**Given:** PDF contains S38/S39/S40 operations.  
**Expected:** operation dates preserved independently from document header week.

---

## DI-AC-26 — Strict price ceiling

**Given:** “less than €2.60/kg”.  
**Expected:** `LESS_THAN`, not fixed €2.60.

---

## DI-AC-27 — Threshold pricing

**Given:** base price and lower price from 1 kg.  
**Expected:** both prices + threshold preserved.

---

## DI-AC-28 — Card benefit

**Given:** 20% card benefit.  
**Expected:** remains `CARD_BENEFIT`.

---

## DI-AC-29 — Supplier discount

**Given:** -10% purchase discount.  
**Expected:** purchasing condition, not customer promotion.

---

## DI-AC-30 — PDF duplicate summary

**Given:** same offer on detail and recap page.  
**Expected:** one normalized offer with multiple source references.

---

## DI-AC-31 — Corrected PDF

**Given:** new PDF version changes price/date.  
**Expected:** version comparison and review; previous data retained.

---

## DI-AC-32 — Forecast vs observed weather

**Given:** forecast then later observed weather.  
**Expected:** both records preserved separately.

---

## DI-AC-33 — Weather failure isolation

**Given:** weather provider unavailable.  
**Expected:** Excel/photo/PDF imports continue.

---

## DI-AC-34 — Partial publication

**Given:** 154 valid rows, 3 unresolved.  
**Expected:** policy-allowed valid rows may publish with visible partial status; unresolved rows excluded.

---

## DI-AC-35 — Downstream invalidation

**Given:** product match corrected.  
**Expected:** affected analytics/recommendations are marked for recomputation.

---

## DI-AC-36 — Audit history

**Given:** user changes a product match.  
**Expected:** previous and new match retained in audit trail.

---

## DI-AC-37 — Parser reprocessing

**Given:** new parser version.  
**Expected:** original source can be reprocessed without silently overwriting approved historical extraction.

---

## DI-AC-38 — AI extraction uncertainty

**Given:** low-confidence PDF price.  
**Expected:** field marked TO_REVIEW.

---

## DI-AC-39 — Prompt injection in document

**Given:** document text contains instructions unrelated to commercial data extraction.  
**Expected:** treated as document content, not system command.

---

## DI-AC-40 — French UI

**Given:** machine error `PRODUCT_AMBIGUOUS`.  
**Expected:** user receives understandable French message.

---

# 182. Data quality outputs to downstream engine

The ingestion layer should expose:

```text
salesImportCoverage
wasteImportCoverage
productMatchCoverage
commercialExtractionCoverage
validationCoverage
publicationCoverage
sourceFreshness
```

---

# 183. Source freshness

Recommended contract:

```ts
type SourceFreshness = {
  sourceType: SourceType;

  latestBusinessDate?: string | null;
  latestImportAt?: string | null;

  status:
    | "CURRENT"
    | "STALE"
    | "MISSING"
    | "PARTIAL";
};
```

---

# 184. Data quality handoff

KPI Engine uses ingestion quality but computes analytical quality separately.

Do not merge:

```text
Import quality
```

with:

```text
Analytical reference quality
```

---

# 185. Ingestion metrics

Operational metrics may include:

```text
parse success rate
product auto-match rate
manual review rate
duplicate detection count
reconciliation count
average processing time
```

These are system-operations metrics, not department-business KPIs.

---

# 186. Pilot observability

For the pilot, log enough detail to improve:

- parser;
- extraction schema;
- product matching;
- confidence thresholds.

Avoid logging unnecessary private document contents.

---

# 187. Manual correction ergonomics

A manager in the field should be able to correct:

- product;
- date;
- quantity;
- weight;
- price;
- amount;

with minimal taps.

---

# 188. Correction propagation

Changing a critical field before publication updates normalized draft.

Changing after publication triggers controlled correction/republication and downstream recomputation.

---

# 189. Product identity correction after publication

Example:

```text
Waste line incorrectly matched Product A
→ corrected to Product B
```

Requirements:

- preserve old match audit;
- update waste observation;
- recompute affected KPIs;
- re-evaluate substitution evidence if relevant.

---

# 190. Business date correction after publication

Requirements:

- move observation to corrected date;
- invalidate old date analytics;
- recompute new date analytics.

---

# 191. Import locking after closure

A closed/reconciled import should not be edited casually.

Use explicit correction workflow.

---

# 192. Source-document status UX

Recommended French labels:

```text
UPLOADED
→ Reçu

PARSING / EXTRACTING
→ Analyse en cours

TO_VALIDATE
→ À valider

VALIDATED
→ Validé

RECONCILING
→ À réconcilier

PUBLISHED
→ Publié

FAILED
→ Erreur
```

---

# 193. Import source labels

Recommended French labels:

```text
MERCALYS_SALES
→ Ventes Mercalys

MERCALYS_WASTE
→ Casse Mercalys

WASTE_RECEIPT
→ Ticket de casse

WEEKLY_COMMERCIAL_PDF
→ Communication commerciale

WEATHER
→ Météo
```

---

# 194. File limits

Technical spec must define:

- max file size;
- max Excel rows;
- max PDF pages;
- max image resolution;
- processing timeout.

Functional UI must provide clear error messages.

---

# 195. Malware / unsafe file handling

Production implementation must scan/reject unsafe uploaded files.

Do not execute embedded macros.

For XLSX, process data without running workbook code.

---

# 196. Spreadsheet formula handling

If cells contain formulas:

read displayed/computed values according to parser capabilities.

Do not execute arbitrary macros.

---

# 197. Hidden worksheets

Do not assume hidden worksheet content is business data.

Only validated Mercalys report sheets should be parsed.

---

# 198. Multi-sheet workbooks

Process the relevant detected worksheet.

Ignore unrelated empty/default sheets unless user explicitly maps them in future.

---

# 199. Localization

The source may contain French labels and decimal/date formatting.

Internal normalized schema remains locale-neutral.

---

# 200. API integration future-proofing

Manual imports are MVP.

The model should permit future source connection:

```text
Mercalys API / export automation
```

without changing downstream observation schemas.

---

# 201. Ingestion mode field

Recommended:

```ts
type IngestionMode =
  | "MANUAL_UPLOAD"
  | "MOBILE_CAPTURE"
  | "API"
  | "SCHEDULED_CONNECTOR";
```

---

# 202. Migration safety

Future automated feeds must coexist with historical manual imports.

Source lineage determines origin.

---

# 203. No source precedence assumption without rule

If future API and manual Excel overlap:

use explicit reconciliation policy.

Do not assume API always wins unless configured.

---

# 204. Business-source authority

Source authority can differ by domain.

Examples:

```text
Mercalys sales
→ authoritative sales source

User store event
→ authoritative field observation

Commercial PDF
→ authoritative enseigne communication
```

But authority does not remove need for validation/context.

---

# 205. Conflict policy

Conflicts between sources must be surfaced.

Example:

```text
PDF price = €2.99
Observed average price ≈ €3.49
```

This is downstream execution signal, not ingestion correction.

Do not rewrite source offer based on sales data.

---

# 206. Ingestion and analytics boundary

Ingestion responsibility:

```text
what the source says
```

Analytics responsibility:

```text
what the validated observations imply
```

Keep boundary strict.

---

# 207. Ingestion and AI boundary

AI extraction may read source.

Copilot AI should normally consume normalized published records.

Do not let the Copilot bypass unresolved ingestion warnings.

---

# 208. Blocking unresolved records

A record with critical unresolved ambiguity must not feed official recommendation facts.

---

# 209. Non-blocking source metadata

Descriptive non-critical text may remain unvalidated without blocking unrelated records.

---

# 210. Reconciliation policy versioning

If business rules evolve, persist reconciliation-policy version.

Historical decisions remain auditable.

---

# 211. Duplicate-detection versioning

Persist duplicate detection algorithm version for difficult cases.

---

# 212. Product-match versioning

Persist match-engine version and candidate score.

This helps tune pilot accuracy.

---

# 213. User-confirmation learning

Confirmed matches may improve:

- aliases;
- matcher weights;
- source-specific mappings.

Do not let learning overwrite explicit user rejections.

---

# 214. Rejected match rule

If user rejects:

```text
source label X → Product A
```

the system should remember this rejection in relevant context and avoid repeatedly auto-suggesting A without new evidence.

---

# 215. Product merge interaction

If Product records are later merged:

update ingestion references while preserving original source identities and audit lineage.

---

# 216. Product split interaction

If product split occurs:

affected published records may require review.

Do not redistribute automatically without explicit logic.

---

# 217. Commercial offer product change

If an extracted offer was matched to wrong product:

correct match;
recompute planning/analytics;
retain source raw label.

---

# 218. Receipt review completion

A receipt is considered ready to publish when:

- date confirmed;
- all required amounts/quantities valid enough;
- all critical lines matched or explicitly excluded;
- duplicate check resolved.

---

# 219. PDF review completion

A commercial document may be considered validated when:

- critical operations reviewed;
- ambiguous product matches resolved or excluded;
- conflicts resolved;
- applicability-relevant data preserved.

---

# 220. Excel review completion

Mercalys import can be auto-validated when:

- format recognized;
- totals reconcile;
- rows parse;
- product identity via identifiers is unambiguous;
- no overlapping conflict exists.

Otherwise review required.

---

# 221. Progressive automation target

Pilot objective:

```text
high-confidence clean imports
→ increasingly automatic

exceptions
→ human review
```

Do not remove human control from ambiguous cases.

---

# 222. Out of scope

Not required in Data Ingestion MVP v0.1:

- direct Mercalys API integration;
- email inbox auto-ingestion;
- autonomous network-drive crawling;
- competitor leaflet OCR;
- supplier EDI;
- receipt barcode scanning hardware integration;
- full OCR editor;
- generalized spreadsheet mapper for arbitrary formats;
- automatic corrections without review;
- automatic deletion of conflicting source data;
- advanced document workflow approval chains;
- multi-store bulk administration;
- legal archive / records-management certification.

---

# 223. Implementation guidance

Recommended service boundaries:

```text
Upload Service
      ↓
Source Detector
      ↓
Source-specific Parser / Extractor
      ↓
Normalization Layer
      ↓
Product Matching Service
      ↓
Validation Service
      ↓
Duplicate Detection
      ↓
Reconciliation Service
      ↓
Publication Service
      ↓
Domain Events
```

---

# 224. Do not build one universal parser

Different sources have different semantics.

Use source-specific processing:

```text
MercalysSalesParser
MercalysWasteParser
WasteReceiptExtractor
CommercialPdfExtractor
WeatherAdapter
CalendarAdapter
```

Shared components may include:

```text
ProductMatcher
ValidationFramework
SourceLineage
Audit
```

---

# 225. Testing strategy

Every source adapter requires:

- detection tests;
- parser tests;
- invalid input tests;
- duplicate tests;
- reconciliation tests;
- lineage tests;
- publication idempotency tests.

AI extractors additionally require:

- schema-validation tests;
- confidence tests;
- grounding/source-region tests.

---

# 226. Golden-source package

The development repository should contain anonymized golden fixtures based on the validated pilot examples:

```text
mercays-sales-example.xlsx
mercalys-waste-example.xlsx
waste-receipt-example.jpg
weekly-commercial-example.pdf
```

Names may differ.

Do not commit confidential originals unless explicitly authorized.

---

# 227. Golden expected outputs

Each fixture should have versioned expected normalized JSON.

This allows parser regression testing.

---

# 228. End-to-end sales fixture

Expected path:

```text
Excel
→ detected as sales
→ rows parsed
→ product matched
→ totals controlled
→ published SalesObservation
```

---

# 229. End-to-end waste receipt fixture

Expected path:

```text
Photo
→ lines extracted
→ repeated products preserved
→ bulk/packaged matched
→ date confirmed
→ waste published
```

---

# 230. End-to-end PDF fixture

Expected path:

```text
PDF
→ operations extracted
→ multi-week dates retained
→ mechanisms normalized
→ repeated offers merged
→ source pages linked
→ commercial objects published
```

---

# 231. Operational monitoring

Monitor:

```text
failed imports
parser exceptions
AI extraction failures
reconciliation backlog
unresolved match backlog
processing latency
```

---

# 232. Pilot success indicators

Useful system-quality metrics:

```text
% sales rows auto-matched
% waste lines auto-matched
% PDF critical fields accepted without correction
% receipt fields accepted without correction
duplicate detection precision
average manual corrections per import
```

These do not replace human quality review.

---

# 233. Definition of completion

The Data Ingestion & Document Processing MVP is complete when the following flows are reliable end to end.

### Mercalys sales

```text
Upload
→ Detect
→ Parse
→ Validate
→ Match products
→ Reconcile
→ Publish
```

### Mercalys waste

```text
Upload
→ Detect
→ Parse
→ Validate
→ Match products
→ Reconcile
→ Publish
```

### Waste receipt

```text
Take/import photo
→ Extract
→ Validate arithmetic
→ Match products
→ Confirm date
→ Resolve duplicates
→ Publish waste
```

### Weekly commercial PDF

```text
Upload
→ Extract structured commercial objects
→ Match products
→ Preserve price/date semantics
→ Deduplicate repeated offers
→ Validate critical fields
→ Publish commercial plan data
```

### Context

```text
Fetch weather/calendar
→ normalize
→ preserve provenance
→ publish context records
```

and when:

- duplicate imports do not duplicate business observations;
- overlapping imports require reconciliation;
- critical ambiguity blocks publication;
- source lineage is always available;
- downstream recomputation is triggered after correction;
- the user can see exactly which imports are complete, partial or unresolved.

---

# 234. Final functional invariant

The ingestion subsystem must always preserve the distinction between:

```text
Original source
Parsed source
Normalized record
Validated record
Published business observation
```

and between:

```text
Exact duplicate
Overlapping correction
Legitimate repeated business event
```

and between:

```text
Product identity
Product label
Product alias
Product nature
Source channel
```

and between:

```text
Report generation date
Business observation date
Import date
```

and between:

```text
Document extraction confidence
Human validation
Business truth
```

If these distinctions are collapsed, the implementation violates the functional design.
