# Original offers — deferred discovery is part of the workflow, 24 October

## Reproduction

The existing three-offer test used a small authorized catalogue, where definitions are immediately available. Production-sized catalogues defer tools through the installed SDK. An original-choice-capable turn still reserved only eight generation steps. The SDK counts discovery too; the app forced `tool_choice: none` at step index 7, before the second offer, instead of the required final step index 10.

The same scenario now covers eager/deferred loading and ordinary/true Responses SSE transport. Three deferred cases fail before the change, while eager cases pass. Exact PDF, product and offer searches make definitions available only on the next step; unrelated authorized callbacks remain unused. This is a controlled transport reproduction, not attribution to a particular owner's conversation or a paid model evaluation.

## Minimal change

The same `ToolLoopAgent` retains seven business reads and the final answer reservation. Only original-choice-capable turns with a large deferred catalogue gain three metadata-step slots, derived from discovering the PDF reader, product resolver and offer proposer. The hard total is eleven steps; eager original turns remain eight and ordinary discovery remains six. Repeated or irrelevant search still consumes that bounded total. No new agent, custom router, instruction, tool, capability, provider/model, dependency, schema or writer.

Business reads, per-read and total evidence, input bytes, PDF count/pages/size, output-token and wall-clock limits remain unchanged. More metadata rounds are now possible within those existing limits; this does not authorize additional business reads or execution. An adversarial eighth business call alongside the last offer returns unavailable before its callback, while the final reply and three review cards still finish.

## Evidence and delivery boundary

**255 targeted tests / two files pass**, including the actual installed SDK/provider transport, ordinary and streamed three-offer completion, seven-read enforcement, unused-tool refusal and existing discovery limits. Source: installed `ai` 7.0.130 docs/source (`tool-search`, `isStepCount`, `prepareStep`). The registry's latest version was checked as 7.0.152 in the same major; no dependency or system tool was upgraded.

Full local source check: **4,478 passed / 727 environment-dependent skips**, ten strict TypeScript projects, lint/structure, format and API bundle build pass. Exact push/PR CI, master and a staged compatible API release remain subsequent gates. The already available iOS build **16** advertises the existing capability; this fix requires **no new EAS build**. Existing source verification, explicit native confirmation, local transaction/Outbox and decision/execution distinctions remain intact. Owner recipe, actual-model quality and all remaining V1/M8 gates stay open; seven M7 states remain 1/3/4/5/6/7 in progress, 2 code ready.
