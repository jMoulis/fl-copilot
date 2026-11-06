# M8 — bounded Copilot dispatch and conversation titles, 6 November 2026

## Owner scope

After accepting build38, the owner prioritizes token consumption, authorizes a cheaper route for simple questions and automatic chat names. Preserve expert analysis, manual names, ordinary conflicts and the current local-first chat. No new entity, collection, dependency or API key. No synthetic paid AI requests.

## Actual consumption baseline

A read-only runtime sample contains 20 complete question traces and 55 model steps: 752,138 input tokens, 14,599 output tokens, including 368,025 cached input tokens and 1,679 reasoning tokens. Cached/reasoning values are subsets, not additional tokens. This is a limited runtime sample, not billing or an exhaustive account report. All observed steps used the expert model. Private numerical evidence is retained outside Git, without business message text.

## Implementation

The existing remote adapter accepts a new client capability, `x-copilot-economy: 1`; build38 keeps its existing path. One Responses structured-output call on configurable `COPILOT_AI_LIGHT_MODEL` (default `gpt-6-luna`) receives only the current title, four bounded history excerpts, the bounded question and document/form/truncation flags. It has no tools, catalogue, PDF or KPI evidence, no automatic retry, a four-second deadline and a 512-output-token ceiling. Simple/high-confidence output is the final answer from that same call; ambiguous, store-specific, analytical, action or strategic questions retain the existing expert adapter and tools. Attachments, forms, linked or oversized questions cannot use the light answer; numerical/source-like light answers fall back. Failure proceeds once to the expert. `COPILOT_AI_ROUTING_ENABLED=false` disables the increment without a binary rebuild.

The same call can propose a title. After the response commits, existing server lifetime support owns a separate canonical metadata transaction. A title failure cannot fail the saved answer. Authorization, active conversation, persisted owned reply, expected title, deletion and stable reply identity are rechecked. Existing conversation history and change stream retain provenance; public entity shape remains compatible with older clients. Manual and legacy custom titles are protected. No separate title-model call or synthetic user command is created.

On iPhone, a pencil in the existing conversation list opens a native prefilled rename prompt. Rename writes SQLite and Outbox atomically, survives offline, and synchronizes via existing APIs. The command-only `titleIntent: MANUAL` never enters the public entity. Manual rename may supersede only intervening automatic title versions; archive/deletion and other manual edits retain explicit conflict handling. Handoff and conflict review normalize the same command intent; explicit conflict resolution retains manual ownership. Cancellation and owner/focus changes prevent stale writes. The menu triggers the existing text-only chat synchronization, without a new polling loop.

Usage emits content-free STEP/END traces with a child request ID, `purpose: DISPATCH` and the original parent ID. Count STEP token values only; do not add END traces or count the simple response metadata a second time. Unknown usage stays null/incomplete. Expert questions now have a bounded routing overhead; savings must be measured across actual traffic, including failures and cached expert inputs.

Official model/structured-output capabilities: https://developers.openai.com/api/docs/models/gpt-6-luna . Caching and input-token economics: https://developers.openai.com/api/docs/guides/prompt-caching . Account access to this model has not been verified with a paid request; an unavailable model falls back to the expert.

## Validation and boundaries

- **414 tests across eleven files pass, zero skips**, including disposable transactional Mongo, real SQLite sync, legacy history, provider/response, canonical handoff, notification lifetime, native menu/controller and client transport. No real model request.
- Offline manual rename v2 over automatic remote v2 converges to canonical v3 with acknowledged Outbox and persistent manual lock. A stale rename carrying archive/deletion remains a conflict. Private owner/store, revoked access, deleted/archived conversations, duplicate replay, title failure and delayed title completion are covered.
- Full CI initially identified an old ACK fixture echoing a command-only field and an incorrect rename cancellation label on deletion. The fixture now models the canonical public ACK, and deletion retains its existing cancellation code. The focused follow-up passes **78 tests across four files**, including offline conflict restart and deletion rollback. The menu also rereads SQLite after its existing chat pull completes, so a deferred title is visible without waiting for a broader sync.
- Strict typecheck passes in all ten projects; targeted lint passes. API build/import and iOS Hermes export were successful; final delivery identities are recorded separately.
- Mac is locked and the supported automatic unlock failed. Native prompt appearance, keyboard/cancel and owner-phone routing/title acceptance are not claimed. Existing build38 notification acceptance stays closed.

## Delivery and remaining recipe

Code verified locally; merge, API deployment, native build identity and owner acceptance must be recorded explicitly before claiming delivery. Preserve API dpl_GwXJpXgZYMou4yrxgAbBw6bgpvf3 and build38 as predecessors. Deploy the compatible API before installing the new binary: the prior API does not accept manual-intent commands.

Focused owner recipe on the delivered binary: open a new chat and exchange a simple message; ask a normal analytical question and verify the answer still uses the store data; reopen conversations and inspect the generated name; rename using the pencil (including offline), reconnect and continue the exchange, checking that the chosen name stays. Cancel a rename once. No need to repeat accepted notification tests.

T09 remains open for actual token/quality/latency measurement and broader consumption qualification. This feature does not close M8 or the deferred cloud restore.

## Build39 owner test — title missing, 6 November

The owner reports only the title is missing. Production traces at 12:16:20 and 12:18:49 UTC show DISPATCH FAILED before any successful model step (893 ms / 284 ms), so expert fallback explains the arriving answers; this does not prove successful light routing or token savings. No automatic title was proposed. Current traces do not identify the provider refusal. Read-only model-access preflight through the authorized Vercel environment runner cannot inspect the production secret (secret values are deliberately not exportable); no secret was extracted, no environment changed and no paid synthetic request was made.

Add a content-free failure classification to the existing END log: provider HTTP status and only allowlisted error codes/parameter names, or TIMEOUT/INVALID_OUTPUT/OTHER. Never log provider bodies, messages, headers, credentials or prompt. Existing single expert fallback and title/manual-sync paths remain unchanged. **270 tests across two files pass, zero skips**, including five provider failure/privacy cases; API typecheck and targeted lint pass. This is a diagnostic increment, not a confirmed repair of the underlying refusal. It requires API delivery and an ordinary owner exchange before the precise provider cause can be established; build39 remains usable.

## Provider refusal identified — structural wire schema correction, 6 November

After explicitly authorized diagnostic deployment PR460 (`6ad8137`, dpl_2fJguFcja73DCJnX1oRrTUk6zPBV), the owner's normal exchange at 13:50:31 UTC returns HTTP400 / `invalid_json_schema` / `text.format.schema` in 799 ms, before a successful model step. This establishes a provider schema refusal; it does not establish an account-access failure or identify the individual rejected keyword.

The bounded dispatcher now sends only the required object fields, enums and nullable strings as its strict remote schema. Retain the existing local schema to trim and validate answer/title lengths and Unicode control characters before accepting any answer/title. No model switch, second title call, business writer, native change or new retry. The existing output ceiling and deadline stay unchanged. Prompt text states the same answer/title length limits. A rejected local output uses the expert fallback, reports INVALID_OUTPUT and still records the returned step/known tokens accurately; it never counts as successful routing or invents zero usage.

**304 tests across three files pass, zero skips**, plus API strict typecheck, targeted lint and formatting. A controlled provider rejecting the former constraint-bearing wire schema reproduces expert fallback before the correction and accepts the required structural subset afterward. This is a boundary regression, not an emulator of OpenAI's complete validator. Six local-invalid title/answer cases preserve rejection; an accented valid title is trimmed and retained. No paid synthetic model request. Official subset requirements: https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses .

Delivery, actual provider acceptance, title synchronization on build39 and measured token savings remain separate gates. The owner can retain build39; this is API-only. Preserve the diagnostic release for rollback.
