# Analyses — source channels and retail N−1, 30 October 2026

## Owner arbitration and observed problem

Prioritise useful comparisons before new Copilot capabilities. Sales and margin do not require a waste entry every day. Mercalys waste can be dated when the handheld is unloaded rather than when the item was scanned; call it recorded waste and do not invent the true loss date. Default retail N−1 means the same ISO week and weekday, including when exploring a civil month/year. An explicit pair of source/chat periods remains explicit.

Read-only investigation of the pilot's week 43 found fourteen department snapshots across the two years. On 19 October 2026, 152 product-days had sales amounts and ten had only waste. The previous department aggregation treated these ten absent sales as missing sales inputs, marked the whole day partial, and the Explorer then hid the comparison. This investigation did not prove that every source export was complete and did not write production data.

## Change

- The existing shared department builder aggregates each source channel over product-days with inputs in that channel. Missing amounts/margin/cost within an existing source and unresolved publication rows still qualify that metric. An absent channel remains null, never zero.
- Existing formulas, observed amounts, source lineage, published observations, identities and synchronization contracts are retained. A deterministic input-revision prefix identifies refreshed derived coverage without changing the payload schema.
- Existing local calculation scheduling refreshes legacy department projections from available product projections, in small transactions with UI yields. Incomplete bootstrap inputs are retained. No file reimport, Outbox command, new worker, AI call or business publication is needed.
- Existing authenticated sync maintenance opportunistically refreshes at most sixteen legacy remote department projections per pass, with a time-budget check between rows and a revision-conditioned update. Originals and product observations are untouched. Remote catch-up is progressive, not an assertion of immediate completion across all history.
- Default day/week/month/year pairs use one shared ISO-week/weekday mapping. Reference queries include the actual dates, even outside the civil anniversary month. A week 53 without a counterpart stays unmatched.
- Closed equivalent days with recorded values on both sides can produce an indicative comparison. Partial data and omitted pairs retain PARTIAL status, warnings and lower quality. The displayed period's recorded total is distinct from the comparison's paired totals. No overlap means no delta; zero reference means no percentage.
- The Explorer displays compared amounts and the indicative qualification. Explicit source periods retain their original calendar/aggregation contract; they are not silently realigned.

## Verification and delivery limits

Targeted shared-engine, SQLite and real isolated MongoDB tests cover separate channels, missing/zero values, weekday pairing, actual reference query ranges, partial comparisons, historical catch-up, store isolation and repeat/no-op behavior. Full checks and exact final-head CI are recorded with the delivery, not inferred from this document.

No production data repair, API release, paid model request or EAS build has been performed during development. An installed native build and owner validation of week 43 remain required before calling the phone issue resolved. This corrective programme does not re-arm the cleared autonomous V1 goal or claim full M7/M8 completion.
