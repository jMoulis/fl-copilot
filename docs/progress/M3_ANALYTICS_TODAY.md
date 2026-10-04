# M3 shared analytics and Aujourd’hui

Date: 2026-10-04.

## Scope

The active increment covers M3-T01 through M3-T04 from `docs/specs/IMPLEMENTATION_PLAN.md`: canonical decimal arithmetic plus the initial shared KPI registry, availability rules, unit compatibility and deterministic formulas.

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

## Next work

1. Merge M3-T04 after repository-wide validation.
2. Implement M3-T05: comparison modes and availability, starting with J-7 and explicit missing-reference/sample-size behavior.
