# M7 UX / M8 — PDF reading synchronization, 4 November 2026

## Observed failure

The native review finds Synchronisation in error with zero pending mutations, conflicts and failed commands. A normal retry gives the same result. A temporary, content-free local probe identifies HTTP 500 / INTERNAL_ERROR before the remote sync step completes. The trace is removed; it is not production instrumentation. Vercel request records independently identify GET `/api/v1/sync/pull` returning 500. No matching runtime trace or recent mobile Sentry event was available; absence of logs is not proof of a healthy service.

A read-only inspection of the existing simulator's sync cursor identifies the last applied sequence as 3417. The next seven changes are READY visual PDF readings. Store-scoped Mongo reads find each reading valid against its individual DTO. Reconstructing the complete sync envelope locally reproduces its rejection: a stored null `analysisRevision` normalizes to an own `undefined` property, which the canonical `z.json()` entity contract rejects. No document was skipped and no production cursor or row was edited during diagnosis.

## Correction

In the existing `serializeVisualReading`, omit the normalized absent revision from the fresh parsed DTO. Keep explicit positive revisions, status, source identity, reading and errors unchanged. The stored null remains untouched. The same serializer serves incremental pull and bootstrap. Do not loosen `z.json()`, convert absence to a revision number, discard whole readings, reset a client or advance its cursor manually.

This is API-only and backward compatible with build 32. The separate text accessibility correction is merged in PR 440 and remains grouped-native work; deploying this API does not deliver those mobile semantics to an existing binary.

## Evidence and release boundary

Three synthetic regression cases cover null, explicit undefined and a positive revision through the complete sync response contract. Null/undefined fail before the correction. The transactional Mongo visual workflow now persists null revisions, exercises capable/legacy pull and capable bootstrap, and validates their complete response contracts. With the existing pull test, **11 tests across three files pass, zero skips**. Seven read-only affected readings also validate through the corrected envelope without production mutation. Test providers/storage are controlled; no new paid generation test is used.

Exact-head push/PR checks, master identity, staged API health/authentication and promotion of the same artifact remain release gates. After delivery, rerun the existing simulator's normal sync: no database reset, data repair, artificial cursor bump or new PDF upload. A verified 200 and native success are required before claiming the incident resolved.

The existing incomplete-sync warning is not changed to conceal this error. Generic messaging with zero failed commands can be refined separately after the actual 500 is fixed. Owner-accepted M0–M6, PNG/chart/memory cases and closed workstreams 1/3/4/5 stay closed; this concrete reliability defect takes priority in workstream 7/M8. Numerical counter-promotion and measured implantation remain deferred.
