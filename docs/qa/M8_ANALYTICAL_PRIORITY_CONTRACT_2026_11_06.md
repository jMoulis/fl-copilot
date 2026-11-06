# M8 — analytical priorities and deterministic recommendation contract, 6 November 2026

## Production diagnosis

The owner again sees the fallback in the latest chat on source `b7dcb98`. The model completes four expert steps in 76,024 ms, with no read failures. Its final response uses 4,217 output tokens under the new 10,000 ceiling: neither the output ceiling nor the generation deadline causes this failure. The response-service log for HTTP request `b9d4ed79-5757-4bd5-bec5-7f6ff278b88a` identifies **GROUNDING / INVALID_CANDIDATE**. The model-completion END log does not prove successful response validation or persistence of an AI answer. The light dispatch fails local/structured validation and uses its existing expert fallback; its unknown usage is not counted as zero.

The legacy structured recommendations field requires a supplied eligible deterministic candidate. The canonical read-only conversation context supplies none. A request for qualitative analytical priorities can therefore produce a completed narrative plus an inapplicable structured recommendation, causing the entire response to fail validation. The raw invalid model response was not logged or recovered; do not claim its specific business content has been inspected. Existing source-ID validation precedes candidate validation; later prose checks may not have run on this invalid response.

## Focused correction

Bind the new model-output schema to the supplied candidate pool. With no eligible candidate, recommendations must be an empty array (maxItems zero). With eligible candidates, candidateId is an enum of their actual IDs. Keep the existing canonical/stored response schema and the full server validator unchanged: source ownership, numbers, candidate eligibility/type, priority ordering and trade-off requirements still apply. Do not invent a candidate, silently approve an action, strip rejected actions afterward or relax grounding.

Clarify the existing instruction: analytical priorities and qualitative merchandising advice belong in narrative. The legacy recommendations field represents only the supplied eligible deterministic candidates. Dedicated reviewed action/decision tools remain available through their existing approval workflows. No new tool, model call, writer, collection, public API contract or mobile build.

The monthly SDK fixture now models this exact contract mismatch: when the wire permits an unbound recommendation, the controlled model returns a structurally valid qualitative priority using an unsupplied candidate ID. Against the previous runtime, the response service emits **INVALID_CANDIDATE**, reproducing the production rejection after successful generation. With the corrected wire, the three qualitative priorities remain in narrative, recommendations stays empty, and source/numerical validation plus canonical message building succeed. This is a bounded model-transport fixture, not a complete emulator of the OpenAI provider.

## Verification and limits

387 tests across eleven suites pass, zero skips. Coverage includes streaming/non-streaming monthly completion and safe partial output, native message construction, large/deferred tools, source/chart preservation, token limits, titles and notification previews. Three new schema-boundary cases cover no candidates, eligible IDs and supplied-but-suppressed candidates. Existing response-service tests continue rejecting ungrounded/noneligible actions and invalid numerical prose. The old-runtime monthly regression fails with the same INVALID_CANDIDATE code; the final runtime passes. Ten-project types, workspace lint, changed-file formatting and API build/import also pass.

Keep the released adaptive ceilings, compact model evidence and safe partial behavior unchanged. No paid synthetic model request was made. API-only: build39 stays compatible. Exact-head CI, staged/public release checks and owner monthly acceptance remain separate. Preserve source `b7dcb98` / deployment `dpl_GeJu6i3wVVdP2xgGuXmRTZbv5agn` for rollback. A next ordinary owner exchange must still verify the complete real response; source/number checks remain active and no model test is a guarantee of provider behavior.
