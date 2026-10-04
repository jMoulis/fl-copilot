# M3 shared analytics and Aujourd’hui

Date: 2026-10-04.

## Scope

The completed increment covers M3-T01 through M3-T11 from `docs/specs/IMPLEMENTATION_PLAN.md`: canonical decimal arithmetic, the initial shared KPI registry, deterministic daily performance builders, explicit comparisons, analytical data quality, structured candidate detection, scoped local recomputation, remote confirmation parity, the native `Aujourd’hui` screen and its offline acceptance behavior.

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
- Publishing validated Mercalys lines atomically queues a local analytics job containing deduplicated product/date scopes alongside the existing remote-upload job.
- The local scheduler claims jobs idempotently, retries bounded failures and yields to the native interface between configurable chunks so pilot-sized imports do not monopolize the JavaScript event loop.
- Each scope rebuilds its `ProductDailyPerformance` from normalized validated SQLite observations and upserts a rebuildable local read model with formula version, input revision and source lineage.
- `DepartmentDailyPerformance` is rebuilt once per affected business date after all product scopes in the job, avoiding repeated quadratic aggregation during large imports.
- Pending analytics work resumes when the Imports screen opens; completed product and department results remain available in SQLite for future offline screens.
- The API imports the same `analytics-core` builders through a remote confirmation service, reads canonical MongoDB observations, and upserts rebuildable product/day and department/day projections with deterministic identifiers.
- Remote scopes are deduplicated and sorted before calculation; department projections are rebuilt once per affected date after all product projections are persisted.
- MongoDB migration 7 adds the observation lookup and unique analytical read-model indexes required by remote confirmation.
- `Aujourd’hui` selects the latest analytical business date from SQLite and labels that exact date instead of assuming that it is yesterday.
- The daily view displays sales, margin and waste at purchase cost with an explicit unavailable state when the exact J-7 reference is absent.
- Product-level J-7 comparisons feed the shared deterministic candidate engine; the screen ranks by economic impact and displays at most three priorities with evidence and a proposed operational check.
- Main movements are ordered by absolute economic change, while unresolved products and incomplete core KPI inputs produce an actionable data-quality alert.
- The screen distinguishes a local analytical projection from the global synchronization state and keeps its browser preview separate from the native SQLite path.
- Native pull-to-refresh rereads SQLite only and keeps the current same-store summary rendered while the refresh is running.
- A failed local refresh shows an explicit alert without blanking the cached KPI, priority and movement content.
- Cached summaries are scoped by store so a session change cannot briefly reveal another store's data.

## Verification evidence

| Check                 | Result                                                                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decimal round-trip    | `0.580`, `4.88`, `172.45`, zero and signed values retain their exact serialized scale                                                                            |
| Floating-point safety | `0.1 + 0.2` serializes as `0.3`                                                                                                                                  |
| Exact arithmetic      | Addition, subtraction, multiplication and scale-bounded division pass unit coverage                                                                              |
| Money                 | EUR conversion, addition and quantity-by-unit-price multiplication serialize with two decimal places and half-up rounding                                        |
| Invalid values        | Exponents, partial decimals, leading zeroes, non-finite values and negative zero fail closed                                                                     |
| Missing vs zero       | Known zero remains available; fully missing inputs remain unavailable                                                                                            |
| Unit compatibility    | Compatible quantities retain scale; mixed and unknown units are unavailable                                                                                      |
| Waste bases           | Known cost, estimated cost and selling-value waste remain separate                                                                                               |
| Ratios                | Missing or non-positive denominators are unavailable; compatible valid inputs calculate deterministically                                                        |
| Registry              | KPI identifiers are unique and unvalidated aggregate margin rate remains disabled                                                                                |
| Product-day parity    | The same golden inputs serialize identically for local and remote runtimes, independent of input ordering                                                        |
| Product-day lineage   | Source record IDs, formula version and deterministic input revision remain attached to the calculated result                                                     |
| J-7 comparison        | Exact prior-week date is selected; a missing date remains unavailable and a zero reference has no percentage                                                     |
| Reference samples     | Same-weekday averages expose the actual sample size; comparable periods reject missing equivalent days                                                           |
| Extended modes        | Year-over-year, before-operation and custom references retain their explicit periods and methods                                                                 |
| Comparison stability  | Input ordering does not change serialized output, warnings, lineage or quality score                                                                             |
| Partial local import  | 75 observed records out of 100 produce source quality `0.75`, `PARTIAL` and an explicit warning                                                                  |
| Opening calendar      | Five observed configured business days out of six produce `0.8333` and identify the missing date                                                                 |
| Waste cost coverage   | 80% known, 10% estimated and 10% unknown remain separate; known-cost quality is `0.8`                                                                            |
| Quality stability     | Component and lineage input order does not change the serialized quality result                                                                                  |
| Candidate direction   | Waste requires an increase; sales and margin require decreases; opposite movements do not create candidates                                                      |
| Configured thresholds | Both absolute economic impact and percentage deviation must pass configured thresholds                                                                           |
| Candidate quality     | Extreme signals with incomplete data remain present as `LOW_QUALITY` with explicit warnings                                                                      |
| Candidate evidence    | Current, reference, absolute change, percentage change and quality remain structured and traceable                                                               |
| Scoped scheduling     | Duplicate product/date scopes collapse to one calculation and concurrent runs for one store coalesce                                                             |
| UI responsiveness     | Five scopes processed in chunks of two yield twice before completion; chunk size is configurable                                                                 |
| Retry safety          | Failed idempotent jobs move through bounded `RETRY` to `FAILED` with a retained diagnostic                                                                       |
| SQLite integration    | One validated sales/waste fixture rebuilds and caches the exact product day and department day                                                                   |
| Import trigger        | Local publication creates both remote-upload and analytics-recomputation jobs in the same transaction                                                            |
| Local/remote parity   | The golden product-day and department-day fixture serializes byte-for-byte identically through the mobile-compatible builder and the remote confirmation service |
| Today latest date     | The repository chooses the newest cached business date and never derives a false “yesterday” label                                                               |
| Today priorities      | A fixture producing four eligible signals is capped and ranked to three visible deterministic priorities                                                         |
| Missing J-7           | KPI values remain visible while comparison percentages and movements remain unavailable                                                                          |
| SQLite-only read      | The Today repository builds KPI, priority, movement and quality presentation without a network dependency                                                        |
| Offline refresh       | Pull-to-refresh rereads SQLite and retains the current same-store summary during a pending or failed refresh                                                     |
| Store isolation       | A cached Today snapshot is visible only for the active store                                                                                                     |

## Next work

1. Merge M3-T11 after repository-wide validation.
2. Complete the iPhone visual and offline acceptance pass, then record any layout or accessibility findings.
3. Close the M3 exit gate and review the global product roadmap before starting the next milestone.
