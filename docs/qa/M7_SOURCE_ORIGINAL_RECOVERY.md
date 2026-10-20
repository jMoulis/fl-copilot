# Source original recovery — L8/M7 documents

Status: implementation branch, not released or accepted on a device. This lot remains open until the existing source screens expose restoration and the native acceptance below is completed. It must not be represented as completed by the transport contracts alone.

## Implemented technical path

- Authenticated manifest and short private Blob GET authorization, with the immutable source ID and current store/user resolved by the API. Confirmed source, upload, canonical storage key, size, MIME and Blob version agree before signing; authorization and source availability are rechecked afterward.
- Authorized store users can recover business originals. Department photos retain uploader-only access. No model argument chooses a user, store, URL or storage path; the transport capability is not persisted.
- SQLite migration 51 adds a per-requesting-account original cache and an owner/source-unique durable transfer job. This cache is independent of business source synchronization: a missing local business document is not fabricated from original-file metadata.
- An explicit request survives restart and has scoped visibility, a lease, backoff, cancellation and an explicit failed-job retry. The existing synchronization runtime runs it after metadata synchronization; it is not a new background service.
- The native adapter streams into a private disposable file, enforces the expected byte ceiling, validates SHA-256 and file type, then moves the verified file without overwriting an original. Receipt bundles preserve and verify ordered original photo views, not a rendered reconstruction.
- File/manifest references commit in one SQLite transaction after a fresh authenticated manifest check. Existing source identity, publication/parsing state, versions, receipt edits and Outbox remain unchanged. Unsynchronized originals are never replaced. Rollback retains existing references and immutable downloaded bytes.

## Automated evidence

- `packages/sync-contracts/src/source-original.test.ts`: immutable channel/visibility/size contracts and private download URL shape.
- `apps/api/test/source-original-service.test.ts`: five channels, upload/source/Blob contradiction, withdrawal, private photo ownership and authorization revoked during signing.
- `apps/api/test/source-original-routes.test.ts`: authenticated source-ID routes, current membership, no-store capabilities.
- `packages/api-client/src/source-original.test.ts`: authenticated store-scoped typed manifest/download requests.
- `apps/mobile/src/documents/source-original-files.test.ts`: bounded stream, moved final file retained, immutable bytes, corruption/expiry/interruption, ordered multi-view originals and iOS container relocation. Native file/fetch/crypto ports are simulated; these tests do not prove OS permissions or real-device memory use.
- `apps/mobile/src/documents/source-original-transfer.test.ts`: real SQLite missing-cache recovery, offline worker restart, stable file IDs, pending-original preservation, scope changes, cancellation, rollback, durable dedup/backoff and owner-filtered pending work.
- `apps/api/test/source-original-recovery.integration.test.ts`: real local Mongo plus two persistent SQLite stores. Device A captures the original through the source repository; the upload service confirms it; device B recovers its exact bytes, restarts and rereads offline. Blob/private HTTP and native file transport are test ports; no remote provider call or spending occurs. Existing source-upload queue behavior is covered separately by its native tests.

## Remaining before PR/release

1. Finish native source actions and clear status/retry/cancel states for commercial PDFs, Mercalys originals, receipt photos/bundles and private conversational photos. Preserve the current screen/list position and source workflows.
2. Confirm restoration when source business metadata is absent, then later arrives through normal business synchronization. Do not create fake publication or analysis state merely to display the original.
3. Check account changes while a screen or file request is open; a private photo must not leak through a generic source list or cached UI.
4. Verify source-withdrawal and contradictory grouped-photo metadata, local reference races, storage exhaustion and uncertain commits through the final UI path.
5. Run final lint/types/tests, API bundle import and local native exports. Final-head push and PR CI must both pass before merge. API deployment and native rollout are separate grouped steps.
6. Grouped iPhone/Android acceptance: gallery/HEIC, genuine private Blob GET, first/second device originals, PDF/XLSX opening or sharing, ordered receipt views, app termination/restart, loss of network, expired capability, app-container relocation, large-file memory and screen-reader states.

No source publication, extraction, reanalysis, provider call or EAS build is caused by this recovery action. Resend receiving, other L8 recovery paths and the rest of the full V1/M8 acceptance remain open.
