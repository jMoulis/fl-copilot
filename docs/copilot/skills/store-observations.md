# Product Copilot skill contract — Store observations

Status: M6-T05 native capture/closure and synchronization implemented; conversational registration remains M7. This is an application skill contract, not a Codex agent-development skill.

The Copilot may prepare an observation only from an explicit user-reported store fact. A PDF market tension, recommendation, forecast or missing sales row is not an observed stockout. Do not fabricate stock quantity, lost sales, purchase cost, event severity or a causal effect. Preserve USER observation vs commercial instruction vs interpretation.

`createStoreEventPayloadSchema` accepts a stable ID, exact store product identity, one of six types, declared start/end, optional severity/note and capture timestamp. The trusted executor owns authenticated store/device, UUIDs, clock and human authorization; models cannot select managed store/source/version fields. `prepareStoreProductEvent` constructs a USER record with a nullable severity, immutable capture and no inferred quantity. The native `StoreProductEventRepository.create` commits capture/history/Outbox atomically.

Closure is an explicit decision with endedAt, validated after the start and not after the human capture time. `closeStoreProductEvent` and `StoreProductEventRepository.close` preserve birth/source/identity; they do not reopen an incident or change KPIs. The server checks the scoped parent, optimistic version and idempotence. Differing end times require the manager to compare and resolve; never select a version merely because an LLM prefers it.

The future chat executor must bind confirmation to the displayed product/type/interval and current event ID/version. Report captured locally, pending sync, confirmed remote, closed or conflict separately. Source instructions can support a proposed discussion, never an unconfirmed actual store incident. Evidence generation and learned score updates belong to the deterministic remote M6-T06/T07 workflow, not this tool. Native forms remain optional inspection/correction and a quick field-capture path.
