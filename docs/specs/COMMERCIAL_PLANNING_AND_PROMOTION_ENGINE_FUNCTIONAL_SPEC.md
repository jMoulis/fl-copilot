# Commercial Planning & Promotion Engine Functional Specification

**Product:** Fruits & Vegetables Copilot  
**Document:** `COMMERCIAL_PLANNING_AND_PROMOTION_ENGINE_FUNCTIONAL_SPEC.md`  
**Version:** 0.1  
**Date:** 16 September 2026  
**Specification language:** English  
**Application language:** French (`fr-FR`)  
**Primary user:** Fruits & Vegetables Department Manager — Intermarché  
**Scope:** Weekly commercial PDF ingestion, operation extraction, offer modeling, planning calendar, TG / merchandising preparation, promotion execution tracking, counter-promotion support, context-aware planning, and substitution-aware commercial recommendations.

---

# 1. Purpose

This document defines the **Commercial Planning & Promotion Engine** for the Fruits & Vegetables Copilot.

The engine transforms weekly commercial communications into an actionable store plan.

Its goal is to answer:

- What operations are coming?
- Which products are concerned?
- When must I order?
- When will the offer run?
- What price or mechanism applies?
- Which TG / merchandising action is recommended?
- Which Storeline / Drive / till actions must be prepared?
- Which market tensions should influence the plan?
- Which substitutes should be reinforced when a promoted or strategic product is under tension?
- Which local counter-promotion opportunities should be considered?
- Did the store actually execute the planned operation?
- What happened during the operation?

The engine must preserve the difference between:

```text
Communication received
Planned store action
Actual store execution
Observed business result
```

These are four different stages.

---

# 2. Core functional principle

The weekly commercial PDF is not a simple promotion catalogue.

It may contain:

- several future weeks;
- product offers;
- price recommendations;
- strict price ceilings;
- card benefits;
- threshold pricing;
- lots;
- pre-order windows;
- delivery dates;
- TG recommendations;
- POS material instructions;
- Drive activation reminders;
- Storeline configuration instructions;
- national communication;
- market tensions;
- supply warnings;
- quality issues;
- end-of-campaign information;
- commercial themes;
- recommendations that may or may not apply to the pilot store.

The system must model these dimensions separately.

---

# 3. Main user workflow

The weekly planning flow is:

```text
Import weekly PDF
      ↓
AI extracts structured commercial content
      ↓
System groups / de-duplicates operations
      ↓
User validates critical fields
      ↓
Applicability to store is confirmed
      ↓
Store planning actions are created
      ↓
Weather / holidays / store events are overlaid
      ↓
Need Units / substitute network are evaluated
      ↓
AI proposes at most 3 weekly priorities
      ↓
User validates weekly plan
      ↓
Store executes actions
      ↓
Actual execution is recorded
      ↓
Analytics reviews observed results
```

---

# 4. Functional invariant

> **The presence of an operation in a PDF never proves that it was applicable, planned, or executed in the store.**

Every operation must therefore carry separate states for:

```text
received
validated
applicable
planned
executed
cancelled
```

---

# 5. Source document model

Every uploaded weekly commercial document is stored as a `SourceDocument`.

```ts
type SourceDocument = {
  id: string;
  storeId: string;

  sourceType: "WEEKLY_COMMERCIAL_PDF";

  originalFilename: string;
  checksum: string;

  importedAt: string;

  documentDate?: string | null;
  documentWeekLabel?: string | null;

  periodStart?: string | null;
  periodEnd?: string | null;

  status:
    | "UPLOADED"
    | "PARSING"
    | "TO_VALIDATE"
    | "VALIDATED"
    | "ERROR";

  versionGroupId?: string | null;
  versionNumber?: number | null;
};
```

The original file must be retained.

---

# 6. PDF versioning

A corrected weekly PDF may be received after a first version.

The system must not overwrite the original silently.

Recommended model:

```text
Week 38 communication
├── version 1
└── version 2
```

The latest validated version may become active, but previous versions remain auditable.

---

# 7. Commercial content extraction

The AI extraction layer must identify distinct content blocks.

At minimum:

```text
Commercial Operation
Offer
Execution Instruction
Merchandising Recommendation
Communication Instruction
Market Signal
Ordering / Pre-order Window
Delivery Window
Applicability Condition
```

Each extracted item must preserve its source page and source block.

---

# 8. Source traceability

Every extracted field that can materially affect planning must retain:

```ts
type SourceReference = {
  sourceDocumentId: string;
  pageNumber: number;

  sourceText?: string | null;
  sourceBlockId?: string | null;
  sourceBoundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
};
```

The UI must support:

```text
Voir la source
```

---

# 9. Extraction confidence

AI extraction may attach confidence per field.

```ts
type ExtractedField<T> = {
  value?: T | null;
  confidence: number; // 0..1

  validationStatus:
    | "AUTO_ACCEPTED"
    | "TO_VALIDATE"
    | "VALIDATED"
    | "REJECTED";
};
```

Critical fields should never be silently accepted when confidence is low.

Critical fields include at minimum:

- product;
- selling price;
- price operator;
- threshold;
- customer mechanism;
- start date;
- end date;
- pre-order deadline;
- applicability condition.

---

# 10. Commercial operation entity

```ts
type CommercialOperation = {
  id: string;

  storeId: string;
  sourceDocumentId: string;

  name: string;

  operationNature: CommercialOperationNature[];

  theme?: string | null;

  announcedStart?: string | null;
  announcedEnd?: string | null;

  actualStart?: string | null;
  actualEnd?: string | null;

  applicabilityStatus:
    | "TO_VALIDATE"
    | "APPLICABLE"
    | "NOT_APPLICABLE";

  planningStatus:
    | "RECEIVED"
    | "VALIDATED"
    | "PLANNED"
    | "EXECUTED"
    | "CANCELLED";

  notes?: string | null;

  createdAt: string;
  updatedAt: string;
};
```

---

# 11. Commercial operation nature

```ts
type CommercialOperationNature =
  | "PROSPECTUS"
  | "COUP_DE_POING"
  | "DRAMATIZATION"
  | "SUPPORT_TO_PRODUCTION"
  | "SPECIAL_RANGE"
  | "LOCAL_ACTION"
  | "OTHER";
```

A single operation may have several natures.

---

# 12. Offer entity

An offer is a product-specific or product-group-specific commercial proposition.

```ts
type Offer = {
  id: string;

  operationId: string;

  productId?: string | null;

  rawProductLabel?: string | null;

  status:
    | "TO_VALIDATE"
    | "VALIDATED"
    | "REJECTED";

  customerMechanism: CustomerMechanism;

  purchaseCondition?: PurchaseCondition | null;

  saleStart?: string | null;
  saleEnd?: string | null;

  sourceReference: SourceReference;
};
```

---

# 13. Customer mechanism

The system must model customer-facing mechanisms explicitly.

```ts
type CustomerMechanism =
  | FixedPriceMechanism
  | PriceCeilingMechanism
  | ThresholdPriceMechanism
  | CardBenefitMechanism
  | LotMechanism
  | MultiBuyMechanism
  | OtherMechanism;
```

---

# 14. Fixed price

```ts
type FixedPriceMechanism = {
  type: "FIXED_PRICE";

  amount: number;
  currency: "EUR";

  unit:
    | "KG"
    | "PIECE"
    | "PACK"
    | "LOT"
    | "OTHER";
};
```

Example:

```text
2.99 €/kg
```

---

# 15. Strict price ceiling

This must remain distinct from fixed price.

Example:

```text
< 2.60 €/kg
```

Recommended model:

```ts
type PriceCeilingMechanism = {
  type: "PRICE_CEILING";

  operator:
    | "LESS_THAN"
    | "LESS_THAN_OR_EQUAL";

  amount: number;
  currency: "EUR";

  unit:
    | "KG"
    | "PIECE"
    | "PACK"
    | "LOT"
    | "OTHER";
};
```

Do not normalize:

```text
< €2.60
```

into:

```text
€2.60
```

---

# 16. Threshold price

Example:

```text
3.49 €/kg
2.99 €/kg from 1 kg
```

Model:

```ts
type ThresholdPriceMechanism = {
  type: "THRESHOLD_PRICE";

  basePrice: number;
  thresholdPrice: number;

  thresholdQuantity: number;

  thresholdUnit:
    | "KG"
    | "PIECE"
    | "PACK";

  priceUnit:
    | "KG"
    | "PIECE"
    | "PACK";
};
```

The threshold condition must be preserved.

---

# 17. Card benefit

Example:

```text
20% card benefit
```

Model:

```ts
type CardBenefitMechanism = {
  type: "CARD_BENEFIT";

  benefitType:
    | "PERCENT"
    | "AMOUNT";

  value: number;

  scope?: string | null;
};
```

Important rule:

> A card benefit must not automatically be treated as an immediate till-price reduction.

---

# 18. Lot mechanism

Example:

```text
lot of 3
```

Model:

```ts
type LotMechanism = {
  type: "LOT";

  lotQuantity: number;

  totalPrice?: number | null;
  unitPrice?: number | null;

  unit:
    | "PIECE"
    | "PACK";
};
```

---

# 19. Supplier / purchase condition

A purchasing condition is not a customer promotion.

```ts
type PurchaseCondition = {
  purchasePrice?: number | null;

  unit?:
    | "KG"
    | "PIECE"
    | "PACK"
    | "LOT";

  supplierDiscountPct?: number | null;

  minimumPurchaseQuantity?: number | null;

  rawLabel?: string | null;
};
```

Example:

```text
-10% purchase discount from 1 kit
```

must not become a customer discount.

---

# 20. Product matching

An extracted offer may initially contain only a raw label.

```text
rawProductLabel = "POIRE QTEE VRAC"
```

The product-matching subsystem proposes a Product.

Possible statuses:

```text
MATCHED
AMBIGUOUS
UNMATCHED
```

No product may be invented.

---

# 21. Multiple product identifiers

Commercial PDFs may include:

- PLU;
- EAN;
- internal code;
- gencoded indicator.

Any extracted identifier must be matched through the Product Master rules.

Do not infer a PLU from unrelated identifiers.

---

# 22. Date model

The system must distinguish:

```text
Document publication date
Commercial sales period
Pre-order window
Delivery period
Execution deadline
Communication period
```

These are separate business dates.

---

# 23. Pre-order window

```ts
type PreOrderWindow = {
  id: string;

  operationId: string;

  startDate?: string | null;
  endDate: string;

  channel?: string | null;

  status:
    | "OPEN"
    | "UPCOMING"
    | "CLOSED"
    | "UNKNOWN";

  sourceReference: SourceReference;
};
```

Example French UI:

```text
Précommande jusqu'au 21 septembre
```

---

# 24. Delivery window

```ts
type DeliveryWindow = {
  id: string;

  operationId: string;

  startDate?: string | null;
  endDate?: string | null;

  notes?: string | null;
};
```

---

# 25. Execution instruction

```ts
type ExecutionInstruction = {
  id: string;

  operationId: string;

  productId?: string | null;

  type:
    | "ORDER"
    | "PREORDER"
    | "CHECK_PRICE"
    | "CHECK_PLU"
    | "STORELINE_CONFIGURATION"
    | "DRIVE_ACTIVATION"
    | "PRINT_POS"
    | "INSTALL_POS"
    | "INSTALL_TG"
    | "INSTALL_MASS_TABLE"
    | "CROSS_MERCHANDISING"
    | "OTHER";

  title: string;
  description?: string | null;

  dueDate?: string | null;

  applicabilityStatus:
    | "TO_VALIDATE"
    | "APPLICABLE"
    | "NOT_APPLICABLE";

  executionStatus:
    | "TODO"
    | "DONE"
    | "SKIPPED";

  completedAt?: string | null;
};
```

---

# 26. Execution instruction rule

A task marked `DONE` means:

> The user declared the task done.

It does NOT mean the application executed it externally.

---

# 27. Communication instruction

```ts
type CommunicationInstruction = {
  id: string;

  operationId: string;

  type:
    | "NATIONAL_RADIO"
    | "IN_STORE_RADIO"
    | "PROSPECTUS"
    | "POS"
    | "OTHER";

  mandatory?: boolean | null;

  notes?: string | null;
};
```

---

# 28. Merchandising recommendation

```ts
type MerchandisingRecommendation = {
  id: string;

  operationId: string;

  name: string;

  type:
    | "TG"
    | "MASS_TABLE"
    | "CROSS_MERCHANDISING"
    | "GROUPED_DISPLAY"
    | "OTHER";

  productIds: string[];

  rawProductLabels: string[];

  sourceReference: SourceReference;

  status:
    | "TO_VALIDATE"
    | "VALIDATED"
    | "REJECTED";
};
```

---

# 29. TG is a planning object, not only a label

The user must be able to decide:

```text
Recommended TG
→ Planned in store
→ Actually installed
```

These states are separate.

---

# 30. Merchandising plan

```ts
type MerchandisingPlan = {
  id: string;

  storeId: string;

  recommendationId?: string | null;

  name: string;

  locationType:
    | "TG"
    | "MASS_TABLE"
    | "AISLE"
    | "OTHER";

  plannedStart?: string | null;
  plannedEnd?: string | null;

  actualStart?: string | null;
  actualEnd?: string | null;

  productIds: string[];

  planningStatus:
    | "PLANNED"
    | "EXECUTED"
    | "CANCELLED";

  notes?: string | null;
};
```

---

# 31. Store merchandising capacity

The store must be configurable with its real merchandising capacity.

Example:

```ts
type StoreMerchandisingCapacity = {
  tgCount?: number | null;
  massTableCount?: number | null;

  notes?: string | null;
};
```

A PDF recommending four TGs does not imply the store has four available TGs.

---

# 32. Applicability

Commercial operations may not apply to every store.

Applicability may depend on:

- prospectus engagement;
- edition;
- commercial variant;
- product range;
- local decision;
- store format.

The application must ask for validation when not deterministically known.

---

# 33. Applicability condition

```ts
type ApplicabilityCondition = {
  id: string;

  operationId: string;

  type:
    | "PROSPECTUS_COMMITMENT"
    | "STORE_EDITION"
    | "PRODUCT_RANGE"
    | "MANUAL_CONFIRMATION"
    | "OTHER";

  rawCondition: string;

  result:
    | "MATCHES"
    | "DOES_NOT_MATCH"
    | "UNKNOWN";
};
```

---

# 34. Commercial calendar

The application must maintain a multi-week commercial calendar.

The user can navigate:

```text
Current week
Next week
Following weeks
Custom date
```

The calendar must not assume the document week equals all operation dates.

---

# 35. Calendar objects

Displayable items include:

```text
Offer start
Offer end
Pre-order deadline
Delivery date
TG installation
Storeline check
Drive activation
Market tension
Public holiday
School holiday
Weather forecast
Local event
```

---

# 36. Planning horizon

The commercial PDF may contain operations beyond S+1.

All validated future operations must be preserved.

The weekly screen may prioritize:

```text
current week
next week
```

while still exposing later operations.

---

# 37. Weekly planning summary

Recommended model:

```ts
type WeeklyCommercialPlan = {
  id: string;

  storeId: string;

  weekStart: string;
  weekEnd: string;

  operationIds: string[];

  instructionIds: string[];
  merchandisingPlanIds: string[];

  marketSignalIds: string[];

  priorityActionIds: string[];

  status:
    | "DRAFT"
    | "VALIDATED"
    | "IN_EXECUTION"
    | "CLOSED";

  validatedAt?: string | null;
};
```

---

# 38. Weekly preparation screen

French UI:

```text
Ma semaine
```

should show at minimum:

### À préparer

- pre-order deadlines;
- price checks;
- Storeline tasks;
- Drive activation;
- POS material;
- TG / merchandising.

### Opérations

- product;
- dates;
- mechanism;
- planned execution.

### Contexte

- market tensions;
- weather;
- holidays;
- local events.

### Substituts

- products to reinforce if a strategic reference is under tension.

### Priorités

- maximum three main priorities.

---

# 39. Market signal entity

```ts
type MarketSignal = {
  id: string;

  sourceDocumentId: string;

  productId?: string | null;
  familyId?: string | null;
  category?: string | null;

  type:
    | "LIMITED_AVAILABILITY"
    | "SUPPLY_TENSION"
    | "QUALITY_ISSUE"
    | "PRICE_INCREASE"
    | "END_OF_CAMPAIGN"
    | "OTHER";

  severity?:
    | "LOW"
    | "MEDIUM"
    | "HIGH";

  validFrom?: string | null;
  validTo?: string | null;

  rawText: string;

  sourceReference: SourceReference;
};
```

---

# 40. Market signal rule

A market signal from the PDF is external commercial context.

It does NOT automatically mean:

```text
store stockout
```

A store-level event requires separate evidence or user declaration.

---

# 41. Store product events

The planning engine consumes store events:

```text
TENSION
LOW_STOCK
OUT_OF_STOCK
QUALITY_ISSUE
PRICE_INCREASE
SUPPLIER_SHORTAGE
```

These are stronger operational signals than generic market information.

---

# 42. Need Unit integration

Every product under tension should be mapped to its validated Need Units.

Example:

```text
Source product:
Tomate ronde

Need Unit:
TOMATE_POLYVALENTE
```

The engine retrieves candidate substitutes from the Product & Substitution Engine.

---

# 43. Substitution-aware weekly planning

When a future market tension exists:

```text
MarketSignal
→ source product / family
→ relevant Need Units
→ candidate substitutes
```

The weekly screen should surface:

```text
Substituts potentiels
```

---

# 44. Substitute planning criteria

Candidate substitutes should be evaluated using:

- relationship score;
- relationship confidence;
- Need Unit compatibility;
- price compatibility;
- packaging compatibility;
- current margin;
- current waste;
- current promotion status;
- other market tensions;
- store-level events;
- known merchandising plan.

---

# 45. Behaviour vs commercial choice

Two rankings are distinct:

```text
Best behavioural substitute
Best commercial option
```

The commercially preferred product may consider margin and waste.

It must not be described as the strongest substitute unless behavioural evidence supports that claim.

---

# 46. Example substitute planning card

French UI example:

```text
Tension annoncée : Tomate ronde

Substitut principal
Tomate Turino

Relation
Forte

Confiance
Moyenne

Prix
Proche

Marge
Supérieure

Risque
Aucune promo concurrente détectée

Action possible
Renforcer la visibilité de la Turino.
```

---

# 47. Counter-promotion definition

For this MVP, a counter-promotion is:

> A local commercial action proposed in complement to, or as an alternative to, the known national/commercial plan.

It does not imply competitor-price monitoring.

---

# 48. Local commercial action

```ts
type LocalCommercialAction = {
  id: string;

  storeId: string;

  productIds: string[];

  objective:
    | "INCREASE_VOLUME"
    | "REDUCE_WASTE"
    | "SUPPORT_SUBSTITUTION"
    | "IMPROVE_PRICE_IMAGE"
    | "SUPPORT_MARGIN"
    | "OTHER";

  proposedStart: string;
  proposedEnd: string;

  proposedMechanism?: CustomerMechanism | null;

  plannedLocation?: string | null;

  status:
    | "DRAFT"
    | "PROPOSED"
    | "ACCEPTED"
    | "REJECTED"
    | "EXECUTED"
    | "CANCELLED";

  createdBy:
    | "USER"
    | "AI";
};
```

---

# 49. Counter-promotion candidate inputs

The engine may consider:

- recent sales;
- sales contribution;
- recent waste;
- waste acceleration;
- source margin;
- price;
- planned national operations;
- substitution network;
- market tensions;
- weather forecast;
- holiday context;
- manual stock/tension event;
- current merchandising plan.

---

# 50. Counter-promotion safeguards

The engine must not propose a numeric price when required cost information is unavailable.

It may instead propose:

```text
Verify cost before setting a local price.
```

---

# 51. Price scenario engine

The planning engine may use deterministic scenario outputs from the KPI engine.

Example:

```text
Current price
Current unit contribution
Proposed price
New unit contribution
Required volume to preserve current contribution amount
```

---

# 52. Break-even threshold is not forecast

Example French UI:

```text
À 2,49 €/kg, il faudrait vendre environ 39% de volume supplémentaire pour conserver le même niveau de contribution théorique.
```

This must be labelled:

```text
Seuil mathématique
```

not:

```text
Prévision de ventes
```

---

# 53. Promotion overlap detection

The engine must detect when:

```text
National operation product A
```

and:

```text
Local action product B
```

share a strong Need Unit or substitution relation.

---

# 54. Promotion overlap warning

Possible French UI:

```text
Risque de chevauchement

La Turino répond au même besoin client que la tomate côtelée déjà en promotion.
Une seconde baisse de prix pourrait déplacer la demande entre les deux références.
```

This is a risk signal, not measured cannibalization.

---

# 55. Complementary promotion detection

Not all overlap is negative.

The engine may identify:

```text
complementary display
```

when products satisfy different needs or support cross merchandising.

---

# 56. Cross merchandising

Cross merchandising recommendations may come from:

- PDF;
- user;
- AI.

The system must retain source.

AI-proposed cross merchandising should be labelled as recommendation, not enseigne instruction.

---

# 57. Weather integration

Planning uses:

```text
FORECAST weather
```

not observed historical weather.

At minimum:

- min temperature;
- max temperature;
- rainfall.

---

# 58. Weather horizon

If the operation is beyond available forecast horizon:

French UI:

```text
Météo pas encore disponible
```

Do not extrapolate a forecast.

---

# 59. Weather as context, not certainty

AI may write:

```text
Warm weather could support salad / summer-fruit demand.
```

It must not write:

```text
Sales will increase by 20%.
```

without a validated forecast model.

---

# 60. Holiday integration

The planner consumes:

- public holidays;
- school holidays.

These are contextual signals.

They do not automatically create predicted uplift.

---

# 61. Local event integration

Manual events may influence planning:

- local festival;
- sports event;
- parking works;
- store closure;
- animation;
- delivery issue.

---

# 62. Commercial priority candidate

The engine produces structured weekly candidates.

```ts
type WeeklyCommercialCandidate = {
  id: string;

  type:
    | "DEADLINE"
    | "EXECUTION_RISK"
    | "MARKET_TENSION"
    | "SUBSTITUTION_OPPORTUNITY"
    | "PROMOTION_OVERLAP"
    | "WASTE_OPPORTUNITY"
    | "MERCHANDISING_OPPORTUNITY"
    | "DATA_QUALITY_ALERT";

  entityIds: string[];

  urgencyScore: number;
  economicImpactScore: number;
  confidenceScore: number;

  facts: string[];

  generatedAt: string;
};
```

---

# 63. Weekly priority limit

The AI may surface at most:

```text
3 main weekly priorities
```

The complete operation list remains accessible.

---

# 64. Priority examples

Examples:

```text
1. Pre-order autumn operation before Monday.
2. Prepare Turino as substitute for expected round-tomato tension.
3. Avoid local promotion on ribbed tomato because a national promotion already targets the same Need Unit.
```

---

# 65. AI recommendation contract

Every recommendation must contain:

- facts;
- sources;
- interpretation;
- proposed action;
- objective;
- risks;
- confidence;
- missing data;
- measurement method.

---

# 66. AI must distinguish three origins

The UI should distinguish:

```text
Instruction enseigne
Observation magasin
Recommandation IA
```

These must never be visually or semantically merged.

---

# 67. Human validation

The user must be able to:

```text
Accept
Modify
Postpone
Reject
```

French UI:

```text
Accepter
Modifier
Reporter
Refuser
```

---

# 68. Planned vs executed

If a recommendation is accepted:

```text
status = PLANNED / ACCEPTED
```

It is not executed until explicitly recorded.

---

# 69. Execution recording

For an executed promotion or merchandising action capture:

```ts
type CommercialExecution = {
  id: string;

  operationId?: string | null;
  localActionId?: string | null;

  actualStart: string;
  actualEnd?: string | null;

  actualPrice?: number | null;
  actualPriceUnit?: string | null;

  actualLocation?: string | null;

  actualMechanism?: CustomerMechanism | null;

  notes?: string | null;

  executedByUser: boolean;
};
```

---

# 70. Partial execution

An operation may be only partially executed.

Example:

```text
Price applied
TG not installed
POS not printed
```

Do not reduce execution to one boolean.

---

# 71. Execution checklist

Recommended:

```ts
type ExecutionChecklistItem = {
  id: string;

  operationId: string;

  label: string;

  required: boolean;

  status:
    | "TODO"
    | "DONE"
    | "SKIPPED"
    | "NOT_APPLICABLE";

  completedAt?: string | null;
};
```

---

# 72. Operation review

After execution, analytics compares:

```text
Before
During
After
```

using actual execution dates where known.

---

# 73. Review metrics

At minimum:

- sales value;
- quantity;
- margin;
- waste;
- average realized price;
- execution completion;
- concurrent operations;
- relevant weather/context.

---

# 74. Review wording

The application may say:

```text
Volume increased during the operation period.
```

It must not automatically say:

```text
The promotion caused the increase.
```

---

# 75. Commercial result status

Possible review status:

```text
POSITIVE_OBSERVED_CHANGE
NEGATIVE_OBSERVED_CHANGE
MIXED
NO_CLEAR_CHANGE
INSUFFICIENT_DATA
```

This is descriptive, not causal.

---

# 76. Promotion execution quality

A poor result with incomplete execution should be flagged differently from a poor result with complete execution.

Example:

```text
Performance difficult to interpret:
TG not installed.
```

---

# 77. Weekly planning state machine

Recommended:

```text
DRAFT
  ↓
VALIDATED
  ↓
IN_EXECUTION
  ↓
CLOSED
```

A plan may also be:

```text
CANCELLED
```

---

# 78. Operation state machine

Recommended:

```text
RECEIVED
  ↓
VALIDATED
  ↓
PLANNED
  ↓
EXECUTED
```

Alternative exits:

```text
NOT_APPLICABLE
CANCELLED
```

---

# 79. Offer validation state

Recommended:

```text
TO_VALIDATE
→ VALIDATED
or
→ REJECTED
```

---

# 80. Extraction duplicate handling

The same offer may appear:

- on detailed page;
- in summary page;
- in TG recap.

The system must not automatically create three separate offers.

---

# 81. Offer de-duplication

Possible deterministic matching factors:

- product;
- commercial period;
- mechanism;
- price;
- operation;
- source document.

When duplicate-looking items differ materially:

```text
conflict requiring review
```

---

# 82. Source enrichment

If the same validated offer appears on multiple pages:

store multiple `SourceReference` records against the same Offer.

---

# 83. PDF correction conflict

If version 2 changes:

```text
price
date
threshold
product
```

the system must show the change.

Do not silently overwrite.

---

# 84. Change review example

French UI:

```text
Communication corrigée

Poire Qtee

Ancien prix
3,49 €/kg

Nouveau prix
3,29 €/kg

Valider la nouvelle version ?
```

---

# 85. Deadlines

Deadline objects must support:

- pre-order deadline;
- setup deadline;
- printing deadline;
- Drive activation;
- Storeline configuration.

---

# 86. Deadline urgency

Recommended urgency levels:

```text
OVERDUE
TODAY
WITHIN_24H
WITHIN_3_DAYS
LATER
```

---

# 87. Today screen integration

The `Aujourd’hui` screen may surface:

```text
Précommande à clôturer aujourd'hui
TG à installer demain
Paramétrage caisse à vérifier
```

but maximum three main priorities remain.

---

# 88. Weekly screen sections

Recommended French UI structure:

```text
Ma semaine

Priorités
À commander
À préparer
Promotions
TG & mises en avant
Tensions marché
Substituts
Météo & calendrier
À vérifier
```

---

# 89. Commercial operation card

Recommended content:

```text
Product / theme
Operation type
Sales dates
Price mechanism
Order deadline
Communication
TG / merchandising
Applicability
Execution status
```

---

# 90. Offer price display

Preserve exact semantics.

Examples:

```text
2,99 €/kg
< 2,60 €/kg
2,99 €/kg à partir de 1 kg
20% avantage carte
Lot de 3
```

---

# 91. Mechanism label mapping

Recommended French labels:

```text
FIXED_PRICE
→ Prix promo

PRICE_CEILING
→ Prix inférieur à

THRESHOLD_PRICE
→ Prix dégressif / conditionnel

CARD_BENEFIT
→ Avantage carte

LOT
→ Vente en lot
```

Final wording remains UX-configurable.

---

# 92. Operation applicability UI

French states:

```text
À confirmer
Applicable
Non applicable
```

---

# 93. Execution status UI

French states:

```text
Reçu
Validé
Planifié
Réalisé
Annulé
```

---

# 94. Market signal UI

French examples:

```text
Tension marché
Disponibilité limitée
Problème qualité
Prix en hausse
Fin de campagne
```

---

# 95. Store event UI

French examples:

```text
Tension magasin
Stock faible
Rupture
Problème qualité
Hausse de prix
Tension fournisseur
```

The source must remain visible.

---

# 96. AI extraction responsibilities

AI is responsible for:

- locating commercial blocks;
- extracting structured text;
- identifying possible products;
- extracting dates;
- extracting price mechanisms;
- extracting purchasing conditions;
- extracting merchandising instructions;
- extracting market signals;
- extracting deadlines.

---

# 97. AI extraction prohibitions

AI must not:

- invent a missing product code;
- invent an end date;
- convert unclear `<` to `=`;
- infer store applicability when source is ambiguous;
- assume execution;
- assume customer discount from supplier discount.

---

# 98. AI planning responsibilities

AI may:

- summarize S+1;
- identify deadlines;
- propose three main priorities;
- propose substitute preparation;
- warn about promotion overlap;
- suggest local actions;
- explain reasoning.

---

# 99. AI planning prohibitions

AI must not:

- place an order;
- change Storeline;
- activate Drive;
- alter till parameters;
- execute price changes;
- claim stock levels not supplied;
- invent expected uplift.

---

# 100. Commercial planning recommendation example

French UI:

```text
Priorité 1 — Préparer la tension tomate

Faits
• tension marché annoncée sur la tomate ronde
• opération nationale sur la tomate côtelée
• Turino = substitut fort, confiance moyenne
• prix Turino proche
• casse Turino faible sur les 7 derniers jours

Action proposée
Renforcer la visibilité de la Turino et surveiller sa disponibilité.

Risque
Une promotion simultanée sur deux tomates très substituables pourrait déplacer la demande plutôt que créer du volume additionnel.

Confiance
Moyenne
```

---

# 101. Local action measurement

Every accepted local action should define:

```text
objective KPI
baseline
measurement period
review date
```

---

# 102. Example measurement plan

```text
Action:
Move Turino next to round tomato

Objective:
Maintain tomato Need Unit sales during round-tomato tension

Measure:
Turino sales value
Turino quantity
Turino waste
Round tomato stockout duration

Reference:
Comparable weekdays

Review:
After tension event ends
```

---

# 103. Promotion / substitution interaction

If a national promotion already covers a strong substitute:

the planner should consider whether a local promotion on another close substitute creates unnecessary overlap.

---

# 104. Promotion / waste interaction

A product with increasing waste may be a candidate for:

- stronger display;
- local price action;
- lot sale;
- reduced exposure;
- no action;

depending on:

- sales;
- margin;
- product need;
- substitute relations;
- upcoming national operation.

The system must not default to discounting.

---

# 105. Promotion / market tension interaction

If the PDF promotes a product while also warning of limited availability:

the weekly plan must surface this contradiction.

Example:

```text
High commercial visibility planned
+
supply tension
```

possible action:

```text
prepare substitutes
```

---

# 106. Promotion / quality interaction

If a product is on promotion but has a quality issue:

the engine should lower recommendation confidence and surface the issue.

---

# 107. National instruction vs AI recommendation

Visual distinction is mandatory.

Example:

```text
ENSEIGNE
Installer TG Crudités

IA
Prévoir Turino comme substitut
```

---

# 108. Manual notes

The manager may add free-text notes to:

- operation;
- offer;
- merchandising plan;
- local action;
- market signal;
- execution review.

These notes must not overwrite source facts.

---

# 109. Commercial document library

Under `Plus`:

```text
Documents commerciaux
```

The user can see:

- filename;
- week label;
- import date;
- validation status;
- version;
- extracted operation count.

---

# 110. Commercial source review screen

The user should be able to compare:

```text
PDF page
↔
extracted structured data
```

especially during initial pilot use.

---

# 111. Batch validation

Because weekly PDFs may contain many items:

support grouped validation.

Example:

```text
Validate 8 high-confidence offers
Review 3 uncertain items
```

---

# 112. Mandatory manual review

Always require review when:

- ambiguous product;
- ambiguous date;
- conflicting prices;
- unclear price operator;
- unclear applicability;
- duplicate conflict.

---

# 113. Product grouping

An operation may target:

- single product;
- multiple products;
- product family;
- Need Unit;
- theme.

Do not force every operation to one productId.

---

# 114. Thematic operation

Example:

```text
Autumn operation
```

may contain several products.

Model:

```ts
type OperationProductSelection = {
  operationId: string;

  productIds: string[];
  rawProductLabels: string[];

  selectionRule?: string | null;
};
```

---

# 115. User-selected operation products

If source says:

```text
Build your own operation from the defined list
```

the store manager can mark selected products.

The system must distinguish:

```text
eligible products
selected products
actually executed products
```

---

# 116. Optional products

Some source lists are recommendations, not mandatory assortment.

Model explicitly:

```text
MANDATORY
OPTIONAL
USER_SELECTED
```

where source supports the distinction.

---

# 117. Pre-order confirmation

The manager may record:

```text
Précommande effectuée
```

with optional:

- date;
- note;
- quantity comment.

The MVP does not need automatic purchase-order creation.

---

# 118. Quantity planning

Full order optimization is out of scope.

The user may enter a manual observed or planned quantity note, but the system must not present it as optimized demand.

---

# 119. Store stock observation

Optional manual store observation:

```ts
type StockObservation = {
  productId: string;

  observedAt: string;

  level:
    | "LOW"
    | "NORMAL"
    | "HIGH"
    | "UNKNOWN";

  quantity?: number | null;
  unit?: string | null;

  source: "USER";
};
```

This is not a theoretical stock ledger.

---

# 120. Stock observation use

AI recommendations may use:

```text
LOW
NORMAL
HIGH
```

but must display that this is a manual observation.

---

# 121. Commercial conflict detection

Potential conflicts include:

```text
Two strong substitutes promoted simultaneously
Product in promo and supplier tension
TG planned for more locations than available
Order deadline already passed
Price mechanism conflicts between PDF versions
Drive action required but not confirmed
```

---

# 122. Conflict severity

Recommended:

```text
INFO
WARNING
CRITICAL
```

---

# 123. Critical conflicts

Examples:

- conflicting validated prices for same period/product;
- operation dates invalid;
- required code unresolved;
- duplicate execution tasks with contradictory values.

Critical conflict prevents final weekly-plan validation.

---

# 124. Non-critical warnings

Examples:

- weather forecast unavailable;
- substitute confidence low;
- margin unknown;
- stock not observed.

These do not block planning.

---

# 125. Weekly-plan validation

Before validating a weekly plan, check:

- critical extraction issues resolved;
- store applicability reviewed;
- deadlines known;
- key offers validated;
- merchandising plan feasible;
- known conflicts surfaced.

---

# 126. Weekly plan locking

After validation:

the plan remains editable, but changes should be audited.

---

# 127. Plan change audit

```ts
type WeeklyPlanChange = {
  id: string;

  planId: string;

  changeType: string;

  previousValue?: string | null;
  newValue?: string | null;

  changedAt: string;

  changedBy: string;
};
```

---

# 128. Execution audit

Record:

- who marked done;
- when;
- actual value;
- notes.

---

# 129. Commercial analytics handoff

After execution, the planning engine provides operation metadata to the KPI engine:

```text
actual start/end
actual price
actual mechanism
actual merchandising
execution completeness
```

The KPI engine performs observed performance analysis.

---

# 130. Analytics handback

The planning engine consumes KPI outputs:

- sales change;
- quantity change;
- margin change;
- waste change;
- execution completeness;
- comparison quality.

---

# 131. Closed-loop learning

The commercial loop is:

```text
Communication
→ Plan
→ Execution
→ Analytics
→ Review
→ Future recommendation
```

---

# 132. Review capture

The user may record:

```text
Worked well
Mixed
Did not work
Not enough data
```

This is subjective feedback and must be stored separately from KPI facts.

---

# 133. AI retrospective

The AI may summarize:

```text
The operation coincided with higher volume but also increased waste.
Execution was partial because the TG was not installed.
```

---

# 134. Recommendation memory

Future recommendations may use past action outcomes.

Example:

```text
Previous local action on Turino:
higher volume
stable waste
```

This is evidence for commercial planning, not substitution proof unless tied to a valid tension event.

---

# 135. French navigation integration

Primary destination:

```text
Ma semaine
```

Related screens:

```text
Aujourd’hui
Analyses
Plus > Documents commerciaux
```

---

# 136. Weekly screen mobile-first principle

Avoid large tables.

Use:

- cards;
- timeline;
- grouped deadlines;
- operation detail sheets;
- expandable source references.

---

# 137. Desktop enhancement

Desktop may show:

- multi-week calendar;
- operation matrix;
- side-by-side source document;
- merchandising planning board.

Business logic remains identical.

---

# 138. Notifications — MVP optional

Potential reminders:

```text
Pre-order deadline tomorrow
Offer starts tomorrow
Storeline configuration not confirmed
TG planned but not marked installed
```

The notification subsystem itself may be implemented later.

---

# 139. Notification safety

Do not create excessive notifications.

Priority-based reminders should focus on actionable deadlines.

---

# 140. Initial commercial operation registry

Suggested operation labels:

```text
PROSPECTUS
COUP_DE_POING
DRAMATIZATION
SUPPORT_TO_PRODUCTION
SPECIAL_RANGE
LOCAL_ACTION
```

---

# 141. Initial mechanism registry

Suggested:

```text
FIXED_PRICE
PRICE_CEILING
THRESHOLD_PRICE
CARD_BENEFIT
LOT
MULTI_BUY
OTHER
```

---

# 142. Initial execution task registry

Suggested:

```text
ORDER
PREORDER
CHECK_PRICE
CHECK_PLU
STORELINE_CONFIGURATION
DRIVE_ACTIVATION
PRINT_POS
INSTALL_POS
INSTALL_TG
INSTALL_MASS_TABLE
CROSS_MERCHANDISING
OTHER
```

---

# 143. Initial market-signal registry

Suggested:

```text
LIMITED_AVAILABILITY
SUPPLY_TENSION
QUALITY_ISSUE
PRICE_INCREASE
END_OF_CAMPAIGN
OTHER
```

---

# 144. Acceptance criteria

## CP-AC-01 — Multi-week PDF

**Given:** one weekly PDF contains operations for several weeks.  
**Expected:** each operation keeps its actual dates; document week is not imposed on all offers.

---

## CP-AC-02 — Pre-order vs sale dates

**Given:** pre-order ends before the sales period.  
**Expected:** both periods are stored separately.

---

## CP-AC-03 — Strict price ceiling

**Given:** `< €2.60/kg`.  
**Expected:** stored as strict ceiling, not fixed €2.60.

---

## CP-AC-04 — Threshold price

**Given:** €3.49/kg and €2.99/kg from 1 kg.  
**Expected:** both prices and threshold condition are preserved.

---

## CP-AC-05 — Card benefit

**Given:** 20% card benefit.  
**Expected:** mechanism remains card benefit and is not converted into direct till-price reduction.

---

## CP-AC-06 — Supplier discount

**Given:** -10% purchase discount on a kit.  
**Expected:** it is modeled as purchase condition, not customer promotion.

---

## CP-AC-07 — Detailed page and summary duplication

**Given:** same offer appears on detailed page and TG summary.  
**Expected:** one Offer with multiple SourceReferences.

---

## CP-AC-08 — Corrected PDF

**Given:** version 2 changes an offer price.  
**Expected:** old value preserved, conflict/change shown, validation required.

---

## CP-AC-09 — Applicability

**Given:** offer valid only for stores committed to a prospectus.  
**Expected:** store applicability must be confirmed before planning.

---

## CP-AC-10 — Announced vs executed

**Given:** operation imported but not implemented in store.  
**Expected:** it is not marked executed.

---

## CP-AC-11 — Partial execution

**Given:** price applied but TG not installed.  
**Expected:** execution checklist reflects partial completion.

---

## CP-AC-12 — Market tension

**Given:** PDF reports supply tension.  
**Expected:** market signal created, not store stockout.

---

## CP-AC-13 — Store stockout

**Given:** user later records store OUT_OF_STOCK.  
**Expected:** separate store event linked to product.

---

## CP-AC-14 — Substitute planning

**Given:** product under tension has validated substitutes.  
**Expected:** potential substitutes surfaced with score/confidence and commercial context.

---

## CP-AC-15 — Strong substitute already promoted

**Given:** national promo on B and local promo candidate A share strong Need Unit relation.  
**Expected:** overlap warning.

---

## CP-AC-16 — Margin unknown

**Given:** counter-promotion candidate with unknown cost.  
**Expected:** no validated numeric price recommendation based on margin.

---

## CP-AC-17 — Break-even scenario

**Given:** current price, proposed price, cost and volume known.  
**Expected:** deterministic break-even volume threshold shown, not forecast.

---

## CP-AC-18 — Weather horizon

**Given:** operation beyond forecast range.  
**Expected:** “Météo pas encore disponible”, no extrapolated forecast.

---

## CP-AC-19 — TG capacity

**Given:** PDF recommends 4 TGs but store has only 2 available.  
**Expected:** planning conflict surfaced.

---

## CP-AC-20 — User-selected operation

**Given:** source says choose products from a list.  
**Expected:** eligible products and store-selected products remain distinct.

---

## CP-AC-21 — Deadline overdue

**Given:** pre-order deadline has passed.  
**Expected:** overdue status, not silent task removal.

---

## CP-AC-22 — Source traceability

**Given:** user opens an extracted offer.  
**Expected:** source page/block can be displayed.

---

## CP-AC-23 — AI recommendation provenance

**Given:** AI proposes reinforcing Turino.  
**Expected:** UI distinguishes this recommendation from enseigne instructions.

---

## CP-AC-24 — Weekly priority limit

**Given:** 12 operations and 8 warnings.  
**Expected:** no more than 3 main priorities are surfaced, while all items remain accessible.

---

## CP-AC-25 — Promotion review

**Given:** executed promotion with sufficient data.  
**Expected:** before/during/after observed results available with context warnings.

---

## CP-AC-26 — No causal overclaim

**Given:** sales rose during promotion.  
**Expected:** system describes observed variation, not guaranteed causal uplift.

---

## CP-AC-27 — Local action review

**Given:** user executes local counter-promotion.  
**Expected:** actual dates/price/location stored separately from proposal.

---

## CP-AC-28 — Commercial conflict

**Given:** two validated source versions contain conflicting prices.  
**Expected:** critical conflict blocks final plan validation until resolved.

---

## CP-AC-29 — Unknown product

**Given:** PDF product cannot be matched.  
**Expected:** offer remains reviewable with raw label; no invented product.

---

## CP-AC-30 — French UI

**Given:** internal enum `PRICE_CEILING`.  
**Expected:** user sees an appropriate French label.

---

# 145. Out of scope

Not required in Commercial Planning & Promotion Engine MVP v0.1:

- automatic purchase orders;
- automatic Mercalys writes;
- automatic Storeline writes;
- automatic Drive activation;
- autonomous till configuration;
- competitor-price scraping;
- advanced demand forecasting;
- automatic price elasticity;
- causal cannibalization;
- full inventory optimization;
- delivery-route optimization;
- supplier EDI;
- customer-level targeting;
- loyalty segmentation;
- automatic media buying;
- fully autonomous promotion approval.

---

# 146. Implementation guidance

Recommended subsystem boundaries:

```text
Commercial document ingestion
        ↓
Document AI extraction
        ↓
Commercial normalization
        ↓
Validation & deduplication
        ↓
Commercial calendar
        ↓
Planning engine
        ↓
Context engine
        ↓
Substitution-aware reasoning
        ↓
Local action scenario engine
        ↓
Weekly candidates
        ↓
AI recommendation layer
        ↓
Human validation
        ↓
Execution tracking
        ↓
Analytics review
```

---

# 147. Do not implement as a single LLM prompt

The planning engine must be composed of structured business objects.

Do not ask one model:

```text
"Read this PDF and tell me what to do next week."
```

and persist its answer as business truth.

The system must first extract and validate:

```text
Products
Dates
Prices
Mechanisms
Deadlines
Instructions
Market signals
Applicability
```

Then deterministic services and AI reasoning can produce a recommendation.

---

# 148. Functional completion definition

The Commercial Planning & Promotion Engine MVP is complete when the manager can reliably perform:

```text
Import weekly PDF
→ review extracted operations
→ validate products/prices/dates/mechanisms
→ confirm store applicability
→ view multi-week commercial calendar
→ prepare deadlines
→ prepare TG / merchandising
→ review market tensions
→ review substitutes
→ receive max 3 priorities
→ create/accept local action
→ record actual execution
→ review observed results
```

A simple PDF summary screen does not satisfy this specification.

---

# 149. Final functional invariant

The engine must always preserve the difference between:

```text
Source instruction
Store applicability
Store plan
Store execution
Observed result
AI recommendation
```

and between:

```text
Promotion mechanism
Purchase condition
Merchandising recommendation
Market signal
Substitution opportunity
```

If these concepts are collapsed into one generic “promotion” object, the implementation violates the functional design.
