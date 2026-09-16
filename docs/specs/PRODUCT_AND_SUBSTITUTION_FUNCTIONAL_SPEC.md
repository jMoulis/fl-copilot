# Product & Substitution Functional Specification

**Product:** Fruits & Vegetables Copilot  
**Document:** `PRODUCT_AND_SUBSTITUTION_FUNCTIONAL_SPEC.md`  
**Version:** 0.1  
**Date:** 16 September 2026  
**Specification language:** English  
**Application language:** French (`fr-FR`)  
**Primary user:** Fruits & Vegetables Department Manager — Intermarché  
**Scope:** Product master data, customer need model, substitution graph, field-event evidence, score evolution, and substitution-aware recommendations.

---

# 1. Purpose of this specification

This document defines the functional behaviour of the **Product Master and Substitution Engine** used by the Fruits & Vegetables Copilot.

The goal is not merely to maintain a product catalogue.

The application must represent:

1. what a product is;
2. how it is sold and packaged;
3. which customer needs it can satisfy;
4. which other products can substitute for it;
5. how strong those substitution relationships are;
6. how much confidence the application has in those relationships;
7. how field events such as tension or stockout create new evidence;
8. how observed sales behaviour can refine future substitution recommendations;
9. how substitution information is used in promotions, counter-promotions and weekly preparation.

This specification is designed for direct use by an AI development agent.

---

# 2. Core business idea

A customer often enters the Fruits & Vegetables department with a **need**, not necessarily with an immutable SKU choice.

Example:

> The customer wants round tomatoes.

If round tomatoes are unavailable, the customer may choose Turino tomatoes because the underlying need was still:

> “I need tomatoes.”

The application therefore must not model products only as independent SKUs.

It must also model a **network of customer-near alternatives**.

This network is called the **substitution graph**.

---

# 3. Fundamental domain distinctions

The following concepts MUST remain separate.

## 3.1 Product category

Business classification.

```ts
type ProductCategory =
  | "FRUIT"
  | "VEGETABLE"
  | "OTHER"
  | "UNKNOWN";
```

Example:

```text
Tomate ronde grappe
category = VEGETABLE
```

---

## 3.2 Product nature

How the product is operationally sold / identified.

```ts
type ProductNature =
  | "BULK"
  | "PACKAGED"
  | "UNKNOWN";
```

Example:

```text
Tomate ronde grappe
nature = BULK
```

```text
Pomme Gala sachet 1.5 kg
nature = PACKAGED
```

---

## 3.3 Sales unit

Unit in which Mercalys sales quantities must be interpreted.

```ts
type SalesUnit =
  | "KG"
  | "PIECE"
  | "PACK"
  | "UNKNOWN";
```

---

## 3.4 Packaging

Physical content or grouping of the commercial product.

Packaging is not the same thing as the sales unit.

Example:

```text
Pomme Gala sachet 1.5 kg

salesUnit = PIECE
packaging.quantity = 1.5
packaging.unit = KG
```

---

## 3.5 Need Unit

A **customer purchase intention / need**.

This is NOT:

- an order unit;
- a number of packs;
- a logistics unit;
- a quantity;
- a Mercalys quantity field.

Example:

```text
Need Unit:
TOMATE_POLYVALENTE
```

Products satisfying this need may include:

```text
Tomate ronde
Tomate ronde grappe
Tomate Turino
Tomate côtelée
Tomate allongée
```

---

## 3.6 Product substitution

A directed relationship:

```text
Product A → Product B
```

meaning:

> Product B can potentially satisfy the customer need when Product A cannot.

A substitution is not necessarily symmetrical.

---

## 3.7 Relationship score

How strong / plausible a substitution relationship appears.

---

## 3.8 Confidence

How much reliable evidence supports the current relationship score.

Relationship score and confidence MUST be separate.

---

## 3.9 Evidence

A traceable observation that supports, contradicts or does not materially affect a substitution relationship.

---

# 4. Product master

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

  status:
    | "ACTIVE"
    | "INACTIVE"
    | "TO_REVIEW";

  identifiers: ProductIdentifier[];
  aliases: ProductAlias[];

  createdAt: string;
  updatedAt: string;
};
```

---

# 5. Product identifiers

## 5.1 Identifier types

```ts
type ProductIdentifierType =
  | "ITM8"
  | "EAN"
  | "PLU";
```

```ts
type ProductIdentifier = {
  id: string;
  productId: string;

  type: ProductIdentifierType;

  value: string;

  source:
    | "MERCALYS"
    | "COMMERCIAL_PDF"
    | "USER"
    | "AI_PROPOSED";

  status:
    | "VALIDATED"
    | "TO_REVIEW";
};
```

---

## 5.2 Identifier rules

All business identifiers MUST be stored as strings.

Leading zeroes MUST be preserved.

The system MUST NOT infer:

```text
PLU from EAN
EAN from ITM8
ITM8 from label
```

unless a validated mapping rule is explicitly configured.

---

# 6. Product aliases

Product labels vary between:

- Mercalys;
- waste receipts;
- commercial PDFs;
- abbreviated printed labels;
- manual user input.

The application therefore needs canonical labels and aliases.

```ts
type ProductAlias = {
  id: string;

  productId: string;

  alias: string;

  source:
    | "MERCALYS"
    | "WASTE_RECEIPT"
    | "COMMERCIAL_PDF"
    | "USER"
    | "AI_PROPOSED";

  status:
    | "VALIDATED"
    | "TO_REVIEW"
    | "REJECTED";

  confidence?: number | null;
};
```

Example:

```text
Canonical:
POIRE CONFERENCE VRAC

Aliases:
POIRE CONFERENCE VRA
POIRE CONF VRAC
```

An AI-proposed alias MUST NOT become trusted automatically if the product match is ambiguous.

---

# 7. Product category and family hierarchy

## 7.1 Category

At MVP level:

```text
FRUIT
VEGETABLE
OTHER
UNKNOWN
```

The category is required for:

- analysis;
- filtering;
- reporting;
- product sheet;
- recommendation context.

---

## 7.2 Family / subfamily

The application may also contain:

```text
Category
→ Family
→ Subfamily
→ Product
```

Example:

```text
VEGETABLE
  → TOMATO
     → ROUND TOMATO
        → Product SKU
```

However:

> Product family is NOT equivalent to Need Unit.

A Need Unit represents customer behaviour, while family represents business taxonomy.

---

# 8. Packaging model

## 8.1 Packaging entity

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

  sourceLabel?: string | null;
};
```

---

## 8.2 Examples

### Example A

```text
Avocat lot de 3

salesUnit = PIECE or PACK according to validated business semantics
packaging.quantity = 3
packaging.unit = PIECE
packaging.sourceLabel = "LOT DE 3"
```

### Example B

```text
Myrtille barquette 125 g

packaging.quantity = 125
packaging.unit = G
packaging.sourceLabel = "BARQUETTE 125G"
```

### Example C

```text
Pomme de terre filet 2.5 kg

packaging.quantity = 2.5
packaging.unit = KG
packaging.sourceLabel = "FILET 2,5KG"
```

---

# 9. Need Unit model

## 9.1 Functional definition

A Need Unit is:

> A business representation of a customer purchase intention that can be fulfilled by one or more products.

Examples may include:

```text
TOMATE_POLYVALENTE
SALADE
CRUDITES
AGRUME_JUS
CUISINE
APERITIF
SNACKING
FRUIT_DESSERT
```

The final Need Unit catalogue MUST remain editable.

---

## 9.2 NeedUnit entity

```ts
type NeedUnit = {
  id: string;

  code: string;

  name: string;

  description?: string | null;

  status:
    | "ACTIVE"
    | "TO_REVIEW"
    | "INACTIVE";

  createdBy:
    | "USER"
    | "AI"
    | "SYSTEM";

  createdAt: string;
  updatedAt: string;
};
```

---

# 10. Product membership in Need Units

## 10.1 Many-to-many relation

A product can belong to several Need Units.

A Need Unit can contain many products.

```ts
type ProductNeedMembership = {
  id: string;

  productId: string;
  needUnitId: string;

  strength: number; // 0..1

  primary: boolean;

  source:
    | "MANUAL"
    | "AI_PROPOSED"
    | "LEARNED";

  confidence: number; // 0..1

  status:
    | "PROPOSED"
    | "VALIDATED"
    | "REJECTED";

  createdAt: string;
  updatedAt: string;
};
```

---

## 10.2 Membership strength

`strength` means:

> How strongly this product satisfies the Need Unit.

Example:

```text
Need Unit = TOMATE_POLYVALENTE

Tomate ronde:
strength = 1.00

Tomate Turino:
strength = 0.90

Tomate côtelée:
strength = 0.80

Tomate cerise:
strength = 0.45
```

These values are examples only.

They MUST NOT be hardcoded from this specification.

---

## 10.3 Membership confidence

Confidence represents certainty in the membership classification.

Example:

```text
strength = 0.90
confidence = 0.30
```

means:

> The product looks highly compatible with the need, but the classification is still poorly evidenced.

---

# 11. Why Need Units must remain different from families

Example:

```text
Category = VEGETABLE
Family = TOMATO
Need Unit = APERITIF
```

A cherry tomato may satisfy:

```text
TOMATE
SALAD
APERITIF
SNACKING
```

while a round tomato may strongly satisfy:

```text
TOMATE
CUISINE
SALAD
```

Both belong to the same business family but do not have identical customer-use profiles.

---

# 12. Product substitution graph

## 12.1 Graph definition

Products are graph nodes.

Substitution relations are directed edges.

Example:

```text
Tomate ronde
   ↓
Tomate Turino
```

means:

> Turino is a candidate substitute when the initial demand was for round tomato.

---

## 12.2 Directed relation

A substitution relation MUST be directional.

The system MUST NOT automatically mirror:

```text
A → B
```

into:

```text
B → A
```

with the same score.

The reverse relation may exist but must be evaluated separately.

---

# 13. ProductSubstitution entity

```ts
type ProductSubstitution = {
  id: string;

  sourceProductId: string;
  substituteProductId: string;

  needUnitId: string;

  needCompatibility: number;       // 0..1
  usageCompatibility: number;      // 0..1
  priceCompatibility: number;      // 0..1
  packagingCompatibility: number;  // 0..1

  observedSubstitution?: number | null; // 0..1

  relationshipScore: number;       // 0..1
  confidence: number;              // 0..1

  evidenceCount: number;

  status:
    | "PROPOSED"
    | "VALIDATED"
    | "LEARNING"
    | "REJECTED";

  source:
    | "MANUAL"
    | "AI_PROPOSED"
    | "LEARNED";

  lastEvidenceAt?: string | null;

  createdAt: string;
  updatedAt: string;
};
```

---

# 14. Components of substitution

The application should reason about at least the following dimensions.

## 14.1 Need compatibility

Does the substitute satisfy the same customer need?

---

## 14.2 Usage compatibility

Can it reasonably be used for the same customer purpose?

Example:

```text
Round tomato
→ polyvalent cooking / salad

Cherry tomato
→ salad / aperitif / snacking
```

Same family does not automatically mean same usage.

---

## 14.3 Price compatibility

Price distance matters.

The application may calculate a deterministic price distance when comparable units exist.

Example formula:

```text
priceDistance =
abs(priceA - priceB) / abs(priceA)
```

The exact normalization into `priceCompatibility` must be implemented as a configurable deterministic function.

The application MUST NOT compare incompatible units without conversion.

Examples of invalid direct comparison:

```text
€/kg vs €/pack
€/piece vs €/kg
```

unless an explicit conversion is available.

---

## 14.4 Packaging compatibility

A bulk product and a tray may satisfy the same need but with higher substitution friction.

Packaging compatibility may therefore influence the relationship.

---

## 14.5 Margin relevance

Margin is NOT part of customer substitution itself.

Margin is an **operational recommendation factor**.

Important distinction:

> “B is a good substitute for A” is a customer-behaviour statement.

> “B is the commercially preferable substitute” may additionally consider margin.

Do not distort substitution evidence in order to favour high-margin products.

---

# 15. Relationship score

## 15.1 Meaning

`relationshipScore` represents the current overall plausibility / strength of substitution.

It MUST be derived deterministically from stored components and evidence.

The AI MUST NOT directly write an arbitrary final score.

---

## 15.2 Configurable score composition

The system may use a configurable weighted model such as:

```text
relationshipScore =
  W_need       × needCompatibility
+ W_usage      × usageCompatibility
+ W_price      × priceCompatibility
+ W_packaging  × packagingCompatibility
+ W_observed   × observedSubstitution
```

where:

```text
sum(weights) = 1
```

The exact production weights are business configuration, not hardcoded functional truth.

---

## 15.3 No false precision

The UI SHOULD avoid displaying unnecessary decimal precision.

Preferred French UI:

```text
Relation forte
Confiance moyenne
```

with a detail view optionally showing the underlying numeric score.

---

# 16. Confidence model

## 16.1 Meaning

Confidence expresses:

> How much trustworthy information supports the current relationship score.

It is not the same as score strength.

---

## 16.2 Confidence inputs

Confidence may increase with:

- validated business mapping;
- number of independent field events;
- recency;
- clean baseline periods;
- absence of confounders;
- consistent observations;
- good sales-data coverage.

Confidence may decrease or grow slowly when:

- evidence count is low;
- concurrent promotions exist;
- the event duration is unclear;
- the user only reports a vague tension;
- the candidate substitute was itself in tension;
- weather or other context materially changed;
- expected sales baseline is weak.

---

# 17. Structured field events

## 17.1 Event types

```ts
type StoreProductEventType =
  | "TENSION"
  | "LOW_STOCK"
  | "OUT_OF_STOCK"
  | "QUALITY_ISSUE"
  | "PRICE_INCREASE"
  | "SUPPLIER_SHORTAGE";
```

---

## 17.2 StoreProductEvent

```ts
type StoreProductEvent = {
  id: string;

  storeId: string;
  productId: string;

  type: StoreProductEventType;

  startedAt: string;
  endedAt?: string | null;

  severity?:
    | "LOW"
    | "MEDIUM"
    | "HIGH";

  source:
    | "USER"
    | "COMMERCIAL_PDF";

  sourceDocumentId?: string | null;

  comment?: string | null;

  status:
    | "ACTIVE"
    | "CLOSED"
    | "TO_REVIEW";

  createdAt: string;
  updatedAt: string;
};
```

---

# 18. Difference between PDF market tension and store event

These two statements are different:

### Commercial PDF

```text
“Market very tense on Batavia.”
```

This describes an external market signal.

### Store user

```text
“Batavia out of stock from 14:00 to 18:00.”
```

This is a store-level operational observation.

The application MUST preserve that distinction.

A PDF market signal MUST NOT automatically create a store stockout.

---

# 19. Evidence generation workflow

When a relevant field event exists:

```text
StoreProductEvent
      ↓
Find relevant Need Units
      ↓
Find validated/proposed substitutes
      ↓
Build reference sales baseline
      ↓
Measure actual substitute performance
      ↓
Capture confounding context
      ↓
Generate SubstitutionEvidence
      ↓
Update observed relationship carefully
```

---

# 20. SubstitutionEvidence entity

```ts
type SubstitutionEvidence = {
  id: string;

  storeId: string;

  sourceProductId: string;
  candidateSubstituteProductId: string;

  needUnitId: string;

  eventId: string;

  observationStart: string;
  observationEnd: string;

  referenceMethod: string;

  referenceStart?: string | null;
  referenceEnd?: string | null;

  expectedSalesValue?: number | null;
  actualSalesValue?: number | null;

  expectedQuantity?: number | null;
  actualQuantity?: number | null;

  observedVariationPct?: number | null;

  concurrentCommercialOperationIds: string[];
  concurrentStoreEventIds: string[];

  weatherRecordIds: string[];

  evidenceStrength: number; // 0..1
  dataQuality: number;       // 0..1

  interpretation:
    | "SUPPORTS_SUBSTITUTION"
    | "NEUTRAL"
    | "CONTRADICTS_SUBSTITUTION";

  notes?: string | null;

  createdAt: string;
};
```

---

# 21. Evidence reference periods

The application SHOULD prefer comparable baselines.

Possible reference hierarchy:

1. same weekday and comparable recent period;
2. average of several comparable weekdays;
3. immediately preceding comparable period;
4. other explicitly selected baseline.

The actual method used MUST be stored in `referenceMethod`.

---

# 22. Hour-level limitation

The current Mercalys example is article/day.

If only daily data exists:

- do not fabricate intra-day sales response;
- event timestamps may still be stored;
- evidence must be calculated at the finest reliable available granularity;
- the UI must state when evidence is daily rather than hourly.

Future transaction/hourly data may improve this later.

---

# 23. Causal-safety rule

Observed co-movement is not causal proof.

Example:

```text
Round tomato OUT_OF_STOCK
Turino sales +35%
```

The system may write:

> “Turino sales increased during the round-tomato stockout, which is consistent with substitution.”

It MUST NOT automatically write:

> “The stockout caused 35% additional Turino sales.”

---

# 24. Confounding factors

Evidence generation must inspect at least:

- promotion on substitute;
- promotion on source product;
- TG / special display;
- price change;
- weather;
- holiday;
- school holiday;
- another stockout;
- market tension;
- quality issue;
- partial data coverage.

These factors do not necessarily invalidate evidence.

They reduce or qualify confidence.

---

# 25. Evidence strength

`evidenceStrength` represents how informative one specific observation is.

Example factors:

- duration of tension / stockout;
- clean product match;
- quality of reference period;
- magnitude of deviation;
- presence of confounders;
- complete sales data.

A single strong observation may support a hypothesis but must not create very high global confidence.

---

# 26. Conservative learning rule

The substitution model MUST update gradually.

The MVP SHOULD use a deterministic conservative update.

Example concept:

```text
newObservedSubstitution =
  oldObservedSubstitution × historicalWeight
+ newEvidenceSignal       × evidenceWeight
```

with:

```text
evidenceWeight
```

limited by:

- `evidenceStrength`;
- `dataQuality`;
- current evidence count;
- confounders.

The exact algorithm belongs in the technical specification and test suite.

Functional requirement:

> One isolated event must not radically redefine the substitution graph.

---

# 27. Contradictory evidence

Evidence may contradict an existing substitution hypothesis.

Example:

```text
Source product repeatedly out of stock
Candidate substitute sales remain unchanged or decrease
```

This must be stored as:

```text
interpretation = CONTRADICTS_SUBSTITUTION
```

A mature relationship score may therefore decrease over time.

---

# 28. Confidence evolution

Confidence should grow when:

- multiple independent observations exist;
- their interpretation is consistent;
- data quality is high;
- observations are recent enough;
- confounding factors are limited.

Confidence should NOT grow just because time passed.

---

# 29. Evidence traceability

The user must be able to inspect:

```text
Why is Turino considered a strong substitute?
```

The UI should show:

```text
Business compatibility
Validated by user

Observed events
6 analysed

Supports substitution
4

Neutral
1

Contradicts
1

Last evidence
14 Sep 2026
```

and allow opening the underlying events.

---

# 30. Product sheet requirements

The product sheet is a core UI.

## 30.1 Identity section

Display:

- product label;
- category;
- nature;
- sales unit;
- packaging;
- ITM8;
- EAN;
- PLU;
- family;
- subfamily;
- validation status.

---

## 30.2 French UI example

```text
TOMATE RONDE EN GRAPPE VRAC

Légume · Vrac

Vente
kg

Conditionnement
Vrac

ITM8
0000087004664
```

---

# 31. Need Units on product sheet

Display all memberships.

Example:

```text
Unités de besoin

Tomate polyvalente      Forte
Salade                  Moyenne
Cuisine                 Forte
```

The French UI label remains:

**Unité de besoin**

even though it does not represent quantity.

A help tooltip should clarify:

> “Besoin d’achat que plusieurs produits peuvent satisfaire.”

---

# 32. Substitute section on product sheet

For each substitute display:

- product;
- relationship strength;
- confidence;
- price position;
- margin comparison if available;
- packaging compatibility;
- evidence count.

Example French UI:

```text
Produits substituts

Tomate Turino
Relation forte
Confiance moyenne
Prix proche
Marge supérieure

Tomate côtelée
Relation forte
Confiance faible
Prix plus élevé
```

---

# 33. Product performance and substitution must remain separate

The product sheet may display margin and sales data.

However:

> High margin does not make a product a stronger behavioural substitute.

Recommendation ranking may consider both:

```text
substitution quality
+
commercial attractiveness
```

but the raw substitution relation must remain behavioural.

---

# 34. AI-proposed Need Units

AI may propose:

```text
This product probably belongs to:
TOMATE_POLYVALENTE
```

The proposal must include:

- rationale;
- source product data;
- confidence;
- possible alternatives.

The user may:

- validate;
- modify;
- reject.

---

# 35. AI-proposed substitution links

AI may propose new edges.

Example:

```text
Tomate ronde
→ Tomate Turino
```

with rationale:

```text
Same tomato use
Comparable price
Similar bulk format
Same customer need
```

The proposal starts as:

```text
status = PROPOSED
```

It must not silently become `VALIDATED`.

---

# 36. AI and evidence

AI may explain evidence.

AI MUST NOT directly alter evidence metrics.

Deterministic code calculates:

- reference;
- actual;
- variation;
- evidence quality;
- score update.

AI may write:

> “This event is compatible with substitution.”

---

# 37. Recommendation engine — substitution use case

When a source product is under tension:

```text
1. Identify Need Units.
2. Find candidate substitutes.
3. Exclude invalid/rejected edges.
4. Inspect relationship score.
5. Inspect confidence.
6. Inspect current substitute availability if manually known.
7. Inspect substitute sales performance.
8. Inspect substitute waste.
9. Inspect current price.
10. Inspect margin.
11. Inspect promotions.
12. Inspect market signals.
13. Inspect field events.
14. Rank commercial options.
```

---

# 38. Commercial ranking vs substitution ranking

These are distinct.

## 38.1 Substitution ranking

Based on behavioural fitness.

## 38.2 Commercial recommendation ranking

May additionally use:

- price;
- margin;
- waste;
- promotion status;
- market availability;
- merchandising opportunity.

The UI must not describe the commercially preferred product as the “best substitute” unless it also has the strongest behavioural relation.

---

# 39. Example recommendation

French UI example:

```text
Tension sur la tomate ronde

Substitut principal détecté :
Tomate Turino

Pourquoi ?
• même unité de besoin
• usage très proche
• prix proche
• relation observée lors de 4 tensions précédentes
• marge actuelle supérieure

Confiance
Moyenne

Action suggérée
Renforcer la visibilité de la Turino à proximité de la tomate ronde et surveiller sa disponibilité.
```

---

# 40. Counter-promotion interaction

The substitution graph must be considered before proposing a counter-promotion.

Example:

```text
National promotion:
Tomate côtelée

Local candidate:
Tomate Turino
```

If both share a strong Need Unit relation, the application should warn:

```text
Potential substitution/cannibalization overlap.
```

The MVP must not quantify causal cannibalization without a valid method.

---

# 41. Counter-promotion recommendation factors

For each candidate local operation consider:

- current promotion map;
- substitute relationships;
- customer need overlap;
- price gap;
- margin;
- waste;
- market tension;
- observed stock/tension;
- historical performance.

Possible output:

```text
Avoid simultaneous local price promotion on Turino because it strongly overlaps the same customer need as the national ribbed-tomato promotion.
```

or:

```text
Use Turino as an availability substitute rather than a second price-promotion focus.
```

---

# 42. Weekly commercial preparation interaction

When the weekly PDF contains:

```text
Market tension on Product A
```

the weekly planning flow must surface:

```text
Potential substitutes
```

for A.

The manager should be able to:

- inspect candidates;
- confirm or reject;
- add a local merchandising action;
- record expected monitoring.

---

# 43. Field workflow for tension

## 43.1 Quick event action

From a product sheet:

```text
Signaler
```

Options:

```text
Tension
Stock faible
Rupture
Problème qualité
Hausse de prix
Problème fournisseur
```

---

## 43.2 Minimal event input

Required:

- product;
- event type;
- start date/time.

Optional:

- end date/time;
- severity;
- note.

---

## 43.3 Closing an event

The user must be able to mark:

```text
Rupture terminée
```

with end date/time.

---

# 44. Evidence-generation timing

Evidence should not be evaluated before the observation period is complete enough.

Example:

```text
OUT_OF_STOCK remains active
```

The system may show:

```text
Evidence pending
```

rather than producing a final relationship update.

---

# 45. Product availability in MVP

The MVP does not implement a full theoretical stock system.

Therefore availability is represented through:

- user-entered tension events;
- PDF market signals;
- optional manual stock observation;
- future connectors.

Do not infer “overstock” or “stockout” from sales alone.

---

# 46. Price comparison rules

Price compatibility requires comparable bases.

Valid examples:

```text
€/kg vs €/kg
€/piece vs €/piece
```

Potentially valid after explicit conversion:

```text
pack price → €/kg
```

only if packaging weight is known and business-compatible.

If no conversion exists:

```text
priceCompatibility = UNKNOWN / not available
```

Do not force a score.

---

# 47. Margin comparison rules

Margin shown in substitute recommendations should use validated business metrics only.

Until Mercalys HT/TTC and margin conventions are finalized:

- preserve source margin values;
- label them as source values;
- do not invent normalized gross margin semantics.

---

# 48. Packaging compatibility

Packaging compatibility may consider:

- bulk vs bulk;
- piece vs piece;
- pack vs pack;
- comparable pack size;
- conversion feasibility.

This metric is behavioural friction, not strict equivalence.

---

# 49. Need Unit management screen

Under `Plus` / configuration, provide a management interface.

User can:

- create Need Unit;
- rename;
- edit description;
- deactivate;
- view member products;
- add/remove membership;
- inspect AI suggestions.

---

# 50. Substitution network management screen

Provide a graph/list management view.

The MVP mobile UI may default to list view.

Desktop may provide an interactive graph.

Each relation shows:

- source;
- substitute;
- Need Unit;
- score;
- confidence;
- status;
- evidence count.

---

# 51. Validation workflow

## 51.1 Membership proposal

```text
PROPOSED
→ VALIDATED
or
→ REJECTED
```

## 51.2 Substitution proposal

```text
PROPOSED
→ VALIDATED
→ LEARNING
```

or:

```text
PROPOSED
→ REJECTED
```

A validated relation may enter `LEARNING` once field evidence exists.

---

# 52. Manual override

The user may manually adjust:

- Need Unit membership;
- relationship validity;
- business classification.

The system should preserve:

- old value;
- new value;
- timestamp;
- user;
- reason if provided.

Manual override must not delete historical evidence.

---

# 53. Score override policy

Avoid unrestricted manual numeric score editing by default.

Preferred user actions:

```text
Not a substitute
Weak substitute
Medium substitute
Strong substitute
```

The system maps these to configured initial ranges.

Advanced numeric editing may exist in admin mode.

---

# 54. Learning must never override explicit rejection

If a user marks:

```text
A → B = REJECTED
```

new automated evidence must not silently reactivate the relation.

The system may propose:

```text
New evidence suggests reconsideration
```

but human confirmation is required.

---

# 55. Learning must never erase business reasoning

Each relation should retain:

- initial source;
- manual rationale;
- AI rationale if any;
- evidence trail;
- score history.

---

# 56. Relationship history

Create audit entity:

```ts
type SubstitutionScoreHistory = {
  id: string;

  substitutionId: string;

  previousScore: number;
  newScore: number;

  previousConfidence: number;
  newConfidence: number;

  reason:
    | "INITIAL"
    | "USER_VALIDATION"
    | "NEW_EVIDENCE"
    | "MANUAL_OVERRIDE"
    | "CONFIGURATION_CHANGE";

  evidenceIds: string[];

  createdAt: string;
};
```

---

# 57. Store-specific learning

Observed substitution behaviour is store-specific.

A relationship may have:

```text
global/business baseline
+
store-specific evidence
```

MVP pilot scope is one store.

The model should still be designed so future multi-store learning does not require breaking schema changes.

---

# 58. Global vs store relation

Recommended conceptual model:

```text
Business relationship prior
          ↓
Store-specific observed evidence
          ↓
Store relationship state
```

Future multi-store versions may compare:

```text
network-wide relation
vs
store-specific relation
```

but MVP only needs store-specific operational output.

---

# 59. Time decay

Old evidence may become less representative.

The technical design may later introduce recency weighting.

Functional rule:

> The system should not treat a five-year-old observation as equally representative as a recent repeated pattern.

Exact time decay is not required in MVP v0.1 unless implemented deterministically.

---

# 60. Seasonal context — future-compatible

Substitution may eventually vary by:

- season;
- price gap;
- weather;
- promotion;
- customer mission.

MVP MUST NOT create separate seasonal models yet.

However evidence must retain enough context for future analysis.

---

# 61. Data quality states

For each relationship, expose:

```text
High confidence
Medium confidence
Low confidence
Insufficient evidence
```

French UI:

```text
Confiance élevée
Confiance moyenne
Confiance faible
Données insuffisantes
```

---

# 62. Evidence quality states

For an individual evidence record:

```text
Strong
Usable
Weak
Rejected
```

Reject evidence when:

- sales import missing;
- candidate product unmatched;
- reference invalid;
- event dates impossible;
- severe unresolved data issue.

---

# 63. Duplicate field events

If the same user creates duplicate overlapping stockout events for the same product:

- detect probable duplicate;
- request reconciliation;
- do not generate double evidence.

---

# 64. Overlapping tension events

Different event types may overlap.

Example:

```text
QUALITY_ISSUE
+
LOW_STOCK
```

The system may retain both.

Evidence should reference all relevant concurrent events.

---

# 65. Multiple substitute effects

A source-product tension may affect multiple substitutes.

Evidence is generated per candidate relation:

```text
A → B
A → C
A → D
```

Do not allocate a fixed “lost volume” across substitutes unless a validated future model supports it.

---

# 66. Negative substitution signal

If source A is unavailable and candidate B does not increase:

this may weaken:

```text
A → B
```

but only when baseline quality and context are sufficient.

---

# 67. Promotion confounder example

Given:

```text
A = OUT_OF_STOCK
B = +50% sales
B also on national promotion
```

Evidence should probably be:

```text
SUPPORTS_SUBSTITUTION or NEUTRAL
with low evidence strength
```

depending on deterministic rules.

The system MUST expose:

```text
Concurrent promotion on B
```

---

# 68. Product-quality confounder

If substitute B has a quality issue, weak sales during A's stockout do not necessarily disprove substitution.

The evidence engine must capture that context.

---

# 69. Price-shock confounder

If substitute B price increased substantially, customer transfer may be reduced.

This should influence evidence interpretation and recommendation context.

---

# 70. Recommendation scoring

Recommendation ranking is separate from relationship scoring.

Possible deterministic factors:

```text
urgency
economicImpact
relationshipStrength
relationshipConfidence
priceCompatibility
marginAttractiveness
wasteRisk
promotionConflict
dataQuality
```

The exact formula belongs to recommendation-engine configuration.

---

# 71. Do not optimise only for margin

A high-margin candidate with poor customer substitution fit must not outrank a clearly better substitute solely because of margin.

Behavioural relevance comes first.

---

# 72. Explainability requirement

Every substitute recommendation MUST answer:

```text
Why this product?
```

Possible reasons:

- same Need Unit;
- strong validated relationship;
- similar price;
- compatible packaging;
- repeated observed substitution;
- favourable margin;
- low waste;
- available commercial opportunity.

---

# 73. Recommendation confidence

Recommendation confidence is separate from substitution confidence.

Example:

```text
Substitution confidence = HIGH
Recommendation confidence = MEDIUM
```

because:

```text
current availability unknown
```

---

# 74. Product relationship APIs — functional contract

Technical implementation may expose operations equivalent to:

```text
GET product
GET product need units
GET product substitutes
POST need unit
POST membership proposal
VALIDATE membership
REJECT membership
POST substitution proposal
VALIDATE substitution
REJECT substitution
POST store event
CLOSE store event
GET substitution evidence
GET score history
```

Exact HTTP design belongs to technical specs.

---

# 75. Product merge

If duplicate products are detected:

- do not blindly delete one;
- provide merge workflow;
- migrate aliases;
- migrate identifiers;
- preserve sales/waste links;
- preserve Need Unit memberships;
- preserve substitution evidence;
- preserve audit history.

---

# 76. Product split

If one incorrectly merged product must be split:

- require explicit admin workflow;
- do not automatically redistribute historical observations;
- mark affected evidence for review.

---

# 77. Unknown products

A new unmatched product may exist temporarily as:

```text
Product.status = TO_REVIEW
category = UNKNOWN
nature = UNKNOWN
```

The system must keep imported business observations but flag analytics requiring classification.

---

# 78. Unknown Need Unit

The application must not invent a Need Unit merely to complete a recommendation.

AI may propose one, but user validation is required before it becomes a trusted business grouping.

---

# 79. Bulk / packaged classification

Nature belongs to Product.

For waste receipt lines:

```text
line.productNature
```

is inherited from the matched Product after validation.

If the product is unknown:

```text
UNKNOWN
```

and the line remains an exception where classification matters.

---

# 80. Category correction

If a product category changes:

```text
OTHER → FRUIT
```

historical observations remain attached to the same Product.

Analytical category rollups are reconstructed using the current validated classification unless historical classification versioning is later required.

---

# 81. Application language

All user-facing screens must be French.

The implementation may use English internal enum names.

Example:

```text
OUT_OF_STOCK
```

French label:

```text
Rupture
```

---

# 82. French terminology mapping

Recommended labels:

```text
ProductCategory.FRUIT      → Fruit
ProductCategory.VEGETABLE  → Légume
ProductNature.BULK         → Vrac
ProductNature.PACKAGED     → Non-vrac / Conditionné
NeedUnit                   → Unité de besoin
Substitute                 → Produit substitut
Relationship score         → Force de relation
Confidence                 → Confiance
Evidence                   → Observation
TENSION                    → Tension
LOW_STOCK                  → Stock faible
OUT_OF_STOCK               → Rupture
QUALITY_ISSUE              → Problème qualité
PRICE_INCREASE             → Hausse de prix
SUPPLIER_SHORTAGE          → Tension fournisseur
```

Final French copy can be refined during UX specification.

---

# 83. Product sheet — mobile layout recommendation

Recommended structure:

```text
[Product name]

Fruit / Légume
Vrac / Non-vrac

Identifiers
Packaging
Sales unit

Performance

Need Units

Substitutes

Observed tension events

Substitution evidence

Promotions

Waste
```

Exact visual layout belongs to UX specification.

---

# 84. Today screen integration

If a currently relevant product tension exists:

```text
Aujourd’hui
```

may display:

```text
Tension tomate ronde
Substitut à surveiller : Turino
```

with link to relation details.

---

# 85. Weekly screen integration

For each commercial market signal:

```text
Tension annoncée
```

show:

```text
Produits substituts potentiels
```

before the manager confirms weekly actions.

---

# 86. Analysis screen integration

Add views:

```text
Substitution
```

Potential metrics:

- most evidenced relationships;
- recent stockout effects;
- products frequently acting as substitutes;
- relations with low confidence;
- contradictory evidence.

---

# 87. Learning review screen

Provide a review queue:

```text
Nouvelles observations à examiner
```

Examples:

```text
Tomate ronde → Turino
3 new evidence records
Score may increase
```

User may inspect before approving a major relation-status change if configured.

---

# 88. Automatic vs manual score updates

MVP preferred approach:

- deterministic small automatic updates;
- audit history always;
- manual validation required for creation of materially new relationships;
- rejected relations never auto-reactivated.

---

# 89. Initial graph bootstrapping

The initial graph may be created through:

1. manual business setup;
2. AI suggestions;
3. existing product taxonomy;
4. future sales evidence.

The application should support bootstrapping even with zero historical evidence.

---

# 90. Cold-start behaviour

With no evidence:

```text
relationshipScore
```

may rely on validated business compatibility.

```text
confidence
```

must remain low.

Example:

```text
Relation forte
Confiance faible
Aucune observation magasin à ce jour
```

---

# 91. Evidence accumulation example

Illustrative only:

```text
Initial:
Round tomato → Turino
score 0.80
confidence 0.20

After event 1:
supports substitution
score 0.82
confidence 0.29

After event 2:
supports substitution
score 0.84
confidence 0.39

After event 3:
neutral
score 0.83
confidence 0.46
```

The exact numeric update algorithm is NOT defined by these example values.

---

# 92. Relationship review trigger

The system should flag a relationship for review when:

- score moves significantly;
- repeated contradictory evidence appears;
- product packaging materially changes;
- price compatibility changes dramatically;
- user rejects repeated AI recommendations;
- product becomes inactive.

---

# 93. Product inactivity

Inactive products remain in history.

They may remain in old evidence but should not be recommended as current substitutes unless reactivated.

---

# 94. Future product replacement

If a new SKU replaces an old SKU:

the system may create a business relation:

```text
REPLACEMENT_OF
```

in a future model.

Do not misuse substitution edge semantics to represent pure SKU replacement unless customer behaviour is actually substitutive.

---

# 95. Auditability

Every functional object affecting recommendations must be traceable:

- Product;
- identifier;
- alias;
- Need Unit;
- membership;
- substitution;
- field event;
- evidence;
- score update;
- user override.

---

# 96. Security

Product/business-network data is private store operational data.

No public exposure by default.

Audit history must be accessible only to authorized users.

---

# 97. Acceptance criteria

## PS-AC-01 — Independent category and nature

**Given:** packaged apple and bulk tomato.  
**Expected:**

```text
Apple:
category = FRUIT
nature = PACKAGED

Tomato:
category = VEGETABLE
nature = BULK
```

---

## PS-AC-02 — Packaging

**Given:** `Pomme Gala sachet 1.5 kg`.  
**Expected:**

```text
packaging.quantity = 1.5
packaging.unit = KG
```

without confusing this with sold quantity.

---

## PS-AC-03 — Need Unit is not quantity

**Given:** `TOMATE_POLYVALENTE`.  
**Expected:** it contains products representing the same purchase intention and has no order quantity semantics.

---

## PS-AC-04 — Many-to-many membership

**Given:** cherry tomato.  
**Expected:** it can belong to several Need Units.

---

## PS-AC-05 — Category differs from Need Unit

**Given:** tomato product.  
**Expected:** `VEGETABLE` remains taxonomy while `TOMATE_POLYVALENTE` remains customer need.

---

## PS-AC-06 — Directed relation

**Given:** A → B validated.  
**Expected:** B → A is not automatically created.

---

## PS-AC-07 — Separate score and confidence

**Given:** strong manually validated relation with no field history.  
**Expected:** relationship may be high while confidence remains low.

---

## PS-AC-08 — Field stockout evidence

**Given:** user records A as OUT_OF_STOCK.  
**Expected:** candidate substitutes are analysed after sufficient sales data exists.

---

## PS-AC-09 — No causal overclaim

**Given:** B sales increase during A stockout.  
**Expected:** application records evidence compatible with substitution, not causal proof.

---

## PS-AC-10 — Promotion confounder

**Given:** B is promoted during A stockout.  
**Expected:** concurrent promotion is stored and evidence confidence/strength is reduced or qualified.

---

## PS-AC-11 — Repeated supporting evidence

**Given:** several clean events support A → B.  
**Expected:** observed substitution and confidence may gradually increase.

---

## PS-AC-12 — Contradictory evidence

**Given:** several high-quality events contradict A → B.  
**Expected:** relationship may weaken and review may be triggered.

---

## PS-AC-13 — Single-event protection

**Given:** one extreme event.  
**Expected:** confidence remains limited and score movement is conservative.

---

## PS-AC-14 — Rejected relation

**Given:** user rejects A → B.  
**Expected:** future evidence does not silently reactivate it.

---

## PS-AC-15 — Evidence traceability

**Given:** user opens substitute relation.  
**Expected:** underlying evidence and score history can be inspected.

---

## PS-AC-16 — Price compatibility invalid units

**Given:** A priced €/kg and B priced €/pack with unknown pack weight.  
**Expected:** no fabricated price compatibility score.

---

## PS-AC-17 — Margin does not redefine substitution

**Given:** B has much higher margin but poor customer-need fit.  
**Expected:** B is not ranked as strongest behavioural substitute solely because of margin.

---

## PS-AC-18 — Weekly market tension

**Given:** commercial PDF reports tension on A.  
**Expected:** system surfaces potential substitutes but does not mark A as store-level stockout.

---

## PS-AC-19 — Store vs market source

**Given:** PDF tension plus user-entered stockout.  
**Expected:** both remain separate events with separate provenance.

---

## PS-AC-20 — Inactive substitute

**Given:** candidate B is inactive.  
**Expected:** it remains in historical evidence but is not recommended operationally.

---

## PS-AC-21 — Product merge

**Given:** duplicate product records are merged.  
**Expected:** Need Unit membership, substitution links and evidence remain preserved and traceable.

---

## PS-AC-22 — Unknown product

**Given:** unmatched product imported.  
**Expected:** product may remain TO_REVIEW without invented classification.

---

## PS-AC-23 — French UI

**Given:** internal enum `OUT_OF_STOCK`.  
**Expected:** user sees `Rupture`.

---

# 98. Out of scope for this functional version

Not required for MVP Product & Substitution v0.1:

- customer-level identity;
- loyalty-card behaviour;
- basket-level substitution detection;
- causal econometric substitution estimation;
- automatic price elasticity;
- minute-by-minute sales;
- multi-store benchmarking;
- season-specific graph models;
- customer-segment-specific graph models;
- automatic purchasing;
- automated stock optimization;
- autonomous execution in Mercalys;
- deep graph neural networks;
- opaque black-box relationship scoring.

---

# 99. Implementation guidance for the development agent

The development agent MUST favour:

- explicit entities;
- immutable source history;
- deterministic scoring;
- auditable updates;
- human validation;
- explainable recommendations;
- safe handling of unknown data.

Do not implement substitution as a single opaque LLM prompt.

The substitution capability is a business subsystem composed of:

```text
Product Master
+
Need Unit Model
+
Directed Graph
+
Field Events
+
Sales Evidence
+
Deterministic Scoring
+
AI Explanation
+
Human Validation
```

---

# 100. Final functional invariant

The most important invariant is:

> **A substitution relationship represents a customer-behaviour hypothesis that becomes progressively better informed by actual store evidence.**

It is not:

- a merchandising preference;
- a margin ranking;
- a product family;
- a quantity;
- a static AI opinion.

The system must always preserve the distinction between:

```text
What the product is
What customer need it satisfies
What may substitute for it
What has actually been observed
How confident the system is
What commercial action is recommended
```

This distinction is mandatory across the data model, scoring engine, AI layer and user interface.
