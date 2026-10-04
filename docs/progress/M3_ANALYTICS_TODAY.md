# M3 shared analytics and Aujourd’hui

Date: 2026-10-04.

## Scope

The active increment covers M3-T01 through M3-T07 from `docs/specs/IMPLEMENTATION_PLAN.md`: canonical decimal arithmetic, the initial shared KPI registry, deterministic daily performance builders, explicit comparisons, analytical data quality and structured candidate detection.

## Implemented

- `@fl-copilot/analytics-core` owns the runtime-neutral decimal utilities and uses `decimal.js` with fixed precision, half-up rounding and non-exponential serialization.
- Canonical decimal input rejects exponent notation, leading plus signs, ambiguous leading zeroes, non-finite values and negative zero.
- Parsing records the source scale so a decimal such as `0.580` round-trips without becoming `0.58` unless normalization is explicitly requested.
- Addition and subtraction retain the maximum input scale; multiplication retains the combined scale; division requires an explicit output scale.
- EUR helpers serialize amounts with two decimal places and use deterministic half-up rounding for conversion, addition and quantity-by-unit-price multiplication.
- The central KPI registry now defines sales, quantity, purchase value, source margin value, average realized price, distinct waste bases and initial ratios with explicit inputs, units, aggregation rules, missing-data policies and activation status.
- Shared formula results preserve known zero, expose partial coverage, keep missing input unavailable and reject mixed or unknown quantity units.
- Known and estimated waste purchase costs remain independently aggregatable, while waste selling value remains explicitly distinct from realized sales.
- Aggregate source margin rate remains disabled until its business denominator is validated; no arithmetic average of line rates is provided.
- Comparison availability treats a missing reference as unavailable rather than a zero variation.
- The shared `ProductDailyPerformance` builder aggregates one validated product-day with deterministic field order, source lineage, formula version and input revision.
- The product-day result keeps sales and waste independent, preserves known and estimated waste costs, ignores reconciled deleted observations and never averages multiple source margin rates.
- A shared golden fixture proves identical serialized output when local and remote adapters provide the same inputs in different orders.
- The `DepartmentDailyPerformance` builder aggregates product money metrics with deterministic ordering and propagates partial availability from product results.
- Department results deliberately omit global quantity totals across incompatible product sales units and keep aggregate margin rate unavailable instead of averaging source rates.
- Duplicate products and product-day results outside the requested store/date perimeter fail closed.
- The shared comparison engine supports J-7, previous comparable week, an average of previous matching weekdays, year-over-year, before-operation and custom reference periods.
- Every comparison records its exact reference method, requested and actual sample sizes, current/reference periods, warnings, lineage and a deterministic quality score.
- Missing references remain unavailable, zero references expose only the absolute difference, and partial source coverage lowers the quality score without being silently discarded.
- Comparable-week comparisons align each current date to its exact J-7 business date; year-over-year uses the actual prior calendar date instead of synthesizing history.
- The shared data-quality engine evaluates source completeness, product matching, waste cost coverage, reference quality, period completeness, unit compatibility, execution data and context without treating omitted dimensions as zero.
- Coverage components preserve complete, partial and missing states; a partial local import therefore lowers both its source score and the overall analytical quality score.
- Period completeness uses explicit configured store opening dates, deduplicates observations and exposes missing and unexpected dates instead of inferring completeness from calendar days.
- Waste cost quality exposes known, estimated and unknown value shares independently; only the known share contributes to the known-cost coverage score.
- The initial candidate engine detects configurable waste spikes, sales drops, margin drops and data-quality alerts from comparison and quality outputs.
- Candidate thresholds define minimum and full-scale absolute impact, percentage deviation, urgency and minimum acceptable quality outside UI code.
- Missing references suppress business-change candidates; a valid zero reference may still produce a waste spike with a null percentage and an explicit warning.
- Extreme signals backed by incomplete inputs remain visible as `LOW_QUALITY`; structured evidence and lineage let downstream layers explain the limitation without recalculating facts.
- Multiple signals for the same entity remain separate analytical candidates so a later ranking or AI layer can combine them without losing evidence.

## Verification evidence

| Check                 | Result                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Decimal round-trip    | `0.580`, `4.88`, `172.45`, zero and signed values retain their exact serialized scale                                     |
| Floating-point safety | `0.1 + 0.2` serializes as `0.3`                                                                                           |
| Exact arithmetic      | Addition, subtraction, multiplication and scale-bounded division pass unit coverage                                       |
| Money                 | EUR conversion, addition and quantity-by-unit-price multiplication serialize with two decimal places and half-up rounding |
| Invalid values        | Exponents, partial decimals, leading zeroes, non-finite values and negative zero fail closed                              |
| Missing vs zero       | Known zero remains available; fully missing inputs remain unavailable                                                     |
| Unit compatibility    | Compatible quantities retain scale; mixed and unknown units are unavailable                                               |
| Waste bases           | Known cost, estimated cost and selling-value waste remain separate                                                        |
| Ratios                | Missing or non-positive denominators are unavailable; compatible valid inputs calculate deterministically                 |
| Registry              | KPI identifiers are unique and unvalidated aggregate margin rate remains disabled                                         |
| Product-day parity    | The same golden inputs serialize identically for local and remote runtimes, independent of input ordering                 |
| Product-day lineage   | Source record IDs, formula version and deterministic input revision remain attached to the calculated result              |
| J-7 comparison        | Exact prior-week date is selected; a missing date remains unavailable and a zero reference has no percentage              |
| Reference samples     | Same-weekday averages expose the actual sample size; comparable periods reject missing equivalent days                    |
| Extended modes        | Year-over-year, before-operation and custom references retain their explicit periods and methods                          |
| Comparison stability  | Input ordering does not change serialized output, warnings, lineage or quality score                                      |
| Partial local import  | 75 observed records out of 100 produce source quality `0.75`, `PARTIAL` and an explicit warning                           |
| Opening calendar      | Five observed configured business days out of six produce `0.8333` and identify the missing date                          |
| Waste cost coverage   | 80% known, 10% estimated and 10% unknown remain separate; known-cost quality is `0.8`                                     |
| Quality stability     | Component and lineage input order does not change the serialized quality result                                           |
| Candidate direction   | Waste requires an increase; sales and margin require decreases; opposite movements do not create candidates               |
| Configured thresholds | Both absolute economic impact and percentage deviation must pass configured thresholds                                    |
| Candidate quality     | Extreme signals with incomplete data remain present as `LOW_QUALITY` with explicit warnings                               |
| Candidate evidence    | Current, reference, absolute change, percentage change and quality remain structured and traceable                        |

## Next work

1. Merge M3-T07 after repository-wide validation.
2. Implement M3-T08: scoped local recomputation by product and business date without blocking the UI.
