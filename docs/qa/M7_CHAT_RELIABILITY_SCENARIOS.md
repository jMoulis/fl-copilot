# M7 — chat reliability incident gate

Active workstream: **7**. Status: code verification, not incident resolution.

## Observed incident

The pilot's latest conversation requested November 2024/2025 sales analysis. Three attempts returned a generic outage response and unrelated October daily facts. A later answer retrieved both requested months. Historical fallback causes were discarded, so timeout, provider output and grounding failure cannot be distinguished retrospectively. Vercel production was still the 17 October delivery when inspected. No claim is made that PR 260 already improved this production conversation.

## Automated checks

- Simulate timeout, rate limit, configuration and invalid/limited output separately. Record one safe server event with exact known code, generation phase, elapsed time and retryability. Call the provider only once.
- Emit partial prose, then return an unsupported figure. Grounding fails closed, records a grounding event and commits a safe final response; it never saves the invalid number.
- A requested historical period or an attachment-only question must not fall back to an unrelated latest-day balance. A no-question deterministic brief and a valid AI answer keep their existing canonical number rendering.
- Both ordinary HTTP and streaming route observers write safe attributes directly to the server logger even when Sentry is disabled, and send synthetic Sentry errors when configured. Raw provider error, private question, source contents and financial values are absent. An unexpected error after the stream opens is observable; expected cancellation is not a failure alert.
- A broken diagnostics sink cannot prevent a safe fallback. Cancellation and programming errors are not reclassified as a known provider fallback.
- On a disposable real transactional Mongo database, save one fallback reply, retain its parent and business observations, replay the same reply ID without another generation/event, and do not create a successful fact context for the failed generation.

## Server delivery and real pilot gate — still pending

1. Verify the exact deployed API SHA and compatibility/migrations before releasing. Merge alone changes neither the API nor the phone.
2. Ask for November 2024 versus November 2025 sales analysis in the existing private conversation. Do not re-import data merely because generation failed.
3. On failure, correlate the generation/HTTP request IDs and deployment in server logs with the sanitized Sentry issue code. Distinguish provider timeout, rate/configuration/output failure, grounding rejection and unexpected streamed failure before changing budgets or validation.
4. Apply a fix justified by that cause, then obtain a useful sourced comparison with coverage qualification and no unrelated October substitution. Check a simple follow-up and cancellation too.
5. Only then close the incident. Tests with mocked model transport do not establish real-model reliability or business quality. This server-only fix requires no paid EAS build; pending native features have their own grouped acceptance.

Current access limitation: connector reads of Vercel logs failed with 403; CLI Sentry read was not executed because automatic approval review could not complete (service capacity), not because the request was judged unsafe. No bypass or credential change was attempted.

Subsequent read-only checks: existing cached Vercel CLI credentials allowed reading request logs without installation or persistent configuration changes. The failed chat request took about 61.4 seconds and the following successful one about 20.5 seconds; both returned HTTP 200 and both carried a `MaxListenersExceededWarning` on `close` listeners. That warning alone does not identify the failure cause. Neither request logged a generation/grounding reason. A direct current canonical sales/margin period read on authorized pilot data completed in 308 ms, with 20 of 30 days available in each November. This is a partial usable comparison and a point-in-time reader check, not a full production-model test.

CI also exercises the real authenticated Mongo HTTP outage fixture. Its old assertion explicitly expected the unrelated daily snapshot; it now checks the safe chat response while retaining history, ownership, exactly-once persistence and retry assertions. The no-question deterministic brief has its own unchanged-behaviour check.
