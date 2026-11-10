# M8 T06/T10 — safe, non-blocking API error diagnostics, 10 November 2026

## Audited gaps

The API attached its generated requestId as Sentry extra data, then removed all extras in beforeSend. Its error response/log reference was consequently absent from the sanitized exception event. The existing privacy configuration removed request/user/source extras but retained thrown exception/cause messages and attached frame payloads. Logging, capture, initialization and flush failures could also escape the optional monitoring adapter: an actual Fastify fixture shows the monitoring exception replacing the normal API error response.

Eight new tests fail against the prior adapter; the unconfigured-channel control still passes. These use a mocked SDK/transport and disposable injected API ports. No production exception, new Sentry account, real message or live provider event is generated.

## Reuse and technical boundary

Keep the existing Sentry SDK, init options, logger/capture functions and API error DTO. Store the server-generated UUID as a bounded request_id tag, retain fixed technical code/method/reason fields, and classify only technical error categories. Fastify already disables client-supplied request IDs and generates UUIDs; a real injected HTTP case confirms a supplied header cannot replace the response reference and the captured tag matches that response.

The existing beforeSend callback now also replaces exception/cause prose with a technical code, removes mechanism data, frame variables/source context, arbitrary tags, identity/request/extra fields and breadcrumb payloads, while preserving known error classes and technical stack locations. Original Error objects are not rewritten. This qualifies the application's collected error-event boundary, not every possible third-party SDK integration or arbitrary future event field. Logger callsites still supply their existing safe technical attributes; their traffic/options are unchanged.

Guard optional SDK initialization, logging, scope/capture and rejected flushes. An initialization failure leaves capture inactive; a configured but uninitialized/rejected flush returns false. An unconfigured channel remains a no-op and has nothing to flush. Do not recursively report monitoring failures or add polling, retry services, another provider, a business writer, metrics traffic or AI requests. Preserve the original safe API error response and request reference even when monitoring is unavailable.

## Verification and limits

73 tests in six suites pass, none skipped: actual initialized hook invocation with controlled error/cause/event fields; normal and failing SDK Fastify responses; initialization/log/scope/capture/flush failures; unconfigured behavior; existing fixed Copilot classifications/fallback reporting; all API route/config checks; existing native sanitization/local diagnostic categories. Workspace types (10 projects), lint/format and exact-head push/PR checks remain required before merge.

Delivery is API-only and remains compatible with accepted build44. Record deployment identity and non-mutating health/auth/refusal probes separately. Do not inject production failures or claim actual Sentry delivery from mocked transport tests. This does not complete the whole T10 dashboard, end-to-end monitoring acceptance or wider M8; Atlas backup rehearsal remains owner-deferred.
