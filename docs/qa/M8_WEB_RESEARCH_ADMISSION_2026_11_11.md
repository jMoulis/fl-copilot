# M8 web research admission and diagnostics

## Observed owner exchange

The 11 November morning exchange requests public information about fruit and vegetable consumption in France. Read-only canonical message inspection confirms the assistant reports a failed web lookup without inventing results. Production usage records show discovery, one public_research tool call, a completed reply and empty readFailures. No copilotWebResearch reservation exists for that canonical USER message. The conversation and parent message remain present and active.

This signature points to a refusal before application tool execution; it does not establish an OpenAI search outage, a quota problem or the exact generated arguments. The historical content-free logs cannot recover those arguments. No provider request is replayed, journal entry created or business record altered during diagnosis. A separate light-dispatch timeout falls back to the completed expert reply and is not attributed as the web failure.

## Reproduced mismatch and bounded correction

The model-facing public-research query schema advertises maxLength 1600, while a local refinement enforces 400. Express the existing 400-character limit as a native max constraint so the generated tool definition and local validator agree. Retain the same local accepted inputs, purpose enum and privacy screens. No broader query permission, automatic repair, retry, model/configuration/budget change or extra generation request is introduced.

The installed SDK can return invalid-input or unknown-tool results before executeRead runs. Its completed reply consequently leaves readFailures empty even though a tool was refused. Reuse the existing onStepEnd observer and END event to count fixed INVALID_INPUT/UNKNOWN_TOOL categories separately in optional toolCallFailures. Do not log arguments, validation prose/paths or unknown tool names. Healthy events omit the field. Existing read budgets, failure recovery and generation outcomes do not depend on this new diagnostic counter.

Four selected assertions fail on the prior runtime: the advertised query bound and three pre-execution refusal observations. The real SDK loop with controlled provider transport reproduces an invalid call, no public-research callback and a normally completed final answer. The correction preserves that behavior while making the rejection visible. This is a reproduction of the failure pathway, not proof that the owner's original query exceeded 400 characters.

## Verification and delivery

268 tests in three suites pass, zero skipped: complete AI provider suite, web adapter and public research evidence contracts. Privacy-screen refusal still prevents tool execution, unknown names and private test input never enter usage logs, and the healthy public-research loop exposes maxLength 400 and retains cited evidence. Workspace types, changed-file lint/format and both exact-head checks remain required before merge.

API-only delivery is compatible with owner-accepted build44; the separate PR486 native diagnostic update remains pending a grouped binary. No live paid synthetic model request is made. After deployment, ask the owner to resend the same question in the same discussion. Inspect the new message's reservation/result and content-free counters to qualify actual web success or classify a remaining failure. Keep this owner acceptance open until observed; do not claim the original cause or live resolution from mocked tests. Existing M8/Atlas reserves remain unchanged.
