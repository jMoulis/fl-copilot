# M8 — background chat dispatch, 6 November 2026

## Report and diagnosis

Build35 is **not device accepted** for background completion. The owner reports that leaving the app prevents the answer from completing.

Read-only production investigation found approximately 260 device push-token registration requests in thirty minutes. The actual Expo SDK emits a native token event when `getDevicePushTokenAsync()` registers; requesting an Expo token without supplying the native token can therefore retrigger the provider's listener. The former mock did not model this SDK behavior. Four mounted cases fail against the original provider (three registrations instead of one in the initial-event case).

The latest inspected user question was present in synchronized history but had no turn lease or model-usage event. Its dispatch had not started. The native delivery awaited the entire synchronization pipeline, including unrelated originals, visual jobs and local calculations, before requesting generation; it also awaited that pipeline after persisting a received answer. This explains a path where suspension delays dispatch/completion; it does not prove a server-side generation lifetime failure.

## Correction

- Cache the native push token in the existing provider. Supply it explicitly to Expo conversion. Cache listener events, ignore unchanged tokens, and do not queue another registration from an event emitted by the provider's own native read. Genuine rollover reuses the new token without another native registration.
- Expose the existing `MobileSyncService.sync` through the sync provider for text-message dispatch. It retains canonical Outbox, owner/store checks and network-cycle serialization. No new writer, collection, job or retry loop.
- Validate the locally scoped parent before choosing dispatch. Questions with attachments keep the complete preparation pipeline. Plain questions await only canonical push/pull; answer recovery/final reconciliation also avoid unrelated file jobs. Re-read the synchronized parent and retain existing deletion, cancellation and idempotency checks before the AI request.
- Opening an uncached chat notification uses the same canonical push/pull rather than waiting for file jobs. Cached replies still open immediately; commercial reminders retain their existing workflow.
- Existing foreground/background notification consent and server registration authorization remain in effect.

## Verification

114 targeted tests across eleven suites pass, zero skips: mounted token event/rollover/background/100-rerender cases, registration, SQLite chat delivery/history, canonical sync service and full-pipeline coalescing. The SQLite delivery regression holds an unrelated full pipeline unresolved: a text question reaches `ask`, persists its reply and finishes; an attached question waits until preparation is released. Workspace typecheck passes all ten projects; targeted ESLint passes with zero warnings. iOS production export succeeds.

This is host automated evidence. No paid model request or artificial production message was sent. Production API is unchanged; the correction requires a new mobile binary. Physical iPhone background delivery/tap/reopening remain the owner acceptance gate after delivery. A finished or correctly signed binary alone does not prove APNs delivery.
