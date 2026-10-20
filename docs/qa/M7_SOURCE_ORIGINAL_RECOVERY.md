# Source original recovery — L8/M7 documents

Status: native actions and recovery implemented on branch; not released or accepted on a device. The grouped native acceptance below remains open. Transport, merged code and device acceptance are separate gates.

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
- `apps/mobile/src/documents/source-original-files.test.ts`: bounded stream, moved final file retained, immutable bytes, corruption/expiry/interruption, ordered multi-view originals and iOS container relocation. Hashes are incremental (1 MiB file reads); department-photo decoding enforces the existing 36-megapixel limit. Native file/fetch/image ports are simulated; these tests do not prove OS permissions or real-device memory use.
- `apps/mobile/src/documents/source-original-transfer.test.ts`: real SQLite missing-cache recovery, offline worker restart, stable file IDs, pending-original preservation, scope changes before/after asynchronous reads, source withdrawal, retained-file/reference races, cancellation with transport abort, rollback, durable dedup/backoff and owner-filtered pending work.
- `apps/api/test/source-original-recovery.integration.test.ts`: real local Mongo plus two persistent SQLite stores. Device A captures the original through the source repository; the upload service confirms it; device B recovers its exact bytes, restarts and rereads offline. Blob/private HTTP and native file transport are test ports; no remote provider call or spending occurs. Existing source-upload queue behavior is covered separately by its native tests.

## Native actions and source arrival

- One common original-file action is used by commercial PDFs, Mercalys review/publication, receipt photos/bundles and supported conversational attachments. Existing analysis, publication and correction workflows remain separate. Existing local originals work offline before upload.
- Opening a retained original verifies its bytes and rechecks the current account, source and retained-file binding after asynchronous reads. The obsolete department-photo reader was removed after its ownership/withdrawal/pixel guards were ported to this common path.
- Missing originals create an explicit durable request with French pending/offline/retry/cancel states. Screens initially read SQLite metadata only. Account changes or leaving a screen clear its visible private proof.
- A sheet preserves the underlying list location. Ordered receipt views are shown one at a time; each view and the complete immutable source can be passed to the native share sheet. PDF/XLSX use a compatible external application. `expo-sharing` matches the current Expo 57 SDK and is loaded only after confirming native availability; old binaries show a targeted message instead of throwing for a missing module.
- Normal business pulls can attach an already verified cache file when its source/receipt later arrives. Scope, metadata hash, immutable attributes and pending-local-original guards are checked; no publication, versions or user corrections are synthesized.

## Current local evidence

- 136 targeted tests passed / 2 skipped across 12 files after the common-reader guards. The prior core checkpoint ran the complete suite with disposable real Mongo: 2,966 passed / 6 skipped. The prior result is not a claim about the final PR head; final CI must exercise the Mongo integration again.
- `mercalys-publication-sync.test.ts` and `waste-receipt-publication.test.ts` cover later business metadata arrival, corrupt/cross-account/contradictory cache rejection and retained pending originals through the actual pull handlers.
- Native-web presentation at 390 × 844 used synthetic states, actual common actions and simulated callbacks: offline/pending/cancel/retry/error, PDF sheet, ordered views, share callbacks, bounds and visible close. Returning from the lower-list original preserved scrollTop 860.5 and focus on the invoking control. No horizontal overflow or console errors/warnings were observed. Screenshots and fixture source are retained outside the application in the task artifacts.
- The web mouse drag was inconclusive for native swipe-to-close; no gesture acceptance is inferred. Web callbacks do not prove native sharing or PDF/XLSX application availability. Temporary QA routes were removed before native export.

- Final local lint, formatting, ten-project typecheck, API build/import and Hermes iOS/Android exports pass on the current code. No environment file, provider call or EAS build was needed.

## Remaining delivery/acceptance gates

1. Exact-final-head push and PR CI must both pass before merge, including the real Mongo integration. API deployment and native rollout are separate grouped steps.
2. Grouped iPhone/Android acceptance: gallery/HEIC, genuine private Blob GET, first/second device originals, PDF/XLSX opening/sharing, receipt view order, native sheet gesture/visible close, account switches, app termination/restart, network loss, expired authorization and app-container relocation.
3. Exercise native storage exhaustion, uncertain commits, large-file/photo memory, accessibility and permissions through the real UI. Simulated I/O failures and local web presentation alone do not close these gates.

No source publication, extraction, reanalysis, provider call or EAS build is caused by this recovery action. Resend receiving and the rest of the full V1/M8 acceptance remain open.
