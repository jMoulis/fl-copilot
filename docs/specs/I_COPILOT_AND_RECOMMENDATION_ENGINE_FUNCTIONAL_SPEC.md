# AI Copilot & Recommendation Engine Functional Specification

**Product:** Fruits & Vegetables Copilot  
**Document:** `I_COPILOT_AND_RECOMMENDATION_ENGINE_FUNCTIONAL_SPEC.md`  
**Version:** 0.1  
**Date:** 16 September 2026  
**Specification language:** English  
**Application language:** French (`fr-FR`)  
**Primary user:** Fruits & Vegetables Department Manager — Intermarché  
**Scope:** AI synthesis, recommendation orchestration, priority selection, explainability, confidence, human decisions, execution follow-up, and post-action review.

---

# 1. Purpose

This document defines the **AI Copilot & Recommendation Engine** for the Fruits & Vegetables Copilot.

The AI Copilot is the layer that transforms trusted business facts into understandable and actionable guidance.

It must help the department manager answer:

1. What deserves my attention today?
2. What should I prepare for the coming week?
3. Why did a product or category move?
4. What should I do about waste?
5. How should I react to a tension, low stock or stockout?
6. Which substitute products should I consider?
7. Is a local promotion / counter-promotion commercially coherent?
8. Is a national promotion overlapping with another product serving the same Need Unit?
9. Was an operation correctly executed?
10. Did the result improve after the action?
11. What is known, what is uncertain, and what should be verified before acting?

The Copilot is not the source of business truth.

It consumes structured outputs from deterministic engines and produces:

- explanations;
- prioritization;
- recommendations;
- summaries;
- follow-up plans;
- user-facing French language.

---

# 2. Dependency map

The Copilot depends on four previously specified subsystems.

```text
Product & Substitution Engine
        │
        ├── Product Master
        ├── Need Units
        ├── Substitution relationships
        ├── Relationship score
        ├── Relationship confidence
        └── Substitution evidence
        │
        ▼
KPI & Analytics Engine
        │
        ├── KPIs
        ├── Comparisons
        ├── Contribution rankings
        ├── Waste analytics
        ├── Promotion analytics
        ├── Data quality
        └── Analytical candidates
        │
        ▼
Commercial Planning & Promotion Engine
        │
        ├── Weekly operations
        ├── Offers
        ├── Deadlines
        ├── TG / merchandising
        ├── Market signals
        ├── Local action scenarios
        └── Weekly commercial candidates
        │
        ▼
AI Copilot & Recommendation Engine
        │
        ├── Synthesis
        ├── Prioritization
        ├── Explanation
        ├── Recommendation
        ├── Decision support
        └── Follow-up
```

---

# 3. Core functional invariant

> **The AI may explain, compare, synthesize and recommend. It must never invent business facts, recalculate authoritative KPIs, silently resolve critical ambiguity, or present correlation as proven causality.**

The Copilot must always distinguish:

```text
Fact
Interpretation
Recommendation
```

and when relevant:

```text
Observation
Hypothesis
Uncertainty
Action
Measurement
```

---

# 4. AI responsibilities in the overall product

The application contains several AI-enabled capabilities.

## 4.1 Document extraction AI

Used for:

- photographed waste receipts;
- weekly commercial PDFs.

This AI extracts structured inputs.

It is not the Copilot itself.

---

## 4.2 Product matching / semantic assistant

Used for:

- product aliases;
- PDF product matching;
- ticket product matching;
- Need Unit suggestions;
- substitution-link suggestions.

Final critical mappings remain validated or deterministically controlled.

---

## 4.3 Business synthesis AI

Used for:

- daily synthesis;
- weekly synthesis;
- product synthesis;
- commercial-operation synthesis;
- action review.

---

## 4.4 Recommendation AI

Used for:

- explaining analytical candidates;
- grouping related issues;
- turning structured candidates into action proposals;
- explaining trade-offs;
- proposing measurement plans.

---

## 4.5 Substitution reasoning AI

Used for:

- explaining substitute choices;
- comparing behavioural fit and commercial attractiveness;
- proposing merchandising responses;
- identifying counter-promotion overlap.

The final substitution score and evidence metrics remain deterministic.

---

# 5. What the Copilot must NOT do

The Copilot must not:

- invent sales values;
- invent purchase costs;
- invent stock levels;
- invent margin;
- invent price elasticity;
- invent expected uplift;
- invent waste avoided;
- invent N-1;
- invent missing dates;
- invent product codes;
- invent weather;
- invent store execution;
- claim an operation was implemented merely because it appeared in the PDF;
- treat an external market tension as a store stockout;
- recalculate official KPIs in free-form text;
- infer customer-level behaviour from article/day data;
- state that A caused B when only co-movement was observed;
- automatically approve a local promotion;
- place orders;
- modify Mercalys;
- modify Storeline;
- activate Drive;
- autonomously change prices.

---

# 6. Language requirements

All user-facing Copilot output must be in French.

Internal prompts, schemas, enums and implementation code may use English.

The Copilot must use concise, operational French appropriate for a department manager working on the shop floor.

Preferred style:

- direct;
- factual;
- concise;
- operational;
- measurable;
- no unnecessary management jargon.

Avoid excessive prose.

---

# 7. French output terminology

Recommended labels:

```text
Facts
→ Faits

Interpretation
→ Lecture

Recommendation
→ Action proposée

Confidence
→ Confiance

Risks
→ Points de vigilance

Missing data
→ Données manquantes

Measurement
→ À mesurer

Source
→ Source

Why?
→ Pourquoi ?

Priority
→ Priorité

AI recommendation
→ Recommandation IA

Store observation
→ Observation magasin

Enseigne instruction
→ Instruction enseigne
```

---

# 8. User-facing source distinction

The Copilot must visually and semantically distinguish:

```text
Instruction enseigne
Observation magasin
Recommandation IA
```

They must never be merged into one generic “advice” category.

Example:

```text
Instruction enseigne
Installer une TG Crudités.

Observation magasin
Rupture tomate ronde depuis 14h.

Recommandation IA
Renforcer la visibilité de la Turino comme substitut.
```

---

# 9. Primary Copilot surfaces

The Copilot appears in four primary functional contexts.

```text
Aujourd’hui
Ma semaine
Fiche produit
Bilan d’opération
```

It may also appear in:

```text
Analyses
Casse
Substitution relationship detail
```

---

# 10. No general autonomous chat requirement in MVP

The MVP does not require a fully open-ended autonomous chat agent.

The preferred model is:

```text
contextual guided analysis
+
structured questions
+
bounded free-text follow-up
```

Examples:

```text
Pourquoi les ventes baissent ?
Pourquoi la casse augmente ?
Quels substituts pour ce produit ?
Que dois-je préparer pour la semaine prochaine ?
Cette promotion semble-t-elle fonctionner ?
```

A fully general agent capable of arbitrary external actions is out of scope.

---

# 11. Copilot input rule

The Copilot must receive structured data, not raw business databases whenever an engine output already exists.

Preferred flow:

```text
Raw source
→ deterministic engine
→ structured analytical contract
→ Copilot
```

The AI must not query raw source rows and reconstruct official KPI logic independently.

---

# 12. Core recommendation input contract

Recommended normalized contract:

```ts
type RecommendationContext = {
  contextId: string;

  surface:
    | "TODAY"
    | "WEEK"
    | "PRODUCT"
    | "COMMERCIAL_OPERATION"
    | "WASTE"
    | "SUBSTITUTION"
    | "ACTION_REVIEW";

  businessDate?: string | null;

  period?: {
    startDate: string;
    endDate: string;
  } | null;

  store: StoreContext;

  facts: FactReference[];

  analyticalCandidates: AnalyticalCandidate[];

  weeklyCandidates: WeeklyCommercialCandidate[];

  productContexts: ProductRecommendationContext[];

  commercialContexts: CommercialRecommendationContext[];

  dataQuality: RecommendationDataQuality;

  userDecisions?: DecisionContext[];

  generatedAt: string;
};
```

---

# 13. Fact reference contract

```ts
type FactReference = {
  id: string;

  type:
    | "KPI"
    | "COMPARISON"
    | "EVENT"
    | "MARKET_SIGNAL"
    | "COMMERCIAL_OPERATION"
    | "EXECUTION"
    | "WEATHER"
    | "HOLIDAY"
    | "SUBSTITUTION"
    | "DATA_QUALITY";

  label: string;

  value?: number | string | boolean | null;

  unit?: string | null;

  sourceId: string;

  sourceType: string;

  qualityScore: number;

  observedAt?: string | null;
};
```

---

# 14. Analytical candidate input

The Copilot consumes deterministic candidates from the KPI engine.

Examples include:

```text
SALES_DROP
SALES_GROWTH
WASTE_SPIKE
MARGIN_DROP
PROMOTION_UNDERPERFORMANCE
PROMOTION_OVERPERFORMANCE
SUBSTITUTION_OPPORTUNITY
SUBSTITUTION_CONFLICT
DATA_QUALITY_ALERT
EXECUTION_GAP
```

The Copilot must not recreate these trigger rules from scratch.

---

# 15. Weekly candidate input

The Copilot also consumes weekly commercial candidates such as:

```text
DEADLINE
EXECUTION_RISK
MARKET_TENSION
SUBSTITUTION_OPPORTUNITY
PROMOTION_OVERLAP
WASTE_OPPORTUNITY
MERCHANDISING_OPPORTUNITY
DATA_QUALITY_ALERT
```

---

# 16. Candidate normalization

Daily analytical candidates and weekly commercial candidates must be normalized into one Copilot candidate structure.

```ts
type CopilotCandidate = {
  id: string;

  sourceCandidateIds: string[];

  type: RecommendationType;

  scope:
    | "DAILY"
    | "WEEKLY"
    | "PRODUCT"
    | "OPERATION"
    | "ACTION_REVIEW";

  entityIds: string[];

  urgencyScore: number;
  economicImpactScore: number;
  deviationScore?: number | null;
  dataQualityScore: number;

  relationshipScore?: number | null;
  relationshipConfidence?: number | null;

  deadlineAt?: string | null;

  evidenceIds: string[];

  status:
    | "ELIGIBLE"
    | "SUPPRESSED"
    | "MERGED"
    | "TO_REVIEW";
};
```

---

# 17. Recommendation types

Initial registry:

```ts
type RecommendationType =
  | "CHECK_STOCK"
  | "CHECK_QUALITY"
  | "CHECK_PRICE"
  | "CHECK_PLU"
  | "CHECK_STORELINE"
  | "ACTIVATE_DRIVE"
  | "PLACE_PREORDER_REMINDER"
  | "INSTALL_TG"
  | "ADJUST_MERCHANDISING"
  | "REINFORCE_SUBSTITUTE"
  | "MONITOR_SUBSTITUTE"
  | "AVOID_PROMOTION_OVERLAP"
  | "CONSIDER_LOCAL_PROMOTION"
  | "CONSIDER_LOT_SALE"
  | "REDUCE_WASTE_EXPOSURE"
  | "MONITOR_HIGH_WASTE"
  | "INVESTIGATE_SALES_DROP"
  | "INVESTIGATE_MARGIN_DROP"
  | "VALIDATE_DATA"
  | "WAIT_FOR_MORE_DATA"
  | "OTHER";
```

---

# 18. Recommendation does not always mean action

A valid recommendation may be:

```text
Wait
Verify
Monitor
Confirm
Investigate
Prepare
Do not act yet
```

Example:

```text
Données insuffisantes : confirmer le stock avant de modifier le prix.
```

The Copilot must not force an action when evidence is weak.

---

# 19. Maximum three main priorities

The user must see at most:

```text
3 primary priorities
```

on:

```text
Aujourd’hui
Ma semaine
```

The full candidate list remains accessible in detail.

This constraint is mandatory.

---

# 20. Priority selection principle

Priority selection should be grounded in deterministic candidate scores.

The Copilot may:

- merge semantically related candidates;
- explain trade-offs;
- choose among near-equivalent candidates;
- phrase the final priorities.

The Copilot must not ignore a materially higher-impact candidate without a recorded reason.

---

# 21. Priority scoring inputs

At minimum:

```text
Urgency
Economic impact
Deviation
Data quality
Deadline
Execution risk
Substitution relevance
```

Not every candidate uses every dimension.

---

# 22. Suggested deterministic priority score

The implementation may expose a normalized score:

```text
priorityBaseScore =
  W_urgency × urgencyScore
+ W_impact  × economicImpactScore
+ W_deviation × deviationScore
+ W_quality × dataQualityScore
```

Deadline and business-specific modifiers may apply.

Exact weights belong to technical/business configuration.

The LLM does not own the canonical numeric score.

---

# 23. Semantic candidate merging

The Copilot may merge related candidates into one priority.

Example:

```text
WASTE_SPIKE on Avocado
+
SALES_DROP on Avocado
+
QUALITY_ISSUE on Avocado
```

may become:

```text
Priorité : vérifier la qualité et l’exposition des avocats.
```

The merged recommendation must preserve all underlying evidence.

---

# 24. Candidate merging restriction

Do not merge candidates merely because they affect the same product if the recommended actions conflict.

Example:

```text
Increase display
vs
Reduce exposure due to waste
```

must become an explicit trade-off, not one silently merged instruction.

---

# 25. Recommendation object

```ts
type Recommendation = {
  id: string;

  contextId: string;

  type: RecommendationType;

  titleFr: string;

  summaryFr: string;

  entityIds: string[];

  sourceCandidateIds: string[];

  facts: RecommendationFact[];

  interpretationFr: string;

  proposedActionFr: string;

  objectiveFr: string;

  risksFr: string[];

  missingDataFr: string[];

  measurementPlan: MeasurementPlan;

  confidence: RecommendationConfidence;

  priorityRank?: 1 | 2 | 3 | null;

  status:
    | "PROPOSED"
    | "ACCEPTED"
    | "MODIFIED"
    | "POSTPONED"
    | "REJECTED"
    | "EXECUTED"
    | "CANCELLED"
    | "REVIEWED";

  createdAt: string;
  updatedAt: string;
};
```

---

# 26. Recommendation fact

```ts
type RecommendationFact = {
  factId: string;

  labelFr: string;

  displayValue: string;

  sourceId: string;

  sourceType: string;

  qualityScore: number;
};
```

The displayed value must come from deterministic engine output.

---

# 27. Mandatory recommendation content

Every material recommendation must contain:

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

Short recommendations may collapse empty sections, but their underlying data contract remains.

---

# 28. Facts section

Facts must be:

- numeric or categorical engine outputs;
- source-linked;
- temporally scoped;
- non-speculative.

Example:

```text
Faits
• Casse au coût connu : 46 € hier.
• +70 % vs mercredi comparable.
• Couverture du coût : 96 %.
```

---

# 29. Interpretation section

Interpretation may connect facts.

Example:

```text
Lecture
La hausse de casse est plus rapide que l'évolution des ventes.
```

Interpretation must not introduce unsupported numbers.

---

# 30. Recommendation section

Example:

```text
Action proposée
Contrôler le niveau de maturité et réduire l'exposition si le stock restant est élevé.
```

If stock is unknown:

```text
Vérifier le stock restant avant de réduire l'exposition.
```

---

# 31. Risks section

Example:

```text
Points de vigilance
• stock réel non connu;
• promotion nationale en cours;
• comparaison basée sur seulement 2 mercredis.
```

---

# 32. Missing data section

The Copilot should explicitly say what would improve the decision.

Example:

```text
Données manquantes
• stock actuel;
• date de mise en rayon;
• coût d'achat fiable sur 18 % de la casse.
```

---

# 33. Measurement plan

```ts
type MeasurementPlan = {
  objectiveMetricIds: string[];

  baselineMode: string;

  observationStart?: string | null;
  observationEnd?: string | null;

  reviewAt?: string | null;

  notesFr?: string | null;
};
```

---

# 34. Measurement principle

A recommendation without a way to review the result should be avoided when the action is material.

Example:

```text
Action
Déplacer la Turino à proximité de la tomate ronde.

À mesurer
• ventes Turino;
• quantité Turino;
• casse Turino;
• durée de rupture tomate ronde.

Bilan
Après la fin de la rupture.
```

---

# 35. Confidence model

The Copilot must not expose one vague universal “confidence”.

Internally distinguish at least:

```text
Data confidence
Interpretation confidence
Recommendation confidence
```

---

# 36. Data confidence

Derived from deterministic data-quality outputs.

Inputs may include:

- period completeness;
- reference quality;
- product match coverage;
- waste cost coverage;
- unit compatibility;
- execution-data completeness.

The LLM must not alter it.

---

# 37. Interpretation confidence

Represents how strongly the available facts support the proposed interpretation.

Example:

```text
High:
repeated pattern + clean baseline

Medium:
consistent signal but some confounders

Low:
few observations or several competing explanations
```

---

# 38. Recommendation confidence

Represents confidence that the proposed action is reasonable under current information.

It may be lower than interpretation confidence.

Example:

```text
Interpretation:
High confidence that waste increased.

Recommendation:
Low confidence on price reduction because stock is unknown.
```

---

# 39. RecommendationConfidence contract

```ts
type RecommendationConfidence = {
  level:
    | "HIGH"
    | "MEDIUM"
    | "LOW"
    | "INSUFFICIENT_DATA";

  dataQualityScore: number;

  interpretationScore?: number | null;

  actionabilityScore?: number | null;

  rationaleFr: string;
};
```

---

# 40. French confidence wording

```text
HIGH
→ Élevée

MEDIUM
→ Moyenne

LOW
→ Faible

INSUFFICIENT_DATA
→ Données insuffisantes
```

---

# 41. No fake precision

Default UI should not show:

```text
Confidence = 83.7%
```

Prefer:

```text
Confiance : Moyenne
```

Numeric internal values may remain available in expert/debug mode.

---

# 42. Daily Copilot workflow

The daily Copilot runs on the latest sufficiently complete business day.

Flow:

```text
Latest complete business date
        ↓
Daily KPI summary
        ↓
Comparison engine
        ↓
Waste signals
        ↓
Active promotions
        ↓
Current store events
        ↓
Market signals
        ↓
Substitution signals
        ↓
Candidate ranking
        ↓
Semantic merge
        ↓
Max 3 priorities
        ↓
French daily synthesis
```

---

# 43. Daily summary output

Recommended structure:

```text
Résumé
Mouvements clés
Points de vigilance
3 priorités
```

---

# 44. Example daily synthesis

Illustrative French UI:

```text
Résumé du 15 septembre

Ventes
4 830 €
+6,2 % vs J-7

Marge
1 386 €
+3,1 %

Casse au coût connu
172 €
+21 %

Mouvements clés
• Banane : +186 € de contribution aux ventes.
• Avocat : -94 €.
• Tomate : +31 € de casse.

Priorités
1. Vérifier la maturité des avocats.
2. Contrôler la disponibilité de la tomate ronde.
3. Préparer la Turino comme substitut si la tension se confirme.
```

Numbers must be supplied by engines, never invented by the LLM.

---

# 45. Latest complete day rule

The Copilot must not say:

```text
Hier
```

unless yesterday is actually complete according to the analytics engine.

Preferred:

```text
Résumé du 15 septembre
```

or:

```text
Dernière journée complète : 15 septembre
```

---

# 46. Weekly Copilot workflow

Flow:

```text
Validated weekly commercial plan
        ↓
Deadlines
        ↓
Commercial operations
        ↓
TG / merchandising
        ↓
Market signals
        ↓
Weather horizon
        ↓
Holidays
        ↓
Product tensions
        ↓
Substitute network
        ↓
Promotion overlap
        ↓
Local-action scenarios
        ↓
Max 3 weekly priorities
```

---

# 47. Weekly summary structure

Recommended:

```text
À ne pas manquer
Opérations majeures
Tensions & substituts
Météo / calendrier
3 priorités
```

---

# 48. Weekly priorities may include non-sales actions

Examples:

```text
Close pre-order before deadline
Validate PLU
Prepare TG
Confirm Storeline configuration
Prepare substitute display
Avoid overlapping local promotion
```

---

# 49. Deadline dominance

A near-term mandatory deadline may outrank a larger economic opportunity.

Example:

```text
Pre-order closes today
```

may be priority #1.

This must be handled by deterministic urgency/deadline logic, not arbitrary AI preference.

---

# 50. Product Copilot workflow

From a Product Sheet the Copilot should be able to answer:

```text
Comment se comporte ce produit ?
Pourquoi ça bouge ?
La casse est-elle anormale ?
Est-il en promotion ?
Y a-t-il une tension ?
Quels sont ses substituts ?
Que faire ?
```

---

# 51. Product analysis structure

Recommended:

```text
Performance
Comparaison
Casse
Contexte
Promotions
Substituts
Lecture IA
Action possible
```

---

# 52. Product interpretation rule

The Copilot should prioritize absolute contribution before sensational percentage change.

Example:

Do not lead with:

```text
-60%
```

if economic change is:

```text
-8 €
```

and another product explains:

```text
-210 €
```

---

# 53. Product waste analysis

The Copilot may highlight:

- waste amount;
- waste recurrence;
- waste acceleration;
- waste coverage;
- sales trend;
- promotion status.

It must distinguish:

```text
known purchase-cost waste
estimated purchase-cost waste
selling-price waste value
```

---

# 54. Waste recommendation types

Possible recommendations:

```text
Check quality
Check maturity
Check stock
Reduce exposure
Increase rotation
Consider lot sale
Consider local price action
Monitor only
Wait for more data
```

The choice depends on facts.

---

# 55. No automatic discount bias

The Copilot must not default to:

```text
Lower the price
```

whenever waste increases.

Price reduction is one possible action among several.

---

# 56. Commercial-operation Copilot workflow

From an operation detail page answer:

```text
Was it executed?
What changed during it?
Was volume higher?
Was margin higher/lower?
Did waste move?
Were there confounders?
Was execution complete?
What should be retained for next time?
```

---

# 57. Operation review language

Allowed:

```text
Le volume a augmenté pendant l'opération.
```

Not allowed without causal methodology:

```text
La promotion a généré +25 % de volume.
```

Preferred wording:

```text
Une hausse de 25 % a été observée pendant l'opération par rapport à la référence sélectionnée.
```

---

# 58. Execution-aware interpretation

If execution was incomplete:

```text
TG not installed
```

the Copilot must mention that before interpreting operation performance.

Example:

```text
Le résultat est difficile à interpréter : la TG prévue n'a pas été installée.
```

---

# 59. Substitution recommendation workflow

When product A is under tension:

```text
1. Read active source-product event.
2. Read relevant Need Units.
3. Read candidate substitution edges.
4. Read relationship score.
5. Read relationship confidence.
6. Read candidate availability if known.
7. Read candidate sales.
8. Read candidate waste.
9. Read price compatibility.
10. Read margin context.
11. Read active promotions.
12. Read market signals.
13. Read previous substitution evidence.
14. Produce behavioural ranking.
15. Produce commercial recommendation.
```

---

# 60. Behavioural substitute vs commercial option

The Copilot must preserve this distinction.

Example:

```text
Best behavioural substitute:
Turino

Best commercial option:
Ribbed tomato
```

If they differ, the Copilot must explain why.

It must not call the most profitable product the “best substitute” unless behavioural fit supports it.

---

# 61. Example substitution recommendation

French UI:

```text
Tension sur la tomate ronde

Substitut le plus proche
Tomate Turino

Pourquoi ?
• même unité de besoin;
• usage très proche;
• prix proche;
• relation observée lors de 4 tensions précédentes.

Confiance substitution
Moyenne

Contexte commercial
• marge actuelle supérieure;
• pas de promotion concurrente détectée;
• casse faible sur 7 jours.

Action proposée
Renforcer la visibilité de la Turino et surveiller sa disponibilité.
```

---

# 62. Substitution causality rule

The Copilot may say:

```text
La hausse de Turino pendant la rupture est compatible avec un report de demande.
```

It must not say:

```text
La rupture de tomate ronde a causé +35 % de ventes Turino.
```

---

# 63. Counter-promotion workflow

When evaluating a local promotion candidate:

```text
Product
        ↓
Current price
        ↓
Cost availability
        ↓
Margin context
        ↓
Waste
        ↓
Current sales
        ↓
National promotions
        ↓
Need Unit overlap
        ↓
Substitute relationships
        ↓
Market tension
        ↓
Weather/calendar
        ↓
Deterministic price scenario
        ↓
Copilot recommendation
```

---

# 64. Counter-promotion numeric rule

Any numeric scenario must come from the deterministic scenario engine.

The Copilot may receive:

```text
At €2.49/kg, required volume to preserve current theoretical contribution = +39%.
```

The Copilot may explain it.

It must not independently derive a different value.

---

# 65. Break-even wording

Preferred:

```text
Seuil mathématique

À 2,49 €/kg, il faudrait environ +39 % de volume pour conserver le même niveau de contribution théorique.
```

Required warning:

```text
Ce seuil n'est pas une prévision de demande.
```

---

# 66. Promotion overlap recommendation

When two strongly substitutable products are promoted simultaneously:

Possible output:

```text
Chevauchement commercial à surveiller.

La Turino et la tomate côtelée répondent à un besoin client proche.
Une seconde baisse de prix peut déplacer la demande entre les deux références plutôt que créer du volume additionnel.
```

Do not quantify cannibalization without a validated model.

---

# 67. Data-quality recommendation

The Copilot may recommend improving data before action.

Example:

```text
Priorité : fiabiliser la casse

18 % de la valeur de casse n'a pas de coût d'achat fiable.
Éviter de conclure sur la rentabilité avant correction.
```

Data-quality alerts can be valid top priorities.

---

# 68. Recommendation suppression rules

A recommendation should be suppressed or downgraded when:

- critical input ambiguity unresolved;
- data quality below configured threshold;
- product inactive;
- operation not applicable;
- candidate relation rejected;
- required cost unknown for price recommendation;
- incomplete execution invalidates interpretation.

---

# 69. Insufficient-data behaviour

When data is insufficient, the Copilot must say so explicitly.

Preferred pattern:

```text
Données insuffisantes pour recommander une baisse de prix.

À vérifier :
• coût d'achat;
• stock restant;
• ventes des deux derniers jours.
```

This is a successful output, not an error.

---

# 70. Conflicting evidence

The Copilot must expose material conflict.

Example:

```text
Signal contradictoire :
• ventes en baisse;
• casse également en baisse;
• rupture signalée pendant 4h.
```

Do not force a single explanation.

---

# 71. Multiple possible explanations

Preferred language:

```text
Plusieurs facteurs peuvent expliquer la baisse :
• rupture partielle;
• hausse de prix;
• météo moins favorable.

Les données disponibles ne permettent pas de les départager avec certitude.
```

---

# 72. Hypothesis language policy

Use:

```text
peut être lié à
est compatible avec
pourrait contribuer à
à surveiller
hypothèse
```

Avoid:

```text
a causé
explique forcément
fera augmenter
va générer
```

unless the system has a validated causal/predictive model.

---

# 73. Recommendation provenance

Every recommendation must retain provenance.

```ts
type RecommendationProvenance = {
  recommendationId: string;

  analyticalCandidateIds: string[];
  weeklyCandidateIds: string[];

  factIds: string[];

  sourceDocumentIds: string[];

  eventIds: string[];

  substitutionRelationIds: string[];

  generatedByModel?: string | null;
  promptVersion?: string | null;

  generatedAt: string;
};
```

---

# 74. Why screen

Every recommendation must support:

```text
Pourquoi ?
```

The explanation screen should show:

```text
Faits utilisés
Comparaison
Contexte
Confiance
Données manquantes
Sources
```

---

# 75. Source document linking

When recommendation uses a PDF fact:

the user must be able to navigate to:

```text
document
page
source block
```

where available.

---

# 76. Recommendation versioning

If underlying facts change:

- old recommendation remains auditable;
- a new recommendation version may be generated;
- the user must not lose the decision made on the previous version.

---

# 77. Stale recommendation

A recommendation becomes stale when:

- new sales data materially changes the situation;
- relevant event closes;
- promotion starts/ends;
- product availability changes;
- critical data correction occurs.

Recommended status:

```text
STALE
```

The UI may show:

```text
Cette recommandation doit être recalculée.
```

---

# 78. Recommendation freshness

Each recommendation should expose:

```text
generatedAt
businessDate
dataFreshness
```

---

# 79. Human decision workflow

The user can:

```text
ACCEPT
MODIFY
POSTPONE
REJECT
```

French UI:

```text
Accepter
Modifier
Reporter
Refuser
```

---

# 80. Decision entity

```ts
type Decision = {
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

  userId: string;
};
```

---

# 81. Acceptance is not execution

Mandatory rule:

```text
Accepted recommendation
≠
Executed action
```

Execution must be recorded separately.

---

# 82. Action entity

```ts
type ActionExecution = {
  id: string;

  recommendationId?: string | null;
  decisionId?: string | null;

  actionType: RecommendationType;

  plannedStart?: string | null;
  plannedEnd?: string | null;

  actualStart?: string | null;
  actualEnd?: string | null;

  actualPrice?: number | null;
  actualLocation?: string | null;

  status:
    | "PLANNED"
    | "IN_PROGRESS"
    | "EXECUTED"
    | "CANCELLED";

  notes?: string | null;
};
```

---

# 83. Modified decisions

If user changes:

```text
AI: reduce price to €2.49
User: choose €2.69
```

the executed action must use the user's chosen value.

The post-action review must compare against:

```text
actual executed action
```

not the original AI suggestion.

---

# 84. Rejection feedback

A rejected recommendation may optionally capture a reason:

```text
No stock
Bad quality
Not enough space
Price not acceptable
Already planned another action
Recommendation not relevant
Other
```

This feedback may improve future recommendation ranking.

It must not silently alter core KPI/business truth.

---

# 85. Postpone workflow

A postponed recommendation should reappear:

- at postpone date;
- if the triggering condition changes materially;
- or if urgency increases.

Avoid duplicate recommendation cards.

---

# 86. Post-action review workflow

```text
Action executed
        ↓
Measurement period completes
        ↓
KPI engine computes review
        ↓
Context/confounders attached
        ↓
Copilot summarizes result
        ↓
User records learning
```

---

# 87. Action review entity

```ts
type ActionReview = {
  id: string;

  actionExecutionId: string;

  reviewPeriodStart: string;
  reviewPeriodEnd: string;

  baselineMode: string;

  kpiResultIds: string[];

  concurrentEventIds: string[];
  concurrentOperationIds: string[];

  dataQualityScore: number;

  result:
    | "POSITIVE_OBSERVED_CHANGE"
    | "NEGATIVE_OBSERVED_CHANGE"
    | "MIXED"
    | "NO_CLEAR_CHANGE"
    | "INSUFFICIENT_DATA";

  aiSummaryFr?: string | null;

  reviewedAt: string;
};
```

---

# 88. Post-action wording

Allowed:

```text
Les ventes ont progressé de 12 % pendant la période d'action.
```

with explicit reference.

Not allowed:

```text
L'action a créé 12 % de ventes supplémentaires.
```

unless causal methodology exists.

---

# 89. Learning from actions

Commercial-action outcomes may inform future recommendations.

They must remain separate from:

```text
SubstitutionEvidence
```

unless the action coincides with a valid product tension event and evidence rules are satisfied.

---

# 90. Daily synthesis object

```ts
type DailyCopilotBrief = {
  businessDate: string;

  headlineFr: string;

  coreKpis: string[];

  keyMovementFactIds: string[];

  contextFactIds: string[];

  priorityRecommendationIds: string[];

  dataQualityMessageFr?: string | null;

  generatedAt: string;
};
```

---

# 91. Weekly synthesis object

```ts
type WeeklyCopilotBrief = {
  weekStart: string;
  weekEnd: string;

  headlineFr: string;

  operationIds: string[];

  deadlineFactIds: string[];

  marketSignalIds: string[];

  substitutionOpportunityIds: string[];

  priorityRecommendationIds: string[];

  weatherMessageFr?: string | null;

  generatedAt: string;
};
```

---

# 92. Product synthesis object

```ts
type ProductCopilotBrief = {
  productId: string;

  periodStart: string;
  periodEnd: string;

  performanceFactIds: string[];
  wasteFactIds: string[];
  commercialFactIds: string[];
  contextFactIds: string[];
  substituteRelationIds: string[];

  interpretationFr: string;

  recommendationIds: string[];

  generatedAt: string;
};
```

---

# 93. Operation synthesis object

```ts
type OperationCopilotBrief = {
  operationId: string;

  executionSummaryFr: string;

  beforeDuringAfterFactIds: string[];

  contextFactIds: string[];

  interpretationFr: string;

  learningFr: string;

  generatedAt: string;
};
```

---

# 94. Structured follow-up questions

The UI may offer contextual quick questions.

Example Today:

```text
Pourquoi la casse augmente ?
Quels produits expliquent la baisse ?
Que dois-je faire en premier ?
```

Example Product:

```text
Quels sont ses substituts ?
Cette casse est-elle inhabituelle ?
Y a-t-il une promo qui influence les ventes ?
```

Example Week:

```text
Quelles échéances sont urgentes ?
Quels produits risquent une tension ?
Quelles contre-promos éviter ?
```

---

# 95. Free-text follow-up

A bounded free-text field may be supported.

The Copilot must restrict itself to:

- current store context;
- available validated data;
- configured business features.

If user asks beyond available data:

say what source is missing.

---

# 96. AI context isolation

Do not expose one product's facts as another product's evidence.

Every Copilot request must carry explicit:

```text
store
entity
period
```

scope.

---

# 97. Tool / data access principle

The Copilot should call application business services, not raw database collections directly where a business service exists.

Conceptual tools:

```text
getDailySummary
getWeeklyPlan
getProductAnalytics
getOperationAnalytics
getRecommendationCandidates
getSubstitutes
getSubstitutionEvidence
getDataQuality
getActionHistory
```

---

# 98. Read-only AI by default

The AI generation step is read-only.

Writes occur only after explicit user actions such as:

```text
Accept recommendation
Modify recommendation
Record event
Mark action executed
Validate relationship
```

---

# 99. No invisible autonomous writes

The AI must never silently:

- create confirmed store events;
- mark operations executed;
- approve promotions;
- change product classification;
- validate substitution relations;
- overwrite user decisions.

---

# 100. Copilot model-output schema

The model should produce structured output.

Recommended:

```ts
type CopilotGeneration = {
  summaryFr: string;

  recommendations: Array<{
    candidateIds: string[];

    titleFr: string;
    interpretationFr: string;
    actionFr: string;
    objectiveFr: string;

    riskItemsFr: string[];
    missingDataFr: string[];

    confidenceLevel:
      | "HIGH"
      | "MEDIUM"
      | "LOW"
      | "INSUFFICIENT_DATA";

    measurementFr: string;
  }>;

  warningsFr: string[];
};
```

The application validates references before persistence.

---

# 101. Output grounding validation

Before showing AI output:

- every referenced metric must exist;
- every product must exist;
- every source must exist;
- every numeric claim must map to a provided deterministic value;
- every recommendation candidate must be eligible.

If grounding validation fails:

regenerate or fall back to deterministic template.

---

# 102. Numeric claim rule

Any number shown in generated text must have a source fact ID.

Example invalid:

```text
Vous perdrez environ 200 €.
```

if no engine result provides that value.

---

# 103. Derived-language rule

The AI may translate:

```text
variationPct = 21
```

into:

```text
+21 %
```

It may not change it to:

```text
environ +25 %
```

unless explicit display-rounding rules allow that representation.

---

# 104. Rounding

Rounding must be performed by application formatting rules.

The AI receives or outputs display-ready numbers where possible.

---

# 105. Prompt architecture

Recommended logical prompt layers:

```text
System business rules
        ↓
Surface-specific instructions
        ↓
Structured context
        ↓
Candidate list
        ↓
French output schema
```

Do not inject entire raw document contents when structured extraction already exists.

---

# 106. Prompt versioning

Every persisted Copilot recommendation should record:

```text
promptVersion
modelVersion/model identifier
generation timestamp
```

for auditability.

---

# 107. Deterministic fallback

If AI service is unavailable:

the application should still display:

- KPI cards;
- analytical candidates;
- deadlines;
- substitution candidates;
- deterministic warnings.

French fallback templates may produce basic guidance.

The application must remain operational without generative AI.

---

# 108. Example deterministic fallback

```text
Point de vigilance : casse avocat

Casse au coût connu : 46 €
Référence : 27 €
Écart : +70 %

Action : vérifier le produit.
```

No AI required.

---

# 109. AI availability state

French UI:

```text
Analyse IA temporairement indisponible
Les indicateurs restent accessibles.
```

AI outage must not block imports or business analytics.

---

# 110. Recommendation duplication

Do not create repeated identical recommendations every day.

Use semantic identity based on:

```text
recommendation type
entity
trigger condition
active event
```

A continuing issue should update or reopen an existing recommendation where appropriate.

---

# 111. Recommendation lifecycle

Recommended:

```text
PROPOSED
  ↓
ACCEPTED / MODIFIED / POSTPONED / REJECTED
  ↓
PLANNED
  ↓
EXECUTED
  ↓
REVIEWED
```

Alternative exit:

```text
CANCELLED
```

---

# 112. Resolved issue

If the triggering condition disappears before action:

recommendation may become:

```text
RESOLVED
```

Example:

```text
stockout ended
```

No need to execute stale substitute action.

---

# 113. Reopening

A similar issue later should create a new episode or explicitly reopen with new evidence, not overwrite old history.

---

# 114. Decision audit

Persist:

- recommendation shown;
- facts available then;
- user decision;
- modifications;
- execution;
- outcome.

This creates a future learning dataset.

---

# 115. Recommendation effectiveness — future use

The application may later learn:

```text
which recommendation types are often accepted
which actions tend to correlate with improved outcomes
```

This must not automatically become causal optimization in MVP.

---

# 116. User preference learning

The system may remember non-sensitive operational preferences such as:

- preferred TG usage;
- preferred alert thresholds;
- preferred review horizon.

Do not let preference override business safeguards.

---

# 117. Recommendation conflict detection

Before output, detect conflicting actions.

Examples:

```text
Increase display of Product A
+
Reduce display of Product A
```

or:

```text
Promote Product B
+
Avoid overlapping promotion on Product B
```

The Copilot must present the trade-off rather than both as independent priorities.

---

# 118. Trade-off format

French UI:

```text
Arbitrage nécessaire

Option 1
Réduire l'exposition pour limiter la casse.

Option 2
Maintenir l'exposition car une opération nationale démarre demain.

À vérifier
Stock restant et qualité produit.
```

---

# 119. Recommendation dependency

Some recommendations depend on a previous check.

Example:

```text
1. Check stock.
2. If high stock confirmed, consider price action.
```

Model dependencies explicitly.

---

# 120. Recommendation dependency contract

```ts
type RecommendationDependency = {
  recommendationId: string;
  dependsOnRecommendationId: string;

  condition:
    | "MUST_COMPLETE"
    | "IF_CONFIRMED"
    | "IF_NOT_CONFIRMED";
};
```

---

# 121. Conditional recommendation

Example:

```text
Si le stock restant est élevé :
envisager une baisse locale.

Sinon :
maintenir le prix et réduire l'exposition.
```

The Copilot may produce conditional recommendations when facts are incomplete.

---

# 122. Deadline recommendation

Deadline recommendations must include:

```text
what
when
source
status
```

Example:

```text
Précommande à effectuer avant lundi 21 septembre.
Source : communication semaine 38.
```

---

# 123. Waste-specific confidence

Waste recommendation confidence should consider:

- known cost coverage;
- ticket validation coverage;
- recurring pattern;
- sales completeness;
- quantity-unit compatibility.

---

# 124. Promotion-specific confidence

Promotion recommendation confidence should consider:

- actual execution known;
- before/during/after completeness;
- overlapping operations;
- price mechanism complexity;
- stockout/quality events;
- baseline quality.

---

# 125. Substitution-specific confidence

Substitution recommendation confidence should consider:

- relationship confidence;
- evidence count;
- candidate active status;
- price compatibility;
- current availability known/unknown;
- concurrent promotion;
- data quality.

---

# 126. Planning-specific confidence

Weekly recommendation confidence should consider:

- source validation;
- store applicability;
- weather horizon;
- deadline certainty;
- operation version conflicts;
- product matching.

---

# 127. “Why now?” explanation

Each top priority should support:

```text
Pourquoi maintenant ?
```

Example:

```text
La précommande ferme aujourd'hui à 18h.
```

or:

```text
La casse représente 27 % de la casse connue du rayon hier.
```

---

# 128. “Why this product?” explanation

For product recommendations show:

```text
economic contribution
deviation
waste
promotion
tension
substitution
```

as relevant.

---

# 129. “Why this substitute?” explanation

Show:

- Need Unit;
- behavioural relation;
- confidence;
- price compatibility;
- previous observations;
- commercial context.

---

# 130. “What if?” explanations

The Copilot may explain deterministic scenarios.

Example:

```text
Si le prix passe à 2,49 €/kg...
```

only using values returned by the scenario engine.

No demand forecast unless explicitly available.

---

# 131. Recommendation rank explanation

A user may ask why priority 1 outranks priority 2.

The system should expose deterministic factors:

```text
deadline
economic impact
urgency
data quality
```

The LLM may verbalize them.

---

# 132. Safety around low-value percentage changes

The Copilot should not dramatize percentage changes on tiny bases.

Example:

Instead of:

```text
+500 % !
```

prefer:

```text
+5 € vs référence, sur une base faible.
```

when engine indicates low denominator.

---

# 133. Avoid alarm fatigue

Do not promote every deviation into a priority.

The Copilot should prioritize meaningful, actionable issues.

Low-impact candidates remain in analytics.

---

# 134. Recommendation quality criteria

A strong recommendation is:

- grounded;
- actionable;
- proportionate;
- measurable;
- time-bounded;
- aware of missing data;
- aware of commercial conflicts;
- explicit about confidence.

---

# 135. Bad recommendation example

Invalid:

```text
Baissez le prix des avocats de 20 %, cela devrait augmenter les ventes de 35 %.
```

unless a validated predictive model explicitly provides those values.

---

# 136. Better recommendation example

Valid:

```text
La casse avocat augmente fortement alors que les ventes restent stables.

Action proposée
Vérifier le stock et la maturité aujourd'hui.

Si un stock élevé est confirmé, simuler une action prix avant décision.
```

---

# 137. Daily priority types

Typical Daily priorities:

```text
waste control
sales investigation
stock/tension response
execution check
data correction
substitute monitoring
```

---

# 138. Weekly priority types

Typical Weekly priorities:

```text
pre-order deadline
major promotion preparation
TG setup
market tension preparation
substitute planning
promotion overlap
Storeline / Drive setup
```

---

# 139. Product priority types

Typical Product recommendations:

```text
monitor waste
verify quality
verify stock
inspect price
reinforce substitute
review promotion performance
```

---

# 140. Action review learning types

Possible AI retrospective:

```text
Keep
Adjust
Do not repeat yet
Insufficient evidence
```

French UI:

```text
À reproduire
À ajuster
À ne pas reconduire pour l'instant
Données insuffisantes
```

These remain recommendation summaries, not universal rules.

---

# 141. Feedback after review

User may confirm:

```text
Utile
Peu utile
Non pertinent
```

Optional comment.

This is UX/recommendation feedback, not KPI data.

---

# 142. Model choice is technical configuration

This functional specification does not mandate a specific LLM vendor or model.

The technical specification must define:

- model/provider;
- latency target;
- cost controls;
- structured output support;
- vision support where relevant;
- data-processing policy.

---

# 143. Model specialization is optional

The implementation may use:

- one model for all Copilot tasks;
- different models for extraction, synthesis and recommendations.

Functional behaviour must remain identical.

---

# 144. Context-size control

The system should send only relevant facts.

Do not send all historical data for every recommendation.

Use:

- selected period;
- top contributors;
- relevant operation;
- relevant substitution relations;
- data-quality summary.

---

# 145. Summarization cache

The system may cache structured historical summaries.

Cached summaries must not replace raw deterministic metrics as authoritative facts.

---

# 146. Recommendation prompt injection resistance

Uploaded documents are data sources.

Instructions written inside a PDF or ticket that attempt to control the AI outside business extraction must be treated as document content, not model instructions.

---

# 147. Document-content trust

The PDF may contain commercial instructions from the enseigne.

The AI must extract them as:

```text
Instruction enseigne
```

but must not allow arbitrary document text to modify application/system rules.

---

# 148. Privacy

The Copilot operates on private store operational data.

Recommendations and source documents must not be public by default.

---

# 149. Logging

Log:

- generation request ID;
- context IDs;
- candidate IDs;
- model identifier;
- prompt version;
- output validation result;
- latency;
- failure mode.

Do not log sensitive raw content unnecessarily.

---

# 150. AI error states

Possible states:

```text
MODEL_UNAVAILABLE
OUTPUT_SCHEMA_INVALID
GROUNDING_FAILED
TIMEOUT
INSUFFICIENT_CONTEXT
```

French UI should remain user-friendly.

---

# 151. Grounding failure fallback

If the AI references a missing number or invalid product:

do not show the generated answer.

Fallback to:

- deterministic cards;
- templated recommendation;
- or “analyse indisponible”.

---

# 152. Recommendation generation frequency

Recommended:

Daily brief:

```text
after latest business-day data becomes complete
```

Weekly brief:

```text
after PDF validation
and when key context changes
```

Product recommendation:

```text
on demand
or after a material signal
```

---

# 153. Avoid unnecessary regeneration

Do not call AI repeatedly when context has not changed.

Persist generation fingerprint based on relevant inputs.

---

# 154. Recommendation regeneration triggers

Examples:

- new sales import;
- new waste validation;
- operation validation;
- new stockout;
- event closure;
- action execution;
- significant weather forecast update;
- substitution score change;
- critical data correction.

---

# 155. Today brief acceptance criteria

A daily brief must:

- use latest complete business day;
- show no more than 3 priorities;
- reference available facts;
- expose data quality;
- not invent missing data.

---

# 156. Week brief acceptance criteria

A weekly brief must:

- identify urgent deadlines;
- use validated commercial plan;
- separate enseigne instructions from AI recommendations;
- surface relevant market tensions;
- surface substitute plans where appropriate;
- show no more than 3 priorities.

---

# 157. Product brief acceptance criteria

A product brief must:

- show product/category/nature context;
- use deterministic KPI outputs;
- include waste context;
- include promotion context;
- include relevant Need Units/substitutes;
- state uncertainty where required.

---

# 158. Operation brief acceptance criteria

An operation brief must:

- use actual execution period when known;
- mention incomplete execution;
- compare before/during/after;
- expose overlapping context;
- avoid causal overclaim.

---

# 159. Acceptance criteria

## AI-AC-01 — Maximum three priorities

**Given:** ten eligible candidates.  
**Expected:** no more than three are shown as primary priorities.

---

## AI-AC-02 — Full list remains available

**Given:** candidates not selected in top three.  
**Expected:** they remain accessible in detailed analytics/planning.

---

## AI-AC-03 — Structured facts only

**Given:** KPI engine provides €46 waste, €27 reference, +70.4%.  
**Expected:** AI uses these values and does not recalculate alternatives.

---

## AI-AC-04 — Missing N-1

**Given:** no N-1 data.  
**Expected:** AI states N-1 unavailable and does not invent comparison.

---

## AI-AC-05 — Latest complete date

**Given:** latest complete date is two days ago.  
**Expected:** brief names that date and does not say “hier”.

---

## AI-AC-06 — Facts vs interpretation

**Given:** temperature increased and sales increased.  
**Expected:** AI separates both facts and labels any connection as hypothesis/correlation.

---

## AI-AC-07 — No causal promotion claim

**Given:** volume +25% during promotion.  
**Expected:** AI says +25% observed during period, not caused by promo.

---

## AI-AC-08 — Waste cost uncertainty

**Given:** only 70% waste cost coverage.  
**Expected:** AI exposes the limitation before margin/waste conclusion.

---

## AI-AC-09 — Stock unknown

**Given:** no stock data.  
**Expected:** AI does not say “surstock”; may recommend checking stock.

---

## AI-AC-10 — Substitute recommendation

**Given:** product A stockout, B strong relation, medium confidence.  
**Expected:** AI can recommend monitoring/reinforcing B and shows medium confidence.

---

## AI-AC-11 — Commercial vs behavioural substitute

**Given:** B strongest behavioural substitute, C higher margin.  
**Expected:** AI does not call C strongest substitute solely due to margin.

---

## AI-AC-12 — Promotion overlap

**Given:** two strong substitutes promoted simultaneously.  
**Expected:** AI raises overlap/cannibalization risk without quantifying causal cannibalization.

---

## AI-AC-13 — Break-even scenario

**Given:** engine provides +39% break-even volume threshold.  
**Expected:** AI labels it mathematical threshold, not demand forecast.

---

## AI-AC-14 — Unknown cost

**Given:** no purchase cost.  
**Expected:** AI does not propose validated numeric local price based on margin.

---

## AI-AC-15 — Enseigne vs AI

**Given:** source PDF instructs TG installation and AI proposes substitute display.  
**Expected:** UI clearly labels Instruction enseigne vs Recommandation IA.

---

## AI-AC-16 — Accepted is not executed

**Given:** user accepts recommendation.  
**Expected:** action remains unexecuted until user records execution.

---

## AI-AC-17 — Modified action

**Given:** user changes proposed price.  
**Expected:** review uses actual user-selected price.

---

## AI-AC-18 — Rejected recommendation

**Given:** user rejects recommendation.  
**Expected:** decision and optional reason retained.

---

## AI-AC-19 — Postponed recommendation

**Given:** user postpones until Friday.  
**Expected:** recommendation reappears at appropriate time unless trigger resolved.

---

## AI-AC-20 — Stale recommendation

**Given:** new data invalidates old context.  
**Expected:** old recommendation is marked stale/recalculated, not silently reused.

---

## AI-AC-21 — Conflicting candidates

**Given:** one candidate suggests increasing exposure, another reducing exposure.  
**Expected:** Copilot presents an explicit trade-off.

---

## AI-AC-22 — Conditional action

**Given:** action depends on unknown stock.  
**Expected:** AI may create “check stock first” dependency.

---

## AI-AC-23 — Data-quality priority

**Given:** critical import/matching issue affects results.  
**Expected:** data validation may become top-three priority.

---

## AI-AC-24 — AI outage

**Given:** LLM unavailable.  
**Expected:** deterministic dashboard and candidate alerts remain operational.

---

## AI-AC-25 — Grounding failure

**Given:** generated answer references nonexistent KPI.  
**Expected:** answer is rejected before display.

---

## AI-AC-26 — Source traceability

**Given:** recommendation uses market tension from PDF.  
**Expected:** user can open the source reference.

---

## AI-AC-27 — Low economic impact

**Given:** +500% on a very small base.  
**Expected:** AI does not sensationalize or prioritize solely on percentage.

---

## AI-AC-28 — Multiple explanations

**Given:** several plausible confounders.  
**Expected:** AI lists them rather than forcing one explanation.

---

## AI-AC-29 — Human authority

**Given:** AI recommends action.  
**Expected:** no external business action occurs without explicit user decision.

---

## AI-AC-30 — French UI

**Given:** internal recommendation generated from English schemas.  
**Expected:** displayed explanation and actions are in French.

---

# 160. Out of scope

The following are outside AI Copilot MVP v0.1:

- fully autonomous general-purpose agent;
- autonomous ordering;
- autonomous pricing;
- direct autonomous Mercalys changes;
- direct autonomous Storeline changes;
- autonomous Drive changes;
- customer-level personalization;
- employee surveillance;
- causal promotion attribution;
- causal weather attribution;
- automatic price elasticity learning;
- advanced demand forecasting;
- black-box reinforcement learning;
- automatic multi-store policy optimization;
- free-form agent browsing unrelated external sources;
- unattended execution of recommendations.

---

# 161. Recommended implementation architecture

```text
Deterministic business engines
        ↓
Candidate aggregator
        ↓
Eligibility filter
        ↓
Deterministic priority scoring
        ↓
Semantic merge / conflict detection
        ↓
LLM generation
        ↓
Grounding validator
        ↓
Recommendation persistence
        ↓
French UI
        ↓
Human decision
        ↓
Execution
        ↓
Analytics review
```

---

# 162. Candidate aggregator

Responsibilities:

- collect analytics candidates;
- collect weekly commercial candidates;
- attach entity context;
- attach data-quality context;
- attach substitution context;
- deduplicate exact triggers.

No natural-language generation required.

---

# 163. Eligibility filter

Reject or downgrade:

- invalid entity;
- missing critical fact;
- rejected relation;
- non-applicable operation;
- obsolete deadline;
- insufficient quality;
- inactive product.

---

# 164. Priority engine

The canonical priority engine should remain deterministic/configurable.

The LLM may explain ranking but should not secretly replace it.

---

# 165. Semantic merge stage

LLM or deterministic semantic logic may group related candidates.

Any merge must preserve:

```text
all source candidate IDs
all evidence
all conflicts
```

---

# 166. Generation stage

The LLM receives:

- top candidate set;
- facts;
- context;
- confidence;
- allowed action types;
- UI surface;
- French output schema.

---

# 167. Grounding validator

Validate:

```text
products
numbers
dates
sources
recommendation type
candidate IDs
```

before display.

---

# 168. Persistence

Persist final:

- recommendation;
- provenance;
- generation metadata;
- user decisions;
- execution links;
- review links.

---

# 169. Testing strategy

The Copilot test suite must include:

- golden structured contexts;
- exact expected facts;
- forbidden claims;
- low-data cases;
- conflicting-signal cases;
- substitution cases;
- promotion cases;
- waste cases;
- AI outage;
- invalid model output.

---

# 170. Golden Copilot scenarios

At minimum:

```text
1. Waste spike with high-quality data
2. Waste spike with unknown stock
3. Sales drop with stockout
4. Strong substitute response
5. Substitute simultaneously promoted
6. Weekly pre-order deadline
7. Market tension without store stockout
8. Promotion executed incompletely
9. Promotion observed growth with confounder
10. Counter-promotion with known cost
11. Counter-promotion with unknown cost
12. Missing N-1
13. Low-impact high-percentage anomaly
14. Critical data-quality issue
15. AI service unavailable
```

---

# 171. Prompt test assertions

Tests should verify that generated output:

- contains no unsupported numbers;
- contains no prohibited causal language;
- preserves confidence;
- uses French;
- stays within three priorities;
- does not imply execution;
- identifies missing data;
- preserves source distinctions.

---

# 172. Business invariant summary

The Copilot must always preserve:

```text
Facts
vs
Interpretation
vs
Recommendation

Enseigne instruction
vs
Store observation
vs
AI recommendation

Accepted
vs
Executed

Observed change
vs
Causal effect

Behavioural substitute
vs
Commercially attractive option

Known
vs
Estimated
vs
Missing

Forecast
vs
Observed

Current recommendation
vs
Stale recommendation
```

---

# 173. Definition of completion

The AI Copilot & Recommendation Engine MVP is complete when the manager can reliably:

```text
Open Aujourd’hui
→ understand the latest complete performance
→ see no more than 3 grounded priorities
→ understand why each priority exists
→ inspect sources and confidence
→ accept / modify / postpone / reject
→ record actual execution
→ review observed results
```

and:

```text
Open Ma semaine
→ understand upcoming commercial operations
→ see deadlines and tensions
→ see substitution opportunities
→ identify promotion overlaps
→ receive no more than 3 grounded priorities
→ validate a weekly plan
```

and:

```text
Open a product
→ understand sales / margin / waste
→ understand context
→ inspect Need Units and substitutes
→ receive a bounded recommendation
```

and:

```text
Review an executed action
→ compare observed results against a valid baseline
→ see confounders
→ capture learning without causal overclaim
```

A chatbot that merely writes plausible advice without deterministic facts, provenance, confidence, human decision control and post-action measurement does **not** satisfy this specification.
