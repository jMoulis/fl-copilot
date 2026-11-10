# M8 T06/T10 — non-blocking private mobile error diagnostics, 10 November 2026

## Reproduced gaps

The root layout initializes Sentry before rendering. A synchronous initialization failure previously escaped this call. Screen error recovery and commercial-review callbacks likewise called scope/capture without isolation; SDK failure could replace the original screen recovery error. The manual monitoring check could reject without a handled result or claim a flush when no provider was configured. The existing local publication reporter already isolates SDK failures and deduplicates fixed phase/category reports; retain those guarantees.

The existing mobile beforeSend removed identity, extras and breadcrumb text, but retained exception/cause prose, mechanism data, arbitrary tags and frame variables. Those fields can contain paths, SQL or source/product values. Ten cases fail against the prior runtime; two controls pass. Tests use only mocked SDK methods/events, never a real Sentry event or production error.

## Existing adapter, unchanged business workflows

Keep the current SDK, wrapper, environment, collection/sampling options and startup callsite. Attempt initialization once; enable application capture only after successful initialization. Isolate initialization, screen scope/tag/capture and the existing manual test. Return false for an unavailable provider or failed manual check. Do not retry, log monitoring failures recursively, add listeners, change transactions or delete pending work. Local publication reporting retains its fixed diagnostic messages and 30-second deduplication.

Extend the existing event sanitizer: derive a fixed category through the existing local failure classifier, or use MOBILE_SCREEN_ERROR. Preserve only known local failure/phase and the two actual static screen routes. Replace all exception/cause message prose; retain known technical error types, stack filenames/line/column locations and breadcrumb timing/category. Remove mechanism data, frame variables/source context, arbitrary tags, identity/request/extra and server-name fields. The original Error and its stack remain unchanged at capture. This qualifies these application error-event fields, not an exhaustive audit of arbitrary third-party native contexts, logs or future integrations. Stack locations remain collected for diagnosis.

## Verification and delivery boundary

52 tests in six suites pass, zero skipped: optional init/scope/tag/capture/log/flush failure, unconfigured no-op, one-time initialization with the actual sanitizer callback, unchanged error identity and local deduplication, cause/frame sanitization and native SQLite category detection; existing mounted Mercalys review, commercial transcription and local analytics cases remain green. Workspace types, lint/format and both exact-head checks remain required before merging.

This is mobile-only. An API deployment cannot update build44; retain the owner-accepted Mercalys/logout/notification recipes as closed. Group this correction into the next meaningful native release rather than purchasing a build solely to provoke monitoring errors. Actual Sentry receipt is not established by mock transport or a flush result. Wider T06/T10/M8 and owner-deferred Atlas restoration remain open.
