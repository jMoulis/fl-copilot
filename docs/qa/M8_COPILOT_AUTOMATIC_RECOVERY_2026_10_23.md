# Automatic continuation after a chat interruption — 23 October 2026

The owner still has to press Retry after the reply-receipt change in PR 323. That change reconciles a late durable reply, but deliberately performs only one recovery pull before returning WAITING or an error. It does not automatically continue reception. This is a reproduced code-path limitation, not proof of the exact production transport failure.

## Change and limits

The existing `CopilotTurnDelivery` now performs bounded automatic recovery within its existing per-conversation in-flight promise. A failed native transport or `COPILOT_TURN_PENDING` first looks for the exact committed answer through the existing authenticated private-history endpoint, then the local canonical records. If absent, it waits one second and checks again. It may then resume the same immutable question/reply request once. The existing API cached-answer check and scoped Mongo lease remain authoritative; no new reply identity, conversation, mutation authority or provider is introduced.

If the resumed request is also interrupted or the server still reports an active turn, reception checks continue with waits of 3, 8 and 18 seconds. There are at most two turn requests and six recovery reads, plus the original sync; 30 seconds is the sum of waits, not a wall-clock deadline on synchronization/network operations. Production wiring reads the latest 50 messages of this conversation and checks store, owner and conversation; waiting does not replay uploads, local calculations or source-processing jobs. The canonical `receiveCopilotReply` still checks the exact reply/parent/role/date and writes to SQLite; the ordinary change feed later supplies associated tool records. Internal callers without a history reader retain the canonical sync fallback. Recovery is sequential, stops as soon as the answer is received and is cancelled with the active conversation. A deleted/settled pending request or inactive conversation cannot be resubmitted. Partial streamed text is never committed as a final message.

Explicit server-stream failure, authentication, scope, malformed/oversized stream, quota and general provider/HTTP errors do not trigger automatic generation retries. Existing one-pull recovery and French error handling remain. Continued failure preserves the stable pending request for a later explicit retry. This is bounded foreground recovery, not an indefinite background agent. A transport retry may restart a generation that was cancelled remotely; do not claim that every network retry avoids provider work.

## Verification

Mounted chat/SQLite tests cover late arrival after the initial pull with one AI request; automatic same-ID continuation without pressing Retry; active-server response arriving during backoff; the recovery budget; real timer cancellation; removed pending requests; and no automatic retry for HTTP 429/500. Existing tests retain scope/date checks, provisional-text rejection, independent local errors, restart identity, queue order and explicit server failure. Record final local/CI results in the PR and verification artifact.

Native acceptance is pending a grouped release. No paid EAS build, application AI request, API deployment or production business-data mutation is part of this change.

## Requested private exchange

The owner authorized reading the 23 October 08:45 Europe/Paris exchange (06:45 UTC) to identify a possible missing AI tool. No private message was retrieved. The reconnected Atlas account reports that MCP access is disabled for every organization; enabling organization-level AI client access or supplying the exchange is required. Do not infer the missing tool from older screenshots or expand prompts speculatively.

An attempted CLI read-only diagnostic unexpectedly deployed the diagnostic script as a separate temporary Vercel project. That project was immediately deleted successfully. Production `fl-copilot` was not deployed or changed. The diagnostic did not obtain Mongo credentials or private chats. This accidental deployment is not verification of the application and must not be repeated.
