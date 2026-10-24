# M7 — complete-cohort sales concentration and generation limits

## Observed incident

The owner asked for a CA 20/80 analysis and then retried on 24 October. Both exact questions have immutable saved fallback replies. Runtime records for production `dpl_B1QDr8HVPk8omeuictVhRncVptQi` identify `COPILOT_AI_OUTPUT_LIMIT` after 53,123 and 56,290 ms, not a pending sync lease or an established timeout. No private dialogue or business figures are copied into this repository. An EventEmitter close-listener warning also appears; its origin/relationship is not established and its threshold is not raised or suppressed.

## Change

The existing `analytics_query` gains optional `includeSalesConcentration`: PRODUCT, sales alone, SUM and no `having`. Existing ranking/quantity behavior and unrequested result envelopes remain unchanged. The shared deterministic engine calculates over every observed group before pagination, for current and reference independently:

- Count and CA of products with recorded values; missing, partial and negative groups remain explicit.
- Share of recorded CA from the first fifth of known products, with the product count rounded upward.
- Minimum product count reaching eighty percent of recorded CA, that count's share of known products, and the actual cumulative sales share at the crossing.

The rule does not assert an 80/20 distribution. Exact decimals determine the crossing before presentation rounding. Negative product totals or a nonpositive/unavailable total make Pareto percentages unavailable; they are not normalized away. Explicit zero remains distinct from missing. A partial observed cohort is not certified as the complete department. Filters and current taxonomy keep existing meanings; incompatible quantities are never summed.

Each result has seven verified evidence values per period, supported source details and no misleading monetary Explorer destination for counts/percentages. Analytical evidence keys are compact, stable 128-bit SHA-256 prefixes; full source revisions and provenance remain intact. Existing duplicate-evidence checks fail closed on conflicting keys. No alias registry or authority is added; older stored citations remain supported. The existing read/evidence/input/output/time budgets are unchanged. A single query can supply the concentration and a bounded representative ranking instead of asking the model to reconstruct a whole catalogue through paged reads. No new tool, database entity, migration, write permission, arbitrary query or global prompt layer is added.

The installed Responses provider supports `textVerbosity: low`, now sent alongside the existing `store:false`, without changing model, reasoning setting, request count, token cap or timeout. A persistent output-limit fallback carries only an internal boolean and a targeted synthesis-first explanation; it no longer invites the same failing retry. Provider prose/codes are not exposed in the answer. Structured output and grounding still fail closed. Failure logs include the configured output cap, never provider response content.

## Evidence and limits

- Ten shared-engine cases include a hundred-product distribution beyond the first page, independent reference ranking, exact threshold/ceiling, pagination, partial/null/zero/negative values, filters and rejected incompatible query modes. **Nine failed before / ten pass after**.
- Actual local test Mongo verifies complete-cohort values despite a one-row page, tenant isolation, independent reference, grounded source rendering, compact stable evidence keys with full source revision, and unchanged business rows/absence of Outbox writes.
- Installed SDK tests exercise concentration on/off through the same analytics tool, verified evidence/table rendering, low verbosity and unchanged configured cap/transport count. Saved-message tests retain the safe size-limit explanation rather than replacing it with the generic retry text.
- **310 targeted tests pass** across seven files with transactional test Mongo; complete local checks pass **4,415 tests / 720 environment skips**, lint, structure and ten strict projects.
- A separate read-only evaluation captured **6,855 actual product-day rows**, 450 catalogue rows and 351 analytical groups for the two periods retained in the dialogue. The canonical shared engine gives an identical concentration on the first and last pages; both real-period results remain PARTIAL. Snapshots/results are private task artifacts, not production writes, model output or certification of one transactional production timestamp.

Exact-head push/PR CI, grouped API release and a new real conversational answer remain required. No live paid model call, production business write or new native build was performed. This code-only proof cannot guarantee that every long answer completes or close the separate listener warning, expert-dialogue/decision loop, human device checks or full V1/M8 gates.

M7 workstream **4** advances; **1/3/4/5/6/7 IN_PROGRESS, 2 CODE_READY** remain the global states. API `cefa6fe` is currently delivered; native build 15 remains available with owner acceptance unconfirmed. This server correction needs no isolated EAS build.
