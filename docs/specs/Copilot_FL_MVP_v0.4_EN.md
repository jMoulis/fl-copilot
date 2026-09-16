# Fruits & Vegetables Copilot — MVP v0.4

**Revision date:** 16 September 2026  
**Primary user:** Fruits & Vegetables Department Manager — Intermarché  
**Pilot scope:** One store  
**Product form:** Mobile-first application, also usable on desktop  
**Application language:** **French (`fr-FR`)**  
**Specification language:** English  
**Status:** Functional MVP specification intended for an AI development agent.

---

## 1. Product objective

The application is a **daily and weekly decision copilot for a Fruits & Vegetables department manager**.

Its purpose is to help the manager:

1. prepare the commercial week from Intermarché commercial communications;
2. understand sales, margin and waste performance;
3. identify operational issues and commercial opportunities;
4. account for weather, calendar, market tensions and store-level events;
5. reason about substitute products when a reference is under tension or out of stock;
6. prepare local promotions / counter-promotions;
7. select no more than **three main priorities** at a time;
8. measure the outcome of actions that were actually executed.

The MVP must remain useful **without advanced demand forecasting**.

The application must answer three core questions:

- **What should I prepare for the coming week?**
- **What happened in my department, and what may explain it?**
- **What action should I test, and how should I measure the result?**

The application proposes and documents.  
**The department manager remains the decision maker.**

The MVP must not automatically place orders, change prices, or modify Mercalys / Storeline / Drive settings.

---

# 2. Fundamental design principles

## 2.1 Separate source, product nature and business meaning

The following concepts must never be conflated:

### Data source
Examples:

- Mercalys net sales Excel
- Mercalys waste Excel
- photographed waste receipt
- weekly commercial PDF
- weather service
- user-entered store event

### Product nature

```ts
type ProductNature =
  | "BULK"
  | "PACKAGED"
  | "UNKNOWN";
```

### Product category

```ts
type ProductCategory =
  | "FRUIT"
  | "VEGETABLE"
  | "OTHER"
  | "UNKNOWN";
```

### Business observation type

Examples:

- sale
- waste
- commercial operation
- market tension
- store event
- weather observation
- substitution evidence

A photographed ticket can contain both bulk and packaged products.  
Therefore **the source of a waste record does not determine the product nature**.

---

## 2.2 Deterministic code owns business truth

> **AI extracts, matches, explains and recommends. Deterministic application code validates, calculates and stores business truth.**

AI may:

- read tickets;
- read weekly PDFs;
- propose product matches;
- summarize performance;
- identify possible explanations;
- propose substitute products;
- generate recommendations.

AI must not:

- invent missing numeric values;
- calculate authoritative KPIs by free-form reasoning;
- silently resolve critical ambiguities;
- infer a causal relationship from correlation;
- change imported business data without validation.

All KPI formulas and business rules must be implemented in deterministic, testable code.

---

## 2.3 Missing data is not zero

If an input required by an indicator is missing:

- show `Unavailable`, `Unknown`, or an equivalent French UI label;
- do not silently replace it with `0`;
- expose why the indicator is unavailable.

---

# 3. Source systems and inputs

## 3.1 S1 — Mercalys Net Sales Excel

The current example report is:

- report family: `Entrées / Sorties`
- detail level: `Par Article`
- period detail: `Par Jour`
- flow: `Vente Nette`
- valuation type: `PA`

Observed business columns include:

- `ITM8 Prio`
- `EAN Prio`
- `Libellé`
- `Date`
- `Quantité`
- `Valeur prix achat`
- `Valeur RCE`
- `Valeur prix vente`
- `Valeur TVA`
- `Val Marge`
- `% Marge`

### Important date rule

The report generation date is not the business observation date.

The import must use the date contained in the article rows as the sales observation date.

### Confirmed store rule

Waste tickets do **not** appear in `Vente Nette`.

Therefore:

> Adding, correcting or deleting a waste receipt must never modify imported net sales.

---

## 3.2 S2 — Mercalys Waste Excel

The current example uses the same article/day structure but the flow is:

`Casse`

It includes article-level waste lines and a report total.

The parser must:

- read only business article rows;
- ignore report titles;
- ignore empty worksheets;
- ignore report totals as business lines;
- preserve the report total separately for reconciliation.

The current operational process uses this export mainly for packaged / gencoded waste.

However, source channel and product nature must remain separate concepts.

---

## 3.3 S3 — Waste receipts photographed from the mobile app

The normal operational use is bulk waste, but a photographed receipt can also contain packaged / gencoded items.

Each receipt line must be classified independently.

Example:

```text
TOMATE GRAPPE VRAC
→ productNature = BULK

FIGUE BIO BARQUETTE
→ productNature = PACKAGED
```

Packaged products found on the ticket must be included in **non-bulk waste**, even if they do not appear in the Mercalys waste Excel.

### Confirmed sales rule

Waste receipts are independent from net sales.

A receipt worth €100 at selling price does not reduce €1,000 of imported net sales to €900.

---

## 3.4 S4 — Weekly commercial PDF

The weekly PDF is a major planning input.

It may contain information for multiple future weeks and must not be treated as a simple “promotion list”.

The extraction must preserve at least:

### Commercial operation nature

- prospectus
- coup de poing
- dramatization
- soutien à la production
- special range / special operation

### Customer mechanism

- fixed price
- strict price ceiling
- lot
- progressive / threshold price
- card benefit
- multi-buy mechanism

### Purchasing / commercial conditions

- PC
- packaging
- kit quantity
- supplier discount
- other explicitly stated conditions

### Communication

- national radio
- in-store radio
- prospectus
- POS material / PLV

### Merchandising

- TG / end-cap
- mass table
- cross merchandising
- recommended display grouping

### Execution instructions

- pre-order window
- delivery dates
- price / code checks
- Storeline parameter setting
- Drive activation

### Applicability

- prospectus commitment
- store-specific applicability
- product variants
- commercial conditions

### Market signals

- limited availability
- quality issue
- price increase
- supply shortage
- end of campaign

### Important rule

A single commercial operation may combine several dimensions.

For example:

```text
Prospectus
+ 20% card benefit
+ TG recommendation
+ radio communication
```

These must not be encoded as mutually exclusive promotion “types”.

---

## 3.5 S5 — Context data

Automatically retrieved in the MVP:

- observed weather;
- forecast weather;
- French public holidays;
- school holidays for the configured store area.

Manually recorded in the MVP:

- store events;
- local events;
- operational incidents;
- product tensions;
- low stock;
- stockout;
- quality issue;
- price increase;
- supplier shortage.

Market signals extracted from the weekly PDF also feed the contextual timeline.

---

# 4. Product master data

## 4.1 Product entity

```ts
type Product = {
  id: string;

  label: string;

  category: ProductCategory;
  nature: ProductNature;

  salesUnit: SalesUnit;

  packaging?: Packaging | null;

  familyId?: string | null;
  subfamilyId?: string | null;

  status: "ACTIVE" | "INACTIVE" | "TO_REVIEW";

  identifiers: ProductIdentifier[];
  aliases: ProductAlias[];
};
```

---

## 4.2 Product category

The application must distinguish at minimum:

```ts
type ProductCategory =
  | "FRUIT"
  | "VEGETABLE"
  | "OTHER"
  | "UNKNOWN";
```

This is separate from:

- bulk / packaged nature;
- family;
- subfamily;
- customer need;
- packaging.

Examples:

```text
Tomate ronde grappe
category = VEGETABLE
nature = BULK
```

```text
Pomme Gala sachet 1.5 kg
category = FRUIT
nature = PACKAGED
```

---

## 4.3 Product identifiers

```ts
type ProductIdentifier = {
  type: "ITM8" | "EAN" | "PLU";
  value: string;
};
```

All identifiers must be stored as strings.

Leading zeroes must be preserved.

Do not assume:

- PLU = last digits of EAN;
- ITM8 = EAN;
- one identifier can replace another.

---

## 4.4 Product aliases

Aliases are used for matching:

- ticket labels;
- shortened printed labels;
- PDF labels;
- Mercalys labels.

Example:

```text
Canonical:
POIRE CONFERENCE VRAC

Approved aliases:
POIRE CONFERENCE VRA
POIRE CONF VRAC
```

AI may propose an alias.

A proposed alias becomes trusted only after validation.

---

# 5. Packaging and sales unit

## 5.1 Packaging is structured data

Packaging is composed of:

- a quantity;
- a unit.

```ts
type Packaging = {
  quantity: number;
  unit:
    | "KG"
    | "G"
    | "PIECE"
    | "PACK"
    | "BAG"
    | "TRAY"
    | "NET"
    | "OTHER";
  sourceLabel?: string;
};
```

Examples:

```text
Pomme de terre filet 2.5 kg

packaging.quantity = 2.5
packaging.unit = KG
```

```text
Avocat lot de 3

packaging.quantity = 3
packaging.unit = PIECE
```

```text
Myrtille barquette 125 g

packaging.quantity = 125
packaging.unit = G
```

The original wording may be preserved in:

`packaging.sourceLabel`

---

## 5.2 Sales unit is different from packaging

Example:

```text
Pomme Gala sachet 1.5 kg

salesUnit = PIECE
packaging = 1.5 KG
```

This avoids confusing:

- one sold pack;
- 1.5 kg contained in that pack.

For bulk products:

```text
Tomate grappe vrac

nature = BULK
salesUnit = KG
packaging = null
```

---

# 6. Need Unit — customer purchase intent

## 6.1 Definition

**Need Unit is not an order quantity and not a packaging concept.**

A `NeedUnit` represents a **customer purchase intent or need that can be satisfied by several products**.

Example:

A customer wants “tomatoes”.

If round tomatoes are unavailable but Turino tomatoes are available, the customer may purchase Turino tomatoes because the underlying need was still “buy tomatoes”.

This is the purpose of Need Units.

---

## 6.2 NeedUnit entity

```ts
type NeedUnit = {
  id: string;
  code: string;
  name: string;
  description?: string;
  status: "ACTIVE" | "TO_REVIEW";
};
```

Examples:

```text
TOMATE_POLYVALENTE
SALADE
AGRUME_JUS
APERITIF
SNACKING
CUISINE
```

The final vocabulary must be editable and validated by the store/business owner.

---

## 6.3 Product membership is many-to-many

A product can belong to several customer needs.

```ts
type ProductNeedMembership = {
  productId: string;
  needUnitId: string;

  strength: number; // 0..1
  primary: boolean;

  source:
    | "MANUAL"
    | "AI_PROPOSED"
    | "LEARNED";

  confidence: number; // 0..1
};
```

Example:

```text
Tomate cerise
→ TOMATE
→ SALADE
→ APERITIF
→ SNACKING
```

Need Units must not be confused with product category.

`VEGETABLE` is a business taxonomy.

`TOMATE_POLYVALENTE` is a purchase-intent concept.

---

# 7. Product substitution network

## 7.1 Purpose

The application must model products as a substitution network.

A substitution means:

> If product A cannot satisfy the customer's need, product B may satisfy it instead.

The relationship is contextual and many-to-many.

It may also be asymmetric.

```text
A → B
does not automatically imply
B → A
```

---

## 7.2 ProductSubstitution entity

```ts
type ProductSubstitution = {
  id: string;

  sourceProductId: string;
  substituteProductId: string;

  needUnitId: string;

  needCompatibility: number;        // 0..1
  usageCompatibility: number;       // 0..1
  priceCompatibility: number;       // 0..1
  packagingCompatibility: number;   // 0..1

  observedSubstitution?: number | null; // 0..1

  relationshipScore: number;        // 0..1
  confidence: number;               // 0..1

  status:
    | "PROPOSED"
    | "VALIDATED"
    | "LEARNING"
    | "REJECTED";

  createdBy:
    | "USER"
    | "AI"
    | "SYSTEM";

  updatedAt: string;
};
```

---

## 7.3 Relationship score is not confidence

The system must always separate:

### Relationship score

How plausible / strong the substitution appears.

### Confidence

How much evidence supports that score.

Example:

```text
Tomate ronde → Turino

relationshipScore = 0.91
confidence = 0.22
```

Interpretation:

> The relationship appears strong, but the store does not yet have enough observations to consider the score highly reliable.

After repeated consistent observations:

```text
relationshipScore = 0.87
confidence = 0.89
```

The relationship may become slightly less extreme while becoming much more trustworthy.

---

# 8. Substitution evidence and learning

## 8.1 Principle

Substitution relationships must be able to evolve from real store behaviour.

The learning loop is:

```text
Initial business relation
        ↓
Store event
        ↓
Observed sales response
        ↓
Evidence
        ↓
Relationship update
```

---

## 8.2 Structured store events

```ts
type StoreProductEventType =
  | "TENSION"
  | "LOW_STOCK"
  | "OUT_OF_STOCK"
  | "QUALITY_ISSUE"
  | "PRICE_INCREASE"
  | "SUPPLIER_SHORTAGE";
```

```ts
type StoreProductEvent = {
  id: string;

  storeId: string;
  productId: string;

  type: StoreProductEventType;

  startedAt: string;
  endedAt?: string | null;

  severity?: "LOW" | "MEDIUM" | "HIGH";

  source:
    | "USER"
    | "COMMERCIAL_PDF";

  comment?: string;
};
```

A market tension extracted from the commercial PDF is not equivalent to a store-level stockout entered by the department manager.

Both must remain distinct and traceable.

---

## 8.3 SubstitutionEvidence entity

```ts
type SubstitutionEvidence = {
  id: string;

  sourceProductId: string;
  candidateSubstituteProductId: string;
  needUnitId: string;

  eventId: string;

  observationStart: string;
  observationEnd: string;

  referenceMethod: string;

  expectedSales?: number | null;
  observedSales?: number | null;
  observedVariation?: number | null;

  concurrentCommercialOperations: string[];
  concurrentStoreEvents: string[];

  weatherContextId?: string | null;

  evidenceStrength: number; // 0..1
  dataQuality: number;       // 0..1

  interpretation:
    | "SUPPORTS_SUBSTITUTION"
    | "NEUTRAL"
    | "CONTRADICTS_SUBSTITUTION";

  createdAt: string;
};
```

---

## 8.4 Evidence must not be treated as causality

If product A is out of stock and sales of product B increase, the application may state:

> “This observation is compatible with substitution from A to B.”

It must not automatically state:

> “The stockout of A caused the increase in B.”

Concurrent factors must remain visible, such as:

- promotion on B;
- TG / end-cap;
- weather;
- another stockout;
- price change;
- special event.

---

## 8.5 Relationship updates

Multiple compatible observations may update:

- `observedSubstitution`;
- `relationshipScore`;
- `confidence`.

The update mechanism must be deterministic and auditable.

Every score update must remain traceable to its `SubstitutionEvidence` records.

A single event must not create excessive score movement.

The MVP may use a conservative weighted update rather than machine learning.

---

# 9. Mercalys sales import pipeline

```text
Mercalys Excel
      ↓
Format detection
      ↓
Metadata extraction
      ↓
Business row parsing
      ↓
Product matching
      ↓
Validation
      ↓
SalesObservation
      ↓
Deterministic controls
      ↓
Analytics
```

---

## 9.1 SalesObservation

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
};
```

Raw Mercalys values must be preserved.

Do not rename source values to normalized HT/TTC business concepts before the business dictionary is confirmed.

---

# 10. Import idempotency and reconciliation

## 10.1 Identical import

If the same file is imported twice:

- detect the duplicate;
- do not duplicate business observations;
- keep an audit trail.

## 10.2 Overlapping corrected import

If a second file covers an existing period but differs:

show a reconciliation summary such as:

```text
152 unchanged rows
3 modified rows
2 new rows
1 removed row
```

The user must be able to review the reconciliation before publication.

Never blindly add overlapping business rows.

---

# 11. Waste model

## 11.1 WasteObservation

```ts
type WasteObservation = {
  id: string;

  storeId: string;
  productId: string;

  date: string;

  productNature: ProductNature;

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

  validationStatus:
    | "DRAFT"
    | "VALIDATED"
    | "TO_REVIEW";
};
```

---

## 11.2 Waste receipt pipeline

```text
Photo
  ↓
Vision AI
  ↓
WasteReceipt
  ↓
WasteLine[]
  ↓
Product matching
  ↓
Field confidence review
  ↓
Human validation
  ↓
WasteObservation[]
```

---

## 11.3 WasteLine

```ts
type WasteLine = {
  id: string;

  receiptId: string;

  rawLabel: string;

  quantity?: number | null;
  weight?: number | null;

  unitPrice?: number | null;
  totalPrice?: number | null;

  matchedProductId?: string | null;

  matchConfidence?: number | null;

  matchStatus:
    | "MATCHED"
    | "AMBIGUOUS"
    | "UNMATCHED";

  productNature:
    | "BULK"
    | "PACKAGED"
    | "UNKNOWN";

  sourceImageRegion?: string | null;
};
```

Repeated lines may be grouped in the UI if article, unit and price are compatible.

Original lines must remain stored.

---

## 11.4 Waste classification rule

```text
TOTAL WASTE
│
├── BULK
│   └── all validated BULK lines
│
└── NON-BULK
    ├── PACKAGED lines from Mercalys waste
    └── PACKAGED lines from photographed receipts
```

Again:

> The source channel does not define product nature.

---

# 12. Waste valuation rules

The application must keep separate:

### Purchase-cost waste

Economic cost of discarded goods.

### Selling-price waste

Selling-price value attached to discarded goods.

These are different business indicators.

Do not combine them.

---

## 12.1 Unknown purchase cost

A selling price found on a receipt does not imply a known purchase cost.

A recent compatible Mercalys purchase cost may be proposed as an estimate.

If used:

```text
costQuality = ESTIMATED
```

The exact source and date must be stored.

If no reliable cost exists:

```text
Purchase cost = UNKNOWN
```

Never use zero as a fallback.

---

# 13. Commercial PDF model

## 13.1 SourceDocument

Every imported source document must preserve:

```ts
type SourceDocument = {
  id: string;
  storeId: string;

  sourceType:
    | "MERCALYS_SALES"
    | "MERCALYS_WASTE"
    | "WASTE_RECEIPT"
    | "WEEKLY_COMMERCIAL_PDF"
    | "MANUAL";

  originalFilename: string;
  checksum: string;

  importedAt: string;

  documentDate?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;

  status:
    | "UPLOADED"
    | "PARSING"
    | "TO_VALIDATE"
    | "VALIDATED"
    | "ERROR";
};
```

The original file must be retained.

---

## 13.2 CommercialOperation

```ts
type CommercialOperation = {
  id: string;

  sourceDocumentId: string;

  name: string;

  operationNature: string[];

  saleStart?: string | null;
  saleEnd?: string | null;

  applicabilityStatus:
    | "TO_VALIDATE"
    | "APPLICABLE"
    | "NOT_APPLICABLE";

  executionStatus:
    | "RECEIVED"
    | "PLANNED"
    | "EXECUTED"
    | "CANCELLED";
};
```

---

## 13.3 Offer

The application must preserve:

- product;
- reference price;
- promotional price;
- price operator;
- unit;
- threshold;
- lot size;
- card advantage;
- exact condition.

Examples that must remain distinct:

```text
€2.99/kg
< €2.60/kg
€2.99/kg from 1 kg
20% card benefit
3 items for €X
```

---

## 13.4 Source traceability

Every extracted commercial fact must remain linked to:

- source document;
- page;
- source block / excerpt when possible.

The UI must support:

**“View source”**

AI extraction is always a draft until critical fields are validated.

---

# 14. Weather, calendar and context

## 14.1 WeatherRecord

```ts
type WeatherRecord = {
  id: string;

  storeId: string;
  date: string;

  recordType:
    | "FORECAST"
    | "OBSERVED";

  temperatureMin?: number | null;
  temperatureMax?: number | null;
  rainfall?: number | null;

  provider: string;
  retrievedAt: string;

  issuedAt?: string | null;
};
```

A forecast must never be silently replaced by historical observed weather while pretending it is the original forecast.

---

# 15. Daily product analytical view

The central analytical read model is:

```ts
type ProductDailyPerformance = {
  storeId: string;
  productId: string;
  date: string;

  sales: {
    quantity?: number | null;
    salesValue?: number | null;
    purchaseValue?: number | null;
    marginValue?: number | null;
    marginRate?: number | null;
  };

  waste: {
    quantity?: number | null;
    purchaseValueKnown?: number | null;
    purchaseValueEstimated?: number | null;
    salesValue?: number | null;
  };

  commercialOperationIds: string[];
  merchandisingPlanIds: string[];

  contextEventIds: string[];
  marketSignalIds: string[];

  weatherRecordId?: string | null;
};
```

This is a reconstructed analytical view.

It is **not the source of truth**.

---

# 16. KPI catalogue — MVP

## 16.1 Core performance KPIs

At minimum:

- sales value;
- sold quantity;
- purchase value;
- source margin value;
- source margin rate;
- known purchase-cost waste;
- estimated purchase-cost waste;
- selling-price waste value;
- number of products sold;
- number of products with waste;
- data completeness.

---

## 16.2 Comparison references

Supported references:

- J-7;
- previous comparable week;
- average of previous comparable weekdays when sufficient data exists;
- N-1 when history exists;
- before-operation reference period.

If the reference is unavailable:

show `Unavailable`.

---

## 16.3 Contribution to change

The application must rank products by economic contribution to the observed change.

Example:

```text
current sales value - reference sales value
```

This is more important than ranking only by percentage change.

The same principle may be used for:

- sales contribution;
- margin contribution;
- waste contribution.

---

## 16.4 Waste indicators

Where mathematically valid:

### Purchase-cost waste rate

```text
known purchase-cost waste / sales value
```

### Selling-price waste ratio

```text
selling-price waste / sales value
```

These are different metrics and must be named explicitly.

### Share of known outputs wasted

Only when sales and waste use compatible units:

```text
waste quantity / (sold quantity + waste quantity)
```

This is not a stock-loss rate.

---

## 16.5 Promotion analysis

For executed operations, compare:

```text
BEFORE
DURING
AFTER
```

Using comparable durations where possible.

Display at minimum:

- sales value;
- quantity;
- purchase value;
- margin;
- margin rate;
- purchase-cost waste;
- waste quantity;
- average realized price when valid.

Always expose concurrent context.

Do not state causal uplift unless a valid causal method exists.

---

# 17. Counter-promotion support

The MVP may support local promotion / counter-promotion scenarios.

The application may compare:

- selected product;
- current price;
- proposed price;
- purchase cost;
- margin per unit;
- required volume to preserve current gross margin;
- nearby substitute products;
- competing simultaneous operations;
- waste;
- market tension;
- store-level tension.

The application must **not invent price elasticity**.

Example deterministic calculation:

```text
Required volume
=
Current gross margin amount / New gross margin per unit
```

The result is a threshold, not a sales forecast.

---

# 18. Substitution-aware recommendations

This is a core v0.4 capability.

When a product is under tension, low stock or out of stock, the recommendation engine must:

1. identify relevant Need Units;
2. retrieve candidate substitutes;
3. retrieve substitution scores and confidence;
4. compare price;
5. compare margin;
6. compare packaging;
7. inspect current promotions;
8. inspect recent waste;
9. inspect market signals;
10. inspect previous substitution evidence;
11. propose one or more actions.

Example:

```text
Tension expected on round tomatoes.

Need Unit:
TOMATE_POLYVALENTE

Potential substitutes:

1. Turino tomatoes
   Need compatibility: high
   Price proximity: high
   Margin: favorable
   Observed substitution: strong
   Confidence: medium

2. Ribbed tomatoes
   Need compatibility: high
   Price proximity: medium
   Margin: lower
   Observed substitution: moderate

3. Cherry tomatoes
   Need compatibility: partial
   Price proximity: low
   Observed substitution: weak
```

Possible recommendation:

> Reinforce Turino visibility next to the round tomato location and monitor its availability during the tension period.

---

# 19. Recommendation contract

Every AI recommendation must contain:

- factual observations;
- source references;
- interpretation separated from facts;
- proposed action;
- intended objective;
- expected qualitative impact or explicit scenario;
- risks;
- constraints;
- confidence;
- missing data;
- measurement method;
- measurement date.

Maximum:

**3 main priorities at a time.**

A recommendation may be:

- verify stock;
- validate till configuration;
- reinforce display;
- move a substitute closer;
- reduce local price;
- avoid simultaneous promotion;
- monitor a high-waste product.

It must not always be a pricing action.

---

# 20. AI capabilities in the MVP

## AI-1 — Waste receipt vision

Purpose:

- read photographed waste receipts;
- extract structured lines;
- identify quantity / weight / price / amount;
- propose product matching;
- flag ambiguity.

Human validation remains required for critical fields.

---

## AI-2 — Weekly commercial document understanding

Purpose:

- parse weekly commercial PDFs;
- extract operations;
- extract dates;
- extract pricing mechanisms;
- extract execution instructions;
- extract merchandising recommendations;
- extract market signals;
- preserve source traceability.

---

## AI-3 — Business analysis and synthesis

Purpose:

- daily summary;
- weekly summary;
- product analysis;
- commercial-operation analysis;
- explain major changes using available facts and context.

The AI must distinguish:

- facts;
- correlations;
- hypotheses;
- recommendations.

---

## AI-4 — Commercial recommendation assistant

Purpose:

- select relevant issues / opportunities;
- use sales, waste, promotions, weather, events and substitution relationships;
- propose actions;
- limit output to the three most important priorities.

---

## AI-5 — Substitution relationship assistant

Purpose:

- propose Need Unit memberships;
- propose substitute relationships;
- explain why products may be substitutes;
- use price / usage / packaging / margin context;
- generate candidate links for human validation.

The final relationship score must be managed by deterministic application logic.

---

# 21. Main mobile navigation

The application UI is in French.

Bottom navigation:

```text
Aujourd’hui
Ma semaine
Analyses
Casse
Plus
```

---

## 21.1 Aujourd’hui

Displays:

- latest complete business date;
- data completeness;
- sales;
- margin;
- waste;
- main positive / negative contributors;
- current context;
- current product tensions;
- maximum three priorities.

The app must never show “yesterday” if yesterday’s data has not been imported.

---

## 21.2 Ma semaine

Displays:

- current week;
- next week;
- manually selected week;
- future commercial operations;
- pre-order deadlines;
- delivery dates;
- TG recommendations;
- price / code checks;
- Drive / Storeline tasks;
- market tensions;
- weather horizon;
- local actions;
- planned substitute strategies.

---

## 21.3 Analyses

Includes:

- product performance;
- category performance;
- validated family / subfamily views;
- waste;
- promotions;
- comparison periods;
- substitution behaviour;
- operation reviews.

---

## 21.4 Casse

Includes:

- take photo;
- import photo;
- ticket validation;
- bulk / non-bulk classification;
- unresolved products;
- possible duplicates;
- history.

---

## 21.5 Product sheet

The product sheet must display:

### Identity

- product label;
- Fruit / Vegetable / Other;
- Bulk / Packaged;
- ITM8;
- EAN;
- PLU;
- sales unit;
- packaging.

### Need Units

Examples:

- Tomate polyvalente;
- Salade;
- Cuisine.

### Substitute network

For each substitute:

- relationship score;
- confidence;
- price compatibility;
- margin comparison;
- evidence count;
- last evidence date.

### Performance

- sales;
- quantity;
- margin;
- waste;
- comparison;
- operations;
- context.

### Observed substitution behaviour

Example:

```text
4 tension events analysed

Turino:
strong substitution signal

Ribbed tomato:
moderate signal

Cherry tomato:
weak signal
```

---

# 22. User decisions and execution tracking

Recommendations can be:

- accepted;
- modified;
- postponed;
- rejected.

Acceptance is not execution.

Execution must be recorded separately.

For an executed action, keep:

- actual date;
- actual price;
- actual location / TG;
- notes;
- execution status.

The review compares observed results to the selected baseline.

Concurrent events remain visible.

---

# 23. Data quality and confidence

The system should maintain quality indicators such as:

```text
salesDataCoverage
wasteDataCoverage
productMatchCoverage
costCoverage
commercialPlanValidation
weatherCoverage
referenceQuality
substitutionEvidenceQuality
```

AI output must reflect these limitations.

Example:

> “Waste analysis confidence is limited because only 78% of waste value currently has a reliable purchase cost.”

---

# 24. Security and reliability minimums

The MVP requires:

- authenticated account;
- private store data;
- private uploaded files;
- access control;
- import audit trail;
- correction history;
- secure original document storage;
- visible errors;
- no silent import failure;
- no public sharing by default.

External AI/document-processing providers must be documented in the technical architecture before production.

---

# 25. Acceptance criteria

## AC-01 — Duplicate sales import

**Given:** the same Mercalys Excel is imported twice.  
**Expected:** no duplicated sales observations.

---

## AC-02 — Corrected overlapping import

**Given:** a corrected file overlaps an existing period.  
**Expected:** explicit reconciliation before publication.

---

## AC-03 — Observation date vs report generation date

**Given:** a file generated in September 2026 contains observations from April 2024.  
**Expected:** observations remain attached to April 2024.

---

## AC-04 — Mercalys total rows

**Given:** waste report totals and empty sheets.  
**Expected:** no fake product is created; totals are used only for control.

---

## AC-05 — Ambiguous waste receipt

**Given:** a ticket with repeated lines, missing date or ambiguous label.  
**Expected:** original lines are preserved; critical ambiguity requires validation.

---

## AC-06 — Mixed bulk and packaged ticket

**Given:** one receipt contains bulk tomatoes and a packaged fruit tray.  
**Expected:** the first line is classified BULK and the second PACKAGED, regardless of the common source ticket.

---

## AC-07 — Packaged line on receipt

**Given:** a packaged item appears on a photographed waste receipt and does not exist in the Mercalys waste Excel.  
**Expected:** it is still included in non-bulk waste.

---

## AC-08 — Waste does not modify net sales

**Given:** €1,000 imported net sales and a €100 waste ticket.  
**Expected:** sales remain €1,000. Waste PV increases by €100.

---

## AC-09 — Weekly PDF contains multiple weeks

**Given:** one PDF contains week 38, 39 and 40 operations.  
**Expected:** each sales period and each pre-order deadline is stored separately.

---

## AC-10 — Price condition preservation

**Given:** `< €2.60/kg`, a lot, a threshold price, a card benefit.  
**Expected:** operator, unit, condition and mechanism remain distinct.

---

## AC-11 — PDF duplicate summary

**Given:** the same offer exists in a detailed page and a TG recap.  
**Expected:** one commercial offer linked to multiple source references, not duplicated.

---

## AC-12 — Announced vs executed promotion

**Given:** a national recommendation is imported but not executed in store.  
**Expected:** it is not treated as an executed promotion.

---

## AC-13 — Product category

**Given:** a packaged apple and bulk tomato.  
**Expected:** category and nature remain independent:

```text
Apple:
FRUIT + PACKAGED

Tomato:
VEGETABLE + BULK
```

---

## AC-14 — Packaging

**Given:** `Pomme Gala sachet 1.5 kg`.  
**Expected:**

```text
salesUnit = PIECE
packaging.quantity = 1.5
packaging.unit = KG
```

---

## AC-15 — Need Unit

**Given:** round tomato and Turino tomato.  
**Expected:** both can belong to `TOMATE_POLYVALENTE` without changing their product category.

---

## AC-16 — Many-to-many needs

**Given:** cherry tomato.  
**Expected:** it can belong to several Need Units such as TOMATE, SALADE and APERITIF.

---

## AC-17 — Substitution relation

**Given:** round tomato → Turino.  
**Expected:** the relationship stores a score and a separate confidence value.

---

## AC-18 — Asymmetric substitution

**Given:** A → B is validated.  
**Expected:** B → A is not automatically created with the same score.

---

## AC-19 — Store stockout event

**Given:** the user records an OUT_OF_STOCK event for product A.  
**Expected:** the system evaluates candidate substitutes belonging to relevant Need Units.

---

## AC-20 — Substitution evidence

**Given:** product B sales increase during A's stockout.  
**Expected:** a `SubstitutionEvidence` record may be created, but no causal claim is made automatically.

---

## AC-21 — Relationship learning

**Given:** several consistent substitution observations.  
**Expected:** relationship score and confidence may evolve conservatively and traceably.

---

## AC-22 — Single-event protection

**Given:** one exceptional event strongly favors a candidate substitute.  
**Expected:** relationship confidence remains limited and the score is not excessively over-adjusted.

---

## AC-23 — Promotion-aware substitution

**Given:** substitute B is simultaneously promoted during A's stockout.  
**Expected:** the concurrent promotion appears as a confounding factor in the evidence.

---

## AC-24 — Recommendation limit

**Given:** many anomalies and opportunities.  
**Expected:** the primary dashboard displays no more than three main recommendations.

---

## AC-25 — Missing data

**Given:** unavailable N-1, stock, cost or weather.  
**Expected:** the system displays missing / unavailable state and does not invent a value.

---

# 26. Out of MVP

The following are explicitly outside v0.4:

- advanced demand forecasting;
- automatic price elasticity learning;
- automatic order optimization;
- complete theoretical stock management;
- batch / lot traceability;
- causal measurement of weather impact;
- causal measurement of cannibalization;
- customer basket-level analysis;
- automatic competitor-price monitoring;
- exhaustive automatic local-event monitoring;
- autonomous execution in Mercalys;
- autonomous execution in Storeline;
- autonomous Drive changes;
- multi-store portal;
- general-purpose autonomous chat agent;
- fully context-dependent substitution models by season / hour / customer segment.

The data model should nevertheless avoid blocking future expansion.

---

# 27. Suggested implementation order

## Lot 1 — Data reliability

- store configuration;
- source document storage;
- Mercalys sales import;
- Mercalys waste import;
- product master;
- identifiers;
- aliases;
- category;
- nature;
- packaging;
- reconciliation;
- deterministic KPI engine.

---

## Lot 2 — Waste field workflow

- mobile receipt capture;
- AI extraction;
- product matching;
- bulk / packaged classification;
- ambiguity review;
- duplicate controls;
- waste consolidation.

---

## Lot 3 — Commercial preparation

- weekly PDF import;
- AI extraction;
- multi-week calendar;
- offer conditions;
- pre-order deadlines;
- execution instructions;
- TG recommendations;
- market signals.

---

## Lot 4 — Need Unit & substitution network

- NeedUnit management;
- many-to-many product memberships;
- AI-proposed substitute candidates;
- human validation;
- relationship score;
- confidence;
- product-sheet visualization.

---

## Lot 5 — Learning from field events

- structured product tension events;
- stockout events;
- quality events;
- SubstitutionEvidence;
- conservative score updates;
- confidence updates;
- evidence audit trail.

---

## Lot 6 — Decision layer

- weather and calendar context;
- daily synthesis;
- weekly synthesis;
- substitution-aware recommendations;
- counter-promotion support;
- decision tracking;
- execution tracking;
- post-action review.

---

# 28. Definition of MVP completion

The MVP is complete when the following end-to-end flows work reliably:

### Daily flow

```text
Import sales
→ import / capture waste
→ validate exceptions
→ view KPIs
→ view product tensions
→ receive max 3 priorities
→ record decision
→ record execution
→ review result
```

### Weekly flow

```text
Import weekly commercial PDF
→ validate extracted operations
→ review future tensions
→ review weather / calendar
→ inspect Need Units and substitutes
→ prepare TG / promotion / counter-promotion actions
→ validate weekly plan
→ execute
→ review result
```

### Learning flow

```text
Record tension / stockout
→ inspect substitute sales
→ create evidence
→ update substitution relationship
→ improve future recommendation confidence
```

A simple dashboard without the weekly preparation flow, waste workflow, and substitution-aware decision layer does **not** satisfy this MVP.
