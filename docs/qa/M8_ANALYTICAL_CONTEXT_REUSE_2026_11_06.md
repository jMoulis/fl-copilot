# Analytical context reuse — 6 November 2026

## Scope and observed baseline

The owner prioritizes token consumption after accepting the monthly answer. That successful ordinary exchange reports 203,087 input tokens across five model steps (router included), 4,304 output tokens and 65,222 cached input tokens included in the input total. These are observed counters, not a monetary bill or a controlled comparison. An earlier monthly trace grows from 7,069 to 57,667 input tokens after its initial analytical reads.

The current controlled monthly workload sends 138,712 serialized bytes across four model-facing tool results. Its product query alone is 78,333 bytes, including 35,449 bytes of rows and 42,221 bytes of evidence. Coverage objects repeat per product and metric. The final-step conclusion override also changes the initial instructions before the entire accumulated tool context; this is reproduced at the actual Responses request boundary, not inferred only from source code.

## Focused correction

1. Within the existing model-only analytical adapter, encode each query row's metrics as a named-column table and intern exact current/reference coverage objects in a local `coverages` array. Preserve every value, decimal precision, null, zero, warning, missing-date example, unit, pagination field and evidence reference. Heterogeneous metric shapes retain their original form so missing properties never become null. Canonical tool execution results, hashes, stored sources, charts and grounding remain unchanged. Other tool families retain their existing structure.
2. Append the existing server-authored conclusion control as a final system message instead of replacing the initial agent instructions. Explicitly allow only this constructed system message through the SDK; user/history/source content stays in the existing serialized user prompt. Tools, output schema and previous input messages remain unchanged at the provider request boundary, including when `tool_choice` becomes `none`. No history is removed or summarized.

The main instruction gains only the explanation of local coverage indexes. No new model, agent, dependency, request, schema, database writer or larger budget. Existing credentials/configuration remain unchanged. No live paid AI test is made.

## Validation and measurements

**305 tests across five suites pass, zero skipped**, covering the real installed AI SDK/provider transport with scripted HTTP responses, streaming/non-streaming, length-limited partial answers, exhausted read budgets, complete source rendering, reference binding and chart/hash preservation. Unit decoding reconstructs exact original metric objects including null/zero, dates, warnings and evidence references. The two targeted regressions fail on the previous runtime: no shared coverages, and a changed initial instruction prefix on the concluding step. Full ten-project typecheck, lint, formatting and API build/import pass.

The same monthly fixture now sends **113,614 bytes versus 138,712 immediately before this correction: 18.09% fewer**. All four results and the same 96 output facts remain; no sampling or shortened answer fixture. The reference-list size stays 2,007 bytes. Replayed duplicate reads still count against the same byte/read limits. This is a serialized-byte comparison, not measured provider-token savings or a claim of cache hits.

The version-matched installed `ai` 7.0.130 docs/source support `prepareStep.messages` and `allowSystemInMessages`; the installed OpenAI provider 4.0.91 preserves the appended message order. [OpenAI cache diagnostics](https://developers.openai.com/api/docs/guides/prompt-caching/diagnostics) requires an exact prefix and compatible settings; stable request tests establish eligibility, not remote cache residency or billing.

## Delivery and remaining acceptance

Both exact-head push/PR checks, merge and grouped API deployment are separate from these local results. Include the already merged quantity-sort correction (PR466) in the API batch. Build39 remains compatible; no EAS build is needed. After delivery, inspect one ordinary owner analysis for completion/quality, STEP input/output/cache counters and tool bytes. No numerical savings target is claimed until that observation; broader M8 remains open.
