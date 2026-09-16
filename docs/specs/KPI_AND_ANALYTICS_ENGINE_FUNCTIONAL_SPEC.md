# KPI & Analytics Engine Functional Specification

**Product:** Fruits & Vegetables Copilot  
**Document:** `KPI_AND_ANALYTICS_ENGINE_FUNCTIONAL_SPEC.md`  
**Version:** 0.1  
**Date:** 16 September 2026  
**Specification language:** English  
**Application language:** French (`fr-FR`)  
**Primary user:** Fruits & Vegetables Department Manager — Intermarché  
**Scope:** Deterministic KPI computation, analytical dimensions, comparisons, waste analytics, promotion analytics, substitution analytics, anomaly detection, data quality, and machine-readable insight candidates for the AI layer.

---

# 1. Purpose

This document defines the **KPI & Analytics Engine** for the Fruits & Vegetables Copilot.

The engine is responsible for turning validated business observations into deterministic analytical outputs.

It must answer questions such as:

- How is the department performing?
- Which products explain the change?
- Which products generate the most waste?
- Which products are deteriorating?
- Which commercial operations appear to perform differently from their baseline?
- Which products may be affected by a market tension or stockout?
- Which substitutes appear to absorb demand?
- Which metrics are reliable enough to support a recommendation?
- Which data is missing or too weak to interpret safely?

The analytics engine is NOT the AI assistant.

It produces trusted, testable business facts and signals that the AI layer can later explain.

---

# 2. Core architecture principle

The analytical architecture must follow:

```text
Validated source observations
        ↓
Deterministic normalization
        ↓
Deterministic KPI engine
        ↓
Comparison engine
        ↓
Analytical signals
        ↓
AI explanation / recommendation
        ↓
Human decision
```

The AI must not become the calculator of record.

---

# 3. Functional invariant

> **Every displayed number must be reproducible from stored validated inputs, a named formula, and an explicit analytical perimeter.**

For each KPI, the system must know:

- source fields;
- formula;
- unit;
- aggregation rule;
- dimensions;
- time perimeter;
- missing-data rule;
- quality requirements;
- comparison method;
- display label;
- whether the KPI is official/source-derived or application-derived.

---

# 4. Terminology

Until the Mercalys business dictionary is fully validated, the application must preserve source semantics.

Therefore this specification uses names such as:

```text
salesValue
purchaseValue
sourceMarginValue
sourceMarginRate
```

instead of prematurely asserting:

```text
Revenue HT
Revenue TTC
Gross margin
Net margin
```

The French UI may display business-friendly names only after their semantic definition is validated.

---

# 5. Analytical input sources

The engine consumes validated records from the following domains.

## 5.1 Sales

```ts
SalesObservation
```

Expected fields:

```ts
type SalesObservation = {
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

---

## 5.2 Waste

```ts
WasteObservation
```

Expected fields include:

```ts
type WasteObservation = {
  storeId: string;
  productId: string;
  date: string;

  productNature: "BULK" | "PACKAGED" | "UNKNOWN";

  quantity?: number | null;

  purchaseValueKnown?: number | null;
  purchaseValueEstimated?: number | null;
  salesValue?: number | null;

  costQuality:
    | "KNOWN"
    | "ESTIMATED"
    | "UNKNOWN";

  validationStatus:
    | "DRAFT"
    | "VALIDATED"
    | "TO_REVIEW";

  sourceType:
    | "MERCALYS_WASTE"
    | "WASTE_RECEIPT";
};
```

Only validated observations can feed official KPIs.

---

## 5.3 Product master

The engine consumes:

- Product;
- ProductCategory;
- ProductNature;
- Family;
- Subfamily;
- SalesUnit;
- Packaging;
- NeedUnit;
- ProductNeedMembership;
- ProductSubstitution.

---

## 5.4 Commercial operations

The engine consumes validated:

- CommercialOperation;
- Offer;
- MerchandisingPlan;
- ExecutionInstruction;
- execution status;
- actual execution dates;
- actual applied price where known.

---

## 5.5 Context

The engine consumes:

- WeatherRecord;
- public holidays;
- school holidays;
- ContextEvent;
- MarketSignal;
- StoreProductEvent.

---

## 5.6 Substitution evidence

The engine consumes:

- ProductSubstitution;
- SubstitutionEvidence;
- relationship score;
- relationship confidence;
- store-level tension events.

---

# 6. Analytical dimensions

Every KPI must declare which dimensions it supports.

Core dimensions:

```text
Store
Date
Week
Month
Product
Product Category
Product Family
Product Subfamily
Product Nature
Sales Unit
Need Unit
Commercial Operation
Promotion Mechanism
Waste Source
Context Event
Market Signal
Substitution Relation
```

---

# 7. Time dimensions

The engine must support:

```text
DAY
WEEK
MONTH
CUSTOM_PERIOD
```

Future support may include:

```text
HOUR
DAY_PART
```

but these are out of scope while current Mercalys sales data remains article/day.

---

# 8. Business date vs import date

Analytical time must always use the business observation date.

Do not use:

- report generation timestamp;
- upload timestamp;
- file creation timestamp;

as the date of sales or waste performance.

---

# 9. Metric registry

Every KPI must be registered centrally.

Recommended contract:

```ts
type KpiDefinition = {
  id: string;

  name: string;
  frenchLabel: string;

  description: string;
  businessQuestion: string;

  category:
    | "SALES"
    | "MARGIN"
    | "WASTE"
    | "PROMOTION"
    | "SUBSTITUTION"
    | "DATA_QUALITY"
    | "EXECUTION"
    | "CONTEXT";

  formulaId: string;

  unit:
    | "CURRENCY"
    | "PERCENT"
    | "KG"
    | "PIECE"
    | "COUNT"
    | "INDEX"
    | "NONE";

  aggregationMethod:
    | "SUM"
    | "WEIGHTED"
    | "RATIO_OF_SUMS"
    | "AVERAGE"
    | "MEDIAN"
    | "LAST_VALUE"
    | "CUSTOM";

  supportedDimensions: string[];

  requiredInputs: string[];

  missingDataPolicy: string;

  qualityRequirements: string[];

  sourceType:
    | "SOURCE"
    | "DERIVED";

  status:
    | "ACTIVE"
    | "EXPERIMENTAL"
    | "DISABLED";
};
```

---

# 10. KPI computation contract

Every computed KPI result should expose:

```ts
type KpiResult = {
  kpiId: string;

  perimeter: {
    storeId: string;
    startDate: string;
    endDate: string;

    productId?: string;
    category?: string;
    familyId?: string;
    subfamilyId?: string;
    needUnitId?: string;
    commercialOperationId?: string;
  };

  value?: number | null;

  unit: string;

  status:
    | "AVAILABLE"
    | "PARTIAL"
    | "UNAVAILABLE";

  qualityScore: number; // 0..1

  coverage?: number | null;

  inputCount: number;

  missingInputs: string[];

  sourceLineageIds: string[];

  computedAt: string;
};
```

---

# 11. Core sales KPIs

## 11.1 Sales value

```text
sales_value
```

Definition:

```text
sum(validated SalesObservation.salesValue)
```

French UI placeholder:

```text
Ventes
```

Final wording must remain configurable until HT/TTC semantics are fully validated.

---

## 11.2 Sold quantity

```text
sold_quantity
```

Definition:

```text
sum(quantity)
```

ONLY when all aggregated records use compatible sales units.

Never sum:

```text
kg + pieces
```

into one numeric quantity.

---

## 11.3 Purchase value of sold goods

```text
sales_purchase_value
```

Definition:

```text
sum(SalesObservation.purchaseValue)
```

when available.

---

## 11.4 Source margin value

```text
source_margin_value
```

Definition:

```text
sum(SalesObservation.marginValue)
```

This remains a Mercalys-source metric until business semantics are validated.

---

## 11.5 Source margin rate

Do NOT calculate:

```text
average(line.marginRate)
```

for aggregate margin rate.

Preferred rule after business validation:

```text
ratio derived from aggregate source-compatible values
```

Until the margin formula is validated:

- preserve product-line source margin rates;
- show aggregate source margin rate only if a validated formula exists.

---

# 12. Average realized price

## 12.1 Formula

Where quantity and price basis are compatible:

```text
average_realized_price =
sum(salesValue) / sum(quantity)
```

---

## 12.2 Unit

Examples:

```text
€/kg
€/piece
€/pack
```

Do not compute across mixed units.

---

## 12.3 Use case

Useful to compare:

- regular period;
- promotion period;
- pre-promotion period;
- post-promotion period.

---

# 13. Product coverage KPI

```text
active_products_observed
```

Definition:

```text
count(distinct productId with validated sales or waste observation)
```

This is NOT the full active assortment unless the source supports that conclusion.

French UI should avoid wording implying complete assortment coverage.

---

# 14. Waste KPI model

Waste must be analysed through several distinct economic perspectives.

---

# 15. Waste quantity

```text
waste_quantity
```

Definition:

```text
sum(validated WasteObservation.quantity)
```

only within compatible sales units.

---

# 16. Known purchase-cost waste

```text
waste_purchase_value_known
```

Definition:

```text
sum(purchaseValueKnown)
```

only for:

```text
costQuality = KNOWN
```

---

# 17. Estimated purchase-cost waste

```text
waste_purchase_value_estimated
```

Definition:

```text
sum(purchaseValueEstimated)
```

only for:

```text
costQuality = ESTIMATED
```

This value must never be silently merged with known cost.

---

# 18. Total purchase-cost waste view

The UI may display:

```text
Known: €164
Estimated: €20
Total view: €184
```

but the API result must preserve the two components separately.

---

# 19. Selling-price waste value

```text
waste_sales_value
```

Definition:

```text
sum(WasteObservation.salesValue)
```

This is not sales revenue.

Recommended French wording:

```text
Valeur de vente de la casse
```

or equivalent.

Do not imply this value would necessarily have been realized as sales.

---

# 20. Waste by product nature

Supported dimensions:

```text
BULK
PACKAGED
UNKNOWN
```

Business rule:

```text
Product nature comes from the product,
not from waste source channel.
```

Packaged items extracted from a photographed ticket are still classified as packaged waste.

---

# 21. Waste by source

Separate source dimension:

```text
MERCALYS_WASTE
WASTE_RECEIPT
```

This dimension must remain independent from:

```text
BULK
PACKAGED
```

---

# 22. Waste purchase-cost ratio

Only after numerator and denominator business meaning are validated.

Possible metric:

```text
waste_purchase_cost_to_sales_value
=
known purchase-cost waste / salesValue
```

The French label MUST name the basis.

Do not call it simply:

```text
Taux de casse
```

if multiple waste-rate definitions exist.

---

# 23. Waste selling-value ratio

```text
waste_sales_value_to_sales_value
=
waste sales value / sales value
```

This is a separate indicator.

---

# 24. Share of known outputs wasted

Where units are compatible:

```text
waste_output_share =
waste quantity
/
(sold quantity + waste quantity)
```

This means:

> share of known outputs represented by waste.

It is NOT:

- stock loss rate;
- shrink rate against inventory;
- percentage of initial stock.

French UI must clarify the denominator.

---

# 25. Waste recurrence

```text
waste_days_count
```

Definition:

```text
number of days in selected period where waste > 0
```

---

# 26. Waste frequency

```text
waste_frequency
=
waste days / observed business days
```

Only compute if observed business days are known.

---

# 27. Waste acceleration

Example:

```text
current_period_waste
vs
reference_period_waste
```

Outputs:

- absolute difference;
- percentage difference where denominator is non-zero.

---

# 28. Waste contribution

For each product:

```text
product_waste_contribution =
product waste value / total waste value
```

Use a named basis:

```text
known purchase-cost contribution
```

or:

```text
selling-price waste contribution
```

Do not mix bases.

---

# 29. Data completeness for waste cost

```text
waste_cost_coverage
=
waste lines/value with known cost
/
eligible waste lines/value
```

The implementation may expose both:

```text
line coverage
value coverage
```

when useful.

---

# 30. Comparison engine

Comparisons are a first-class subsystem.

Supported comparison modes:

```ts
type ComparisonMode =
  | "J_MINUS_7"
  | "PREVIOUS_COMPARABLE_WEEK"
  | "AVERAGE_PREVIOUS_SAME_WEEKDAY"
  | "YEAR_OVER_YEAR"
  | "BEFORE_OPERATION"
  | "CUSTOM_REFERENCE";
```

---

# 31. J-7

For a daily result:

```text
current business date
vs
same weekday 7 days earlier
```

If reference data is absent:

```text
comparison status = UNAVAILABLE
```

Do not assume zero.

---

# 32. Previous comparable week

Compare equivalent business days.

Example:

```text
Mon-Sat current week
vs
Mon-Sat previous week
```

Do not compare six current days with seven previous days unless explicitly normalized and labelled.

---

# 33. Average previous same weekday

Example:

```text
current Wednesday
vs
previous 4 available comparable Wednesdays
```

The output must include:

```text
reference sample size = 4
```

If only 2 comparable Wednesdays are available:

the UI must not label it:

```text
Moyenne des 4 derniers mercredis
```

Instead:

```text
Moyenne de 2 mercredis comparables
```

---

# 34. Year-over-year

Only available if comparable N-1 history exists.

No synthetic N-1.

---

# 35. Before-operation comparison

For a promotion lasting N days:

preferred baseline:

```text
N comparable days before operation
```

The exact comparison method must be stored.

---

# 36. Variation formula

Where reference value is valid and non-zero:

```text
variation_absolute =
current - reference
```

```text
variation_pct =
(current - reference) / abs(reference) × 100
```

If reference is zero:

- absolute variation is available;
- percentage variation should be marked unavailable or specially handled;
- do not display infinite percentage.

---

# 37. Contribution-to-change engine

Percentage variation alone is insufficient for prioritization.

For each product:

```text
contribution_to_sales_change =
current sales value
-
reference sales value
```

This identifies products driving total movement.

---

# 38. Positive contribution ranking

Rank products by:

```text
largest positive contribution_to_sales_change
```

---

# 39. Negative contribution ranking

Rank products by:

```text
largest negative contribution_to_sales_change
```

---

# 40. Margin contribution ranking

When margin metrics are validated:

```text
current margin value
-
reference margin value
```

---

# 41. Waste contribution-to-change

```text
current waste
-
reference waste
```

using a named waste basis.

---

# 42. Category analytics

Support rollups by:

```text
FRUIT
VEGETABLE
OTHER
UNKNOWN
```

Example metrics:

- sales value;
- source margin value;
- waste;
- change contribution.

Unknown products must remain visible in:

```text
UNKNOWN
```

rather than disappearing.

---

# 43. Family / subfamily analytics

Only show family/subfamily rollups for validated product mappings.

Do not infer family purely from free-text label at analytics time.

AI may propose classification elsewhere, but analytics uses validated classification state.

---

# 44. Product nature analytics

Supported split:

```text
Vrac
Non-vrac
Inconnu
```

Use French UI labels.

---

# 45. Need Unit analytics

Need Unit aggregation is behavioural and must be treated carefully.

Because one product may belong to several Need Units:

> Raw sales MUST NOT be naively summed into every Need Unit and then aggregated across Need Units.

Doing so would double-count sales.

---

# 46. Need Unit analytical modes

Support at least two distinct views.

## 46.1 Membership view

Show products belonging to a Need Unit.

Example:

```text
Need Unit: TOMATE_POLYVALENTE
Products:
- Round tomato
- Turino
- Ribbed tomato
```

No cross-NeedUnit total is implied.

---

## 46.2 Weighted analytical view — optional/experimental

A future weighted view may allocate product performance using membership strength.

This must be explicitly labelled experimental.

Not required for MVP official KPIs.

---

# 47. Commercial-operation analytics

The engine must distinguish:

```text
ANNOUNCED
PLANNED
EXECUTED
CANCELLED
```

Only actual executed periods may be used as executed-promotion analytics.

---

# 48. Promotion windows

For an executed operation:

```text
BEFORE
DURING
AFTER
```

Each window must have:

- start;
- end;
- duration;
- completeness;
- data-quality status.

---

# 49. Promotion KPI set

At minimum:

```text
sales value
sold quantity
purchase value
source margin value
source margin rate if validated
waste quantity
known waste purchase cost
estimated waste purchase cost
waste selling value
average realized price
```

---

# 50. Promotion baseline warning

If the “before” period contains:

- another promotion;
- stockout;
- severe weather event;
- missing data;

the baseline remains usable only with warning / lower comparison quality.

---

# 51. Promotion observed change

The engine may calculate:

```text
during - before
```

and:

```text
during vs comparable reference
```

The UI must call this:

```text
variation observée
```

not:

```text
impact causal
```

---

# 52. Post-promotion effect

The AFTER window may help detect:

- residual demand;
- post-promotion drop;
- waste increase;
- stock residue.

Again, these are observed patterns, not causal proof.

---

# 53. Commercial execution analytics

For each operation track:

```text
planned price
actual price
planned start
actual start
planned end
actual end
planned TG
actual TG
planned communication
actual communication
```

---

# 54. Execution completeness

Possible KPI:

```text
execution_completion_rate
=
completed execution tasks
/
applicable planned execution tasks
```

Only count tasks applicable to the store.

---

# 55. Price execution variance

Where comparable:

```text
actual realized price
vs
planned promotional price
```

Do not infer non-compliance automatically because average realized price may reflect:

- partial period;
- mixed codes;
- thresholds;
- card benefit;
- multiple products.

Use as a signal, not a definitive compliance verdict.

---

# 56. Context overlay engine

Analytics charts must be able to overlay:

- weather;
- public holiday;
- school holiday;
- commercial operation;
- market signal;
- store product event;
- local event.

---

# 57. Weather metrics

MVP may include:

```text
min temperature
max temperature
rainfall
```

Additional variables only if provider supports them.

---

# 58. Forecast vs observed weather

Never mix:

```text
FORECAST
```

with:

```text
OBSERVED
```

in historical performance analysis without explicit labeling.

For retrospective analysis use observed weather.

For planning use forecast weather.

---

# 59. Weather comparison

The engine may calculate:

```text
temperature difference vs comparable date
rainfall difference
```

but must not interpret causality.

---

# 60. Store event analytics

Relevant structured events:

```text
TENSION
LOW_STOCK
OUT_OF_STOCK
QUALITY_ISSUE
PRICE_INCREASE
SUPPLIER_SHORTAGE
```

These events may become analytical markers.

---

# 61. Event-period performance

For a product event:

compute product and substitute performance during:

```text
event period
```

versus a stored reference period where possible.

---

# 62. Substitution analytics

Substitution analytics uses:

- Need Unit membership;
- ProductSubstitution;
- StoreProductEvent;
- SubstitutionEvidence;
- sales data.

---

# 63. Candidate substitute performance

During a source-product tension:

for every eligible substitute candidate compute:

```text
reference sales
event-period sales
absolute difference
percentage difference when valid
promotion flag
market-event flag
data-quality score
```

---

# 64. Substitution signal

The analytics engine may produce a deterministic signal:

```ts
type SubstitutionSignal =
  | "SUPPORTS"
  | "NEUTRAL"
  | "CONTRADICTS"
  | "INSUFFICIENT_DATA";
```

The signal becomes an input to `SubstitutionEvidence`.

---

# 65. No volume-transfer attribution

Do NOT calculate:

```text
Lost sales of A = gained sales of B
```

unless a validated future causal method exists.

---

# 66. Relationship-level analytics

For each ProductSubstitution:

show:

```text
relationship score
confidence
evidence count
supporting evidence count
neutral evidence count
contradicting evidence count
last evidence date
```

---

# 67. Substitution event quality

Event evidence quality should consider:

- source product event precision;
- comparable baseline quality;
- candidate sales completeness;
- concurrent promotions;
- other stockouts;
- weather anomalies;
- candidate quality issue;
- unit compatibility.

---

# 68. Analytical confidence vs relationship confidence

Do not conflate:

```text
KPI / comparison quality
```

with:

```text
substitution relationship confidence
```

A relationship may be strong and well-known, while one specific event comparison is low quality.

---

# 69. Price compatibility analytics

Where comparable:

```text
price_gap_absolute =
candidate average realized price
-
source average realized price
```

```text
price_gap_pct =
price_gap_absolute / abs(source price)
```

Only if unit basis matches.

---

# 70. Margin comparison for substitutes

Where source margin semantics are validated:

show:

```text
source margin rate/value
candidate margin rate/value
difference
```

Margin is a commercial decision input.

It must not modify the behavioural evidence itself.

---

# 71. Waste comparison for substitutes

A substitute may be behaviourally strong but operationally risky if it already has high waste.

The recommendation layer may therefore consume:

```text
candidate waste recurrence
candidate waste trend
candidate waste purchase cost
```

---

# 72. Counter-promotion analytics

The analytics engine supports deterministic scenario calculations.

It does not forecast demand elasticity.

---

# 73. Current margin-per-unit scenario

Where unit and cost semantics are valid:

```text
current_unit_contribution =
current selling price
-
unit purchase cost
```

The label shown to users must be business-validated.

---

# 74. Proposed price scenario

```text
new_unit_contribution =
proposed price
-
unit purchase cost
```

---

# 75. Break-even volume threshold

If the goal is to preserve current contribution amount:

```text
required_volume =
current contribution amount
/
new unit contribution
```

Then:

```text
required_volume_change_pct =
(required_volume - current_volume)
/
current_volume
```

This is a mathematical threshold.

It is NOT a demand forecast.

---

# 76. Scenario safeguards

Do not compute if:

- unit purchase cost unknown;
- proposed price <= cost under disallowed business rules;
- sales unit incompatible;
- current volume missing;
- business margin semantics invalid.

---

# 77. Recommendation-candidate engine

The analytics engine should produce structured candidates.

It should not directly generate prose recommendations.

Example:

```ts
type AnalyticalCandidate = {
  id: string;

  type:
    | "SALES_DROP"
    | "SALES_GROWTH"
    | "WASTE_SPIKE"
    | "MARGIN_DROP"
    | "PROMOTION_UNDERPERFORMANCE"
    | "PROMOTION_OVERPERFORMANCE"
    | "SUBSTITUTION_OPPORTUNITY"
    | "SUBSTITUTION_CONFLICT"
    | "DATA_QUALITY_ALERT"
    | "EXECUTION_GAP";

  entityType:
    | "PRODUCT"
    | "CATEGORY"
    | "COMMERCIAL_OPERATION"
    | "SUBSTITUTION_RELATION";

  entityId: string;

  urgencyScore: number;
  economicImpactScore: number;
  deviationScore: number;
  dataQualityScore: number;

  evidence: AnalyticalEvidence[];

  generatedAt: string;
};
```

---

# 78. Candidate scoring dimensions

At minimum:

```text
Urgency
Economic impact
Deviation from baseline
Data quality
```

Substitution candidates may also use:

```text
relationship strength
relationship confidence
```

---

# 79. Urgency

Examples increasing urgency:

- current stockout;
- active promotion execution issue;
- high waste today;
- pre-order deadline approaching;
- market tension beginning tomorrow.

Urgency is context-dependent.

---

# 80. Economic impact

Prefer absolute economic contribution over percentage-only movement.

Example:

```text
-€210 sales contribution
```

may outrank:

```text
-60% on a €10 product
```

---

# 81. Deviation score

Measures how unusual the observation is relative to selected baseline.

Do not label this as statistical anomaly unless the implementation uses a valid statistical method.

---

# 82. Data-quality score

Candidate priority must be reduced when:

- missing reference;
- incomplete waste cost;
- unresolved product match;
- incomplete period;
- conflicting imports.

---

# 83. Maximum three priorities

The final AI layer may select at most:

```text
3 primary priorities
```

from analytical candidates.

All candidates remain accessible in detailed analytics.

---

# 84. Anomaly detection — MVP approach

MVP should use transparent deterministic rules.

Examples:

```text
large absolute sales decline
large waste increase
margin decline
recurrent waste
promotion execution mismatch
substitute sales increase during stockout
```

Avoid opaque anomaly models in MVP.

---

# 85. Threshold configuration

Thresholds must be configurable.

Example:

```ts
type AnalyticsThresholds = {
  wasteSpikePct?: number;
  salesDropPct?: number;
  minEconomicImpact?: number;
  minReferenceDays?: number;
  minCostCoverage?: number;
};
```

Do not hardcode arbitrary business thresholds in UI components.

---

# 86. Statistical methods — future compatible

Future versions may add:

- robust z-scores;
- seasonality models;
- Bayesian baselines;
- demand forecasting.

MVP should keep analytical contracts compatible but not require these models.

---

# 87. Daily dashboard aggregation

The `Aujourd’hui` screen should consume a daily analytical summary.

Recommended contract:

```ts
type DailyDepartmentSummary = {
  businessDate: string;

  dataStatus: {
    salesImported: boolean;
    wasteImported: boolean;
    wasteCostCoverage: number;
    unresolvedProductCount: number;
  };

  coreKpis: KpiResult[];

  topPositiveContributors: ContributionResult[];
  topNegativeContributors: ContributionResult[];

  topWasteContributors: ContributionResult[];

  activeCommercialOperations: string[];
  activeContextEvents: string[];
  activeProductTensions: string[];

  analyticalCandidateIds: string[];
};
```

---

# 88. Today screen KPI limit

The top of the screen should remain simple.

Recommended primary cards:

```text
Ventes
Marge
Casse au PA
```

subject to final business-dictionary validation.

Additional values belong below or in detail.

---

# 89. “Latest complete day” rule

The dashboard must show:

```text
Dernière journée complète : 15/09/2026
```

when the latest complete imported data is September 15.

It must not show:

```text
Hier
```

if yesterday is incomplete or absent.

---

# 90. Weekly analytical summary

Recommended contract:

```ts
type WeeklyDepartmentSummary = {
  weekStart: string;
  weekEnd: string;

  observedDays: string[];

  completeness: number;

  kpis: KpiResult[];

  contributionRankings: {
    salesPositive: ContributionResult[];
    salesNegative: ContributionResult[];
    waste: ContributionResult[];
  };

  operationReviews: string[];
  marketSignals: string[];
  tensionEvents: string[];
  substitutionSignals: string[];

  analyticalCandidateIds: string[];
};
```

---

# 91. Product analytical summary

```ts
type ProductAnalyticsSummary = {
  productId: string;

  period: {
    start: string;
    end: string;
  };

  kpis: KpiResult[];

  comparisons: ComparisonResult[];

  wasteTrend: TrendResult;

  commercialOperationIds: string[];

  contextEventIds: string[];

  needUnitIds: string[];
  substituteRelationIds: string[];

  substitutionEvidenceIds: string[];

  analyticalCandidateIds: string[];
};
```

---

# 92. ComparisonResult

```ts
type ComparisonResult = {
  kpiId: string;

  currentValue?: number | null;
  referenceValue?: number | null;

  absoluteDifference?: number | null;
  percentageDifference?: number | null;

  referenceMode: ComparisonMode;

  referenceSampleSize?: number | null;

  status:
    | "AVAILABLE"
    | "PARTIAL"
    | "UNAVAILABLE";

  qualityScore: number;

  warnings: string[];
};
```

---

# 93. TrendResult

```ts
type TrendPoint = {
  date: string;
  value?: number | null;

  status:
    | "AVAILABLE"
    | "MISSING";
};
```

Trend charts must preserve missing dates.

Do not convert missing values to zero unless zero is explicitly known.

---

# 94. Data lineage

Every derived result must be traceable.

Recommended:

```ts
type AnalyticalLineage = {
  resultId: string;

  sourceObservationIds: string[];
  productClassificationVersion?: string;
  formulaVersion: string;
  computedAt: string;
};
```

---

# 95. Formula versioning

When a KPI formula changes:

- assign new formula version;
- allow recomputation;
- preserve historical auditability.

Do not silently change business meaning.

---

# 96. Business dictionary versioning

Maintain:

```ts
type BusinessMetricDictionaryVersion = {
  id: string;
  effectiveAt: string;

  definitions: {
    rce?: string;
    margin?: string;
    vatTreatment?: string;
    salesValueMeaning?: string;
  };
};
```

Analytics should reference the dictionary version used.

---

# 97. Data-quality framework

Each analytical result must evaluate quality.

Suggested dimensions:

```text
Source completeness
Product match quality
Cost coverage
Reference quality
Period completeness
Unit compatibility
Execution-data completeness
Context completeness
```

---

# 98. DataQualityResult

```ts
type DataQualityResult = {
  overallScore: number; // 0..1

  components: {
    sourceCompleteness: number;
    productMatchQuality: number;
    costCoverage: number;
    referenceQuality: number;
    periodCompleteness: number;
    unitCompatibility: number;
  };

  warnings: string[];
};
```

---

# 99. Product match coverage

Possible metric:

```text
matched validated product observations
/
total imported product observations
```

Separate by source if useful:

```text
sales match coverage
waste match coverage
PDF product match coverage
```

---

# 100. Period completeness

A weekly period should know:

```text
expected business days
observed business days
```

based on configured store opening calendar.

Do not infer completeness from calendar days alone.

---

# 101. Source completeness

Example:

```text
Sales imported: yes
Waste Excel imported: yes
Waste ticket validation: pending
Weather available: yes
```

The UI should expose this.

---

# 102. Cost coverage

Waste cost analysis requires separate:

```text
known cost coverage
estimated cost coverage
unknown cost share
```

---

# 103. Reference quality

High reference quality may require:

- same weekday;
- complete data;
- no severe confounder;
- enough observations.

Low reference quality must reduce recommendation confidence.

---

# 104. Unit compatibility engine

Before aggregating or comparing quantity, verify:

```text
same sales unit
```

or validated conversion.

---

# 105. Quantity conversion

Only allowed with explicit conversion data.

Example:

```text
Packaged 1.5 kg product
```

may allow:

```text
1 pack → 1.5 kg content
```

but do not automatically reinterpret sold pack count as bulk kg demand without a documented analytical purpose.

---

# 106. Need Unit quantity warning

Even if products share a Need Unit, their quantities may use incompatible units.

Therefore a Need Unit view should prefer:

- sales value;
- contribution;
- product-level quantities separately;

unless a validated normalized quantity model exists.

---

# 107. Promotion mechanism awareness

The analytics engine must distinguish:

```text
fixed price
strict price ceiling
card benefit
threshold price
lot
supplier purchasing discount
```

Do not reduce all mechanics to one “discount percent”.

---

# 108. Card benefit

A card benefit is not automatically equivalent to a lower till price.

Average realized till price analytics must not treat it as direct price reduction unless source semantics support that.

---

# 109. Threshold promotion

Example:

```text
€3.49/kg
€2.99/kg from 1 kg
```

The analytics engine must preserve:

- base price;
- threshold;
- conditional price.

Without transaction-level detail, the engine may be unable to know which portion of sales used the threshold.

Expose this limitation.

---

# 110. Lot promotion

Example:

```text
3 for €X
```

Do not assume every sale used the lot.

Average realized price may help observe the realized result, but transaction-level mechanism adoption is unavailable with current data.

---

# 111. Promotion attribution limitation

The current article/day sales source does not provide customer-ticket-level attribution.

Therefore the engine cannot directly calculate:

- promo redemption rate;
- customer count;
- basket uplift;
- cross-sell basket rate.

These remain unavailable unless a new source is added.

---

# 112. Market-signal analytics

Market signals may be:

```text
availability issue
quality issue
price increase
end of campaign
```

The engine may correlate them with:

- sales;
- price;
- waste;
- substitute behaviour.

It must not claim store-level effect without store evidence.

---

# 113. Product tension analytics

When a `StoreProductEvent` is active, the engine should mark the affected product in:

- daily dashboard;
- product sheet;
- weekly planning;
- substitution analysis.

---

# 114. Tension severity

Severity may affect urgency but not economic-impact calculation.

A severe event on a very low-volume product may still be less economically important than a moderate event on a major product.

---

# 115. Substitution-aware contribution analysis

When source A is in tension:

analyse candidate B using:

```text
B current sales contribution
B reference sales
B promotion status
B relationship score
B relationship confidence
B waste risk
B price position
```

---

# 116. Substitution evidence creation threshold

The analytics engine should not create evidence when:

- source event period invalid;
- no reference data;
- candidate unmatched;
- candidate inactive;
- sales data missing;
- relation rejected.

---

# 117. Substitution evidence status

Recommended:

```text
READY
PENDING_DATA
INSUFFICIENT_DATA
REJECTED
```

before final evidence interpretation.

---

# 118. Reanalysis

When late sales data arrives:

previously pending event evidence should be re-evaluated.

The system must avoid duplicate evidence records for the same event/candidate analytical run.

---

# 119. Recomputability

All analytical views must be rebuildable from normalized validated records.

No critical KPI should exist only as an irreversible stored total.

---

# 120. Caching

Technical implementation may cache analytical results.

Functional rule:

> Cache must be invalidated when underlying validated observations, classifications, execution states or formulas change.

---

# 121. Late correction handling

If a product match changes:

```text
Unknown Product → Correct Product
```

affected analytics must be recomputed.

---

# 122. Product category correction

If:

```text
OTHER → FRUIT
```

category rollups must be recomputed.

---

# 123. Need Unit correction

Need Unit membership changes must not alter official product sales totals.

They only affect Need Unit and substitution analytical views.

---

# 124. Commercial operation correction

If actual execution date changes:

promotion windows must be recomputed.

Do not keep using planned dates for executed-performance analysis.

---

# 125. Weather correction

If provider updates observed weather:

historical context may be recomputed while preserving provider/version lineage where possible.

---

# 126. Analytical warnings

Every result may include warnings.

Examples:

```text
Reference period incomplete
Waste cost coverage only 62%
Promotion overlaps another promotion
Product match pending
Price units incompatible
Store stock unavailable
Market tension is external, not store-level
```

---

# 127. French UI warning examples

```text
Référence incomplète
Coût de casse partiellement connu
Produit à rapprocher
Données insuffisantes
Promotion concomitante
Rupture magasin non confirmée
```

---

# 128. KPI presentation tiers

Recommended UI tiers:

## Tier 1 — Primary

For daily decisions:

```text
Ventes
Marge
Casse
```

## Tier 2 — Diagnostic

```text
Quantité
Prix moyen
Contribution
Taux de casse
Comparaison
```

## Tier 3 — Expert / detail

```text
Coverage
Formula basis
Source lineage
Reference quality
```

---

# 129. Product ranking principles

Support rankings such as:

```text
Top sales contributors
Top sales declines
Top waste contributors
Highest waste increase
Highest recurring waste
Promotion change leaders
Substitute-response leaders
```

---

# 130. Avoid misleading ranking

Never rank only by percentage without minimum denominator.

Example:

```text
+500%
```

on a near-zero product must not automatically be the top priority.

---

# 131. Minimum impact threshold

Candidate ranking may require:

```text
minimum economic impact
```

configurable per store.

---

# 132. Daily analytical candidate examples

Examples:

```text
Waste spike on Avocado
Sales decline on Banana
Strong substitute response on Turino
Promotion execution gap on Ribbed Tomato
Data-quality issue on waste costs
```

---

# 133. Candidate evidence contract

```ts
type AnalyticalEvidence = {
  label: string;
  value?: number | string | null;

  sourceType:
    | "KPI"
    | "COMPARISON"
    | "EVENT"
    | "COMMERCIAL_OPERATION"
    | "SUBSTITUTION"
    | "DATA_QUALITY";

  sourceId: string;
};
```

---

# 134. AI handoff contract

The AI layer receives structured facts.

Example:

```json
{
  "candidateType": "WASTE_SPIKE",
  "product": "Avocat affiné",
  "facts": [
    {
      "metric": "known_purchase_cost_waste",
      "current": 46.0,
      "reference": 27.0,
      "variationPct": 70.4
    },
    {
      "metric": "waste_cost_coverage",
      "value": 0.96
    }
  ],
  "dataQuality": 0.91
}
```

The AI then creates the explanation in French.

---

# 135. AI output restriction

AI must not replace:

```text
46.0
27.0
70.4%
```

with recalculated free-form values.

It must use engine outputs.

---

# 136. Explainability

A user should be able to tap:

```text
Pourquoi ?
```

and see:

- current value;
- reference value;
- formula;
- comparison period;
- data coverage;
- source documents.

---

# 137. Formula detail screen

For expert mode:

```text
Indicateur
Casse au coût d’achat / Ventes

Numérateur
Coût d’achat connu de la casse

Dénominateur
Valeur des ventes

Période
09/09 → 15/09

Couverture coût
92%
```

---

# 138. KPI availability rules

A KPI must define when it is unavailable.

Examples:

```text
Average realized price:
unavailable if quantity <= 0

Waste ratio:
unavailable if sales value <= 0

N-1 comparison:
unavailable if N-1 period missing

Break-even volume:
unavailable if purchase cost unknown
```

---

# 139. Zero vs missing

These states are different.

```text
0 = known zero
null = unknown / unavailable
```

Never collapse them.

---

# 140. Negative values

If Mercalys exports valid negative values:

do not discard them automatically.

The business dictionary must define whether they represent:

- returns;
- corrections;
- other adjustments.

Until validated:

preserve and flag.

---

# 141. Outlier raw data

Analytics may flag extreme values.

It must not silently clamp or overwrite imported values.

---

# 142. Duplicate observation prevention

Normalized observation layer must already be idempotent.

Analytics assumes no duplicate business rows after reconciliation.

---

# 143. Multi-source waste deduplication

Waste analytics must consume reconciled validated waste observations.

It must not perform naive deduplication based only on:

```text
same product + same date
```

because the same product may legitimately appear in multiple waste records.

---

# 144. ProductDailyPerformance read model

Recommended calculated read model:

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
  storeProductEventIds: string[];

  weatherRecordId?: string | null;

  computedAt: string;
};
```

---

# 145. ProductDailyPerformance invariant

This read model is NOT the source of truth.

It must be reconstructible.

---

# 146. DepartmentDailyPerformance

Recommended aggregate read model:

```ts
type DepartmentDailyPerformance = {
  storeId: string;
  date: string;

  salesValue?: number | null;
  purchaseValue?: number | null;
  marginValue?: number | null;

  wastePurchaseValueKnown?: number | null;
  wastePurchaseValueEstimated?: number | null;
  wasteSalesValue?: number | null;

  dataQuality: DataQualityResult;

  computedAt: string;
};
```

---

# 147. Product category read model

Optional cached aggregate:

```text
Date × Category
```

for:

```text
FRUIT
VEGETABLE
OTHER
UNKNOWN
```

---

# 148. Commercial operation read model

Recommended:

```ts
type CommercialOperationAnalytics = {
  operationId: string;

  beforePeriod: PeriodAnalytics;
  duringPeriod: PeriodAnalytics;
  afterPeriod: PeriodAnalytics;

  executionCompletion?: number | null;

  warnings: string[];

  qualityScore: number;
};
```

---

# 149. PeriodAnalytics

```ts
type PeriodAnalytics = {
  startDate: string;
  endDate: string;

  kpis: KpiResult[];

  completeness: number;

  concurrentOperationIds: string[];
  contextEventIds: string[];

  qualityScore: number;
};
```

---

# 150. Historical performance storage

The implementation may persist calculated snapshots for speed.

But the system must maintain:

```text
formula version
dictionary version
source version
```

so results can be recomputed.

---

# 151. Recalculation triggers

Recompute impacted analytics when:

- sales import validated;
- waste import validated;
- waste ticket validated;
- source reconciliation changes;
- product mapping changes;
- category changes;
- nature changes;
- Need Unit membership changes;
- commercial operation validation changes;
- execution dates change;
- store event changes;
- formula changes;
- business dictionary changes.

---

# 152. Scope-based recomputation

Prefer recomputing only affected:

```text
dates
products
operations
relations
```

rather than full history.

Technical optimization must not change analytical results.

---

# 153. Performance expectations

MVP user experience target:

- daily dashboard: near-instant from cached read models;
- product analysis: a few seconds maximum;
- import recomputation: may run asynchronously with visible state.

Exact infrastructure SLA belongs to technical specification.

---

# 154. Import-in-progress state

The dashboard must know when relevant analytics are stale.

Example:

```text
Nouvelles données importées — recalcul en cours
```

Do not show old data as if fully current without warning.

---

# 155. Analytical freshness

Each summary must expose:

```text
computedAt
latestBusinessDate
```

---

# 156. Store opening calendar

Comparisons and completeness should use configured store opening days.

French public holidays do not automatically mean store closed.

---

# 157. School holiday context

School holiday is context only.

It is not automatically assigned positive or negative sales impact.

---

# 158. Local events

Manual events may be linked to:

```text
store
category
family
product
```

Analytics may overlay them.

---

# 159. Local-event quality

User-entered events may have uncertain timing.

Store:

```text
exact
approximate
all-day
```

if UX supports it later.

---

# 160. Market-signal expiration

A PDF market signal must have a validity period.

Do not apply it indefinitely to future analytics.

---

# 161. Data sufficiency labels

Recommended French UI:

```text
Données suffisantes
Données partielles
Données insuffisantes
```

---

# 162. Confidence language

Avoid fake precision.

Prefer:

```text
Confiance élevée
Confiance moyenne
Confiance faible
```

for user-facing AI/analytical confidence.

Numeric detail may remain accessible.

---

# 163. Recommended daily candidate logic

A product may become a candidate when one or more are true:

```text
large negative sales contribution
large waste contribution
waste acceleration
margin deterioration
active tension
promotion execution issue
strong substitution opportunity
```

---

# 164. Candidate de-duplication

If the same product triggers:

```text
SALES_DROP
+
WASTE_SPIKE
```

the final AI layer may combine them into one priority.

The analytics engine should retain both underlying signals.

---

# 165. Candidate suppression

Suppress or downgrade when:

```text
data quality too low
reference missing
product inactive
observation period incomplete
```

---

# 166. Recommendation measurement plan

The analytics engine should generate measurement templates.

Example:

```text
Action:
Move Turino next to round tomato

Measure:
Turino sales value
Turino quantity
Turino waste
Round tomato availability event
Comparison:
same weekday baseline
```

The AI may phrase this naturally.

---

# 167. Action review analytics

After execution:

compare:

```text
observed period
vs
selected baseline
```

and expose:

- KPI changes;
- concurrent events;
- data quality;
- whether objective metric improved.

---

# 168. No automatic causal verdict

Action review may state:

```text
Observed result improved during the action period.
```

Not:

```text
The action caused the improvement.
```

unless a future causal method is explicitly implemented.

---

# 169. KPI IDs — initial registry

Recommended initial IDs:

```text
sales_value
sold_quantity
sales_purchase_value
source_margin_value
source_margin_rate
average_realized_price

waste_quantity
waste_purchase_value_known
waste_purchase_value_estimated
waste_sales_value
waste_days_count
waste_frequency
waste_purchase_cost_to_sales_value
waste_sales_value_to_sales_value
waste_output_share
waste_cost_coverage

sales_change_absolute
sales_change_pct
sales_change_contribution

margin_change_absolute
margin_change_pct

waste_change_absolute
waste_change_pct
waste_change_contribution

execution_completion_rate

product_match_coverage
period_completeness
reference_quality
```

---

# 170. Experimental KPI IDs

May exist but remain disabled until validated:

```text
normalized_need_unit_volume
promotion_incremental_margin
causal_weather_impact
causal_cannibalization
price_elasticity
```

---

# 171. KPI naming in French UI

Recommended initial mapping:

```text
sales_value
→ Ventes

sold_quantity
→ Quantité vendue

source_margin_value
→ Marge

source_margin_rate
→ Taux de marge

average_realized_price
→ Prix moyen réalisé

waste_purchase_value_known
→ Casse au coût d'achat connu

waste_purchase_value_estimated
→ Casse au coût d'achat estimé

waste_sales_value
→ Valeur de vente de la casse

waste_cost_coverage
→ Couverture du coût de casse
```

Final business wording must remain configurable.

---

# 172. Acceptance criteria

## KPI-AC-01 — Missing is not zero

**Given:** no N-1 data.  
**Expected:** N-1 comparison is unavailable, not 0%.

---

## KPI-AC-02 — Mixed quantities

**Given:** kg products and piece products.  
**Expected:** no global quantity sum combining kg and pieces.

---

## KPI-AC-03 — Aggregate margin rate

**Given:** multiple product lines with different margin rates.  
**Expected:** no simple arithmetic average is used.

---

## KPI-AC-04 — Known vs estimated waste cost

**Given:** €100 known cost and €20 estimated cost.  
**Expected:** both remain separately identifiable.

---

## KPI-AC-05 — Waste selling value

**Given:** €150 selling-price waste.  
**Expected:** it is not labelled as realized sales loss or deducted from net sales.

---

## KPI-AC-06 — Waste ticket independence

**Given:** €1,000 net sales and €100 ticket waste.  
**Expected:** net sales remain €1,000.

---

## KPI-AC-07 — Bulk/non-bulk by product

**Given:** packaged product from photographed receipt.  
**Expected:** it appears in non-bulk waste.

---

## KPI-AC-08 — J-7

**Given:** current Wednesday and previous Wednesday available.  
**Expected:** valid J-7 comparison.

---

## KPI-AC-09 — Missing J-7

**Given:** previous Wednesday absent.  
**Expected:** comparison unavailable.

---

## KPI-AC-10 — Reference sample size

**Given:** only 2 comparable Wednesdays.  
**Expected:** UI says 2 comparable Wednesdays, not 4.

---

## KPI-AC-11 — Contribution ranking

**Given:** Product A -€200 and Product B -60% but only -€10.  
**Expected:** economic contribution ranking places A above B.

---

## KPI-AC-12 — Unknown category

**Given:** unclassified product.  
**Expected:** it remains under UNKNOWN, not silently excluded.

---

## KPI-AC-13 — Need Unit double counting

**Given:** one product belongs to 3 Need Units.  
**Expected:** official department totals are not tripled.

---

## KPI-AC-14 — Promotion actual execution

**Given:** operation announced but not executed.  
**Expected:** no executed-promotion analysis is created.

---

## KPI-AC-15 — Promotion baseline confounder

**Given:** before period contains another promo.  
**Expected:** comparison warning and reduced quality.

---

## KPI-AC-16 — Average realized price

**Given:** €100 sales and 20 kg.  
**Expected:** €5/kg.

---

## KPI-AC-17 — Incompatible average price

**Given:** mixed kg and piece records.  
**Expected:** no single average price.

---

## KPI-AC-18 — Card benefit

**Given:** 20% card benefit.  
**Expected:** analytics does not automatically reduce till price by 20%.

---

## KPI-AC-19 — Threshold offer

**Given:** €3.49/kg and €2.99/kg from 1 kg.  
**Expected:** mechanism remains conditional; no assumed 100% adoption.

---

## KPI-AC-20 — Daily completeness

**Given:** latest sales data is two days old.  
**Expected:** dashboard shows latest complete business date, not “yesterday”.

---

## KPI-AC-21 — Waste cost coverage

**Given:** 80% of eligible waste value has known cost.  
**Expected:** coverage shown as 80%, unknown 20% remains visible.

---

## KPI-AC-22 — Stockout substitution signal

**Given:** A is OUT_OF_STOCK and B increases vs clean baseline.  
**Expected:** SUPPORTS substitution signal may be generated, not causal attribution.

---

## KPI-AC-23 — Promotion confounder on substitute

**Given:** B is promoted during A stockout.  
**Expected:** substitution event quality is reduced/qualified.

---

## KPI-AC-24 — No transferred-volume claim

**Given:** A loses 10 units and B gains 8.  
**Expected:** engine does not claim 8 transferred units from A to B.

---

## KPI-AC-25 — Break-even threshold

**Given:** valid cost, price and volume.  
**Expected:** required volume is computed deterministically and labelled as threshold, not forecast.

---

## KPI-AC-26 — Break-even missing cost

**Given:** purchase cost unknown.  
**Expected:** break-even volume unavailable.

---

## KPI-AC-27 — Candidate quality

**Given:** extreme metric but incomplete source data.  
**Expected:** candidate is downgraded or flagged.

---

## KPI-AC-28 — Formula traceability

**Given:** user opens KPI detail.  
**Expected:** formula, period, sources and quality are available.

---

## KPI-AC-29 — Recalculation after product remap

**Given:** an unknown product is matched correctly.  
**Expected:** impacted analytics are recomputed.

---

## KPI-AC-30 — Recalculation after execution date change

**Given:** actual promo dates are corrected.  
**Expected:** before/during/after windows are recomputed.

---

# 173. Out of scope

The following are not part of KPI & Analytics Engine MVP v0.1:

- customer-level analytics;
- ticket/basket-level association rules;
- causal promotion uplift;
- causal cannibalization;
- automatic price elasticity;
- full stock-loss accounting;
- theoretical stock;
- reorder-point optimization;
- autonomous ordering;
- deep demand forecasting;
- black-box anomaly detection;
- hour-level sales analytics without an hourly source;
- customer segmentation;
- competitor-price analytics;
- multi-store benchmarking.

---

# 174. Implementation guidance for the development agent

The development agent should create the analytics layer as a dedicated business subsystem.

Recommended separation:

```text
Observation repositories
        ↓
Normalization services
        ↓
KPI registry
        ↓
Formula engine
        ↓
Comparison engine
        ↓
Quality engine
        ↓
Read models
        ↓
Analytical candidate engine
        ↓
AI layer
```

Do not implement core KPI formulas directly inside React components.

---

# 175. Testing strategy

Every KPI definition must have:

- unit tests;
- zero/reference tests;
- missing-data tests;
- unit-compatibility tests;
- aggregation tests;
- reconciliation tests where relevant.

Every comparison method must have deterministic fixtures.

Every analytical candidate rule must have fixtures for:

- trigger;
- non-trigger;
- low-quality suppression;
- conflicting context.

---

# 176. Golden dataset

Create a small versioned test dataset containing:

- bulk fruit;
- packaged fruit;
- bulk vegetable;
- packaged vegetable;
- sales;
- known waste cost;
- estimated waste cost;
- promotion;
- stockout;
- substitute;
- missing reference;
- incomplete period.

All core KPI tests should run against this dataset.

---

# 177. Formula ownership

Each KPI formula must live in one canonical implementation.

Avoid duplicated logic across:

- API;
- mobile;
- dashboard;
- AI prompt;
- background job.

---

# 178. Final functional invariant

The KPI & Analytics Engine must preserve these distinctions:

```text
Source value
vs
Derived value

Known
vs
Estimated
vs
Missing

Current period
vs
Reference period

Absolute change
vs
Percentage change
vs
Economic contribution

Correlation
vs
Causality

Behavioural substitution
vs
Commercial attractiveness

Product family
vs
Need Unit

Bulk/non-bulk nature
vs
Waste source channel

Observed promotion
vs
Executed promotion

Forecast weather
vs
Observed weather
```

If any implementation collapses these distinctions, it violates the functional design.

---

# 179. Definition of completion

The KPI & Analytics Engine MVP is functionally complete when it can reliably support:

```text
Daily department summary
Weekly department summary
Product analysis
Fruit vs Vegetable analysis
Bulk vs Non-bulk waste analysis
Promotion before/during/after analysis
Contribution-to-change ranking
Waste recurrence and acceleration
Data-quality reporting
Product tension analytics
Substitution-event analytics
Counter-promotion break-even scenarios
Structured analytical candidates for AI
```

and when all official KPI outputs are deterministic, traceable, recomputable and explicit about missing or uncertain data.
