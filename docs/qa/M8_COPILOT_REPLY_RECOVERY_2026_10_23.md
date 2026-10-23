# Copilot reply delivery and late reception — 23 October 2026

## Owner symptom and boundaries

The owner frequently sees “La réponse n’a pas pu être reçue. Votre question est conservée.”, then receives the AI answer seconds later. Story: local question and stable pending reply IDs → canonical synchronization → authenticated NDJSON response → verified durable SQLite reply → chat rendering. The exact production conversation/HTTP failure was not inspected: no Mongo connection is active. The screenshot proves the visible symptom, not a particular network/provider outage.

## Reproduced defects

1. A valid complete final result frame followed only by a native transport-close failure is rejected while waiting for EOF. The API client still has enough information to validate the full answer and its store/owner/question/conversation scope.
2. A delivery error is retained in the same UI state as draft/local errors. A later background history update does not reconcile it with the now-received answer.
3. Canonical chat pull saves the assistant message but does not settle the exact pending-turn receipt. The UI can remain QUEUED after the answer is present. The original tests reproduce two failures; a further actual-pull test separately reproduces QUEUED rather than IDLE.

## Changes

- Accept a completed final NDJSON frame if only a subsequent reader close fails and no trailing fragment remains. Keep result/schema/scope validation, size/framing guards and cancellation. Partial replies, foreign results and trailing data are still rejected.
- Correlate local delivery errors with the immutable question/reply/conversation IDs. Keep draft/history/attachment errors separate. Display a delivery error only while that exact pending turn remains unresolved; another answer cannot clear it.
- The canonical pull settles only a matching pending assistant receipt, with matching store/owner/conversation/question and a dated USER parent. No source, KPI, business action or Outbox identity changes. Direct reception retains its stricter validation and avoids a redundant APPLIED write.
- After a recoverable reception failure, run the existing synchronization once and check for the exact durable reply. Do not POST the question again. If work was observed before an interrupted connection, or the server explicitly reports TURN_PENDING, leave the question queued with its existing resume action. Do not claim the server is still generating. Explicit server-stream errors, authentication, malformed/scoped/oversized data and other hard failures retain their error behavior. Manual resume uses the same persisted IDs.
- No new timer, polling service, agent, prompt, API endpoint, migration or provider setting.

## Verification

53 targeted tests across three files pass, including 19 new tests. They use the mounted production panel/controller/delivery/repository with real in-memory SQLite and simulated network ports, plus the actual API stream decoder. Cases include final-close failure, partial/foreign/trailing frames, cancellation, a background pull receipt, one recovery pull/no second AI request, server-pending/interrupted progress, hard errors, unrelated/wrong-parent/older replies, preservation of a failed draft save, explicit removal and a newly sent question after an earlier successful answer. Existing restart/cancellation/idempotency and private history tests remain included.

Full local structure/lint/strict type checks and tests pass (3,172 passed, 623 environment-gated skips), with iOS/Android exports and formatting checked separately. Both exact-head push and PR checks must pass before merge. Native Expo transport/gesture and the owner's exact chat remain acceptance limits; a simulated failure is not a claim that every real provider/network incident has been diagnosed. No live AI request or production mutation is performed.

## Grouped delivery and acceptance

Group with PR 321 icons and PR 322 old Mercalys file consultation in one substantial native acceptance release. No API redeployment is needed. Install over the existing app. Ask a representative analytical question; a final answer must not coexist with its old delivery warning or “Questions conservées…” status. Interrupted in-progress delivery keeps the question, and resuming must not duplicate it. Verify the old Mercalys lot after the app-container update and the app icon/launch screen. A finished binary is availability; only owner feedback proves physical acceptance.

M7 workstream 7 and M8 remain in progress. Overall states stay 1/3/4/5/6/7 in progress; 2 code ready. No full V1 acceptance follows from these checks.
