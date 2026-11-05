# M8-T11 — iPhone chat completion alerts

## Scope

Reuse Expo Notifications, the existing device-token endpoint contract, authenticated device sessions, the canonical chat transaction/history/sync and the existing notification settings/response listener. No new collection, SQLite migration, business Outbox, Inngest job, AI instruction or model call. The previous local-only entitlement-removal plugin is retired: a new signed iPhone binary is required.

The owner opts in on this phone under Notifications → Réponses du copilote. Preference is private, stored in SecureStore per owner/store/device. Permission is requested only by that explicit action. Foreground/token/session refresh reconciles registration; no polling. A failed disable is retained for retry. Serial registration prevents an earlier enable overwriting a later disable; stale contexts cannot register or navigate.

`PUT /api/v1/devices/{deviceId}/push-token` binds the token to the authorized live session and store. Token transfer clears its former session registration in the same Mongo transaction. A partial unique index on session push tokens fences concurrent token claims; Mongo error bodies, which may include a token, are replaced by a content-free retryable registration error. Refresh preserves registration; logout/re-login does not reactivate a previous registration. No credentials or chat text are logged/sent in the alert.

## Generation and delivery

An opt-in-capable client sends `x-copilot-background-completion: 1`. Only a valid registered session can detach from its stream. The same bounded generation promise is attached to the existing Vercel `waitUntil` lifecycle, preserving the current lease, stable reply ID, timeout, reauthorization and canonical transaction. No second generation or retry loop is added. Old/unregistered clients retain disconnect cancellation. Leaving the conversation stops the local transport; a registered server request can finish. Logical deletion/authority are still checked before commit and notification.

Only a newly persisted answer (`alreadyApplied: false`) can trigger a single best-effort Expo send. Delivery runs independently of the result stream and cannot convert a committed answer into an error. Provider failure is reported with an allowlisted code only. Known invalid tokens are retired. The payload contains only typed owner/store/conversation/reply IDs; the title/body are generic. Collapse ID is the stable reply ID, TTL one hour. Foreground chat alerts are suppressed by the existing handler; commercial reminders keep their behavior.

Opening an alert validates owner/store and local conversation/reply visibility. Cached data opens without a network wait; a missing result uses ordinary sync once and then checks SQLite again. Duplicate opening is ignored, and stale asynchronous navigation is fenced by context and revision. Missing/deleted/foreign results never create a conversation or trigger AI regeneration.

## Delivery limits and required acceptance

Expo acceptance of a ticket is not evidence of APNs/device delivery. Provider/network failure or process termination after commit and before send can lose this best-effort alert; the response remains in normal history/sync. There is no new durable push retry/receipt worker. An alert already queued externally cannot be recalled on logout, but contains no conversation content and cannot bypass ownership when opened. Vercel work remains bound by the existing function duration; this does not survive arbitrary platform termination.

Existing Apple Push key `JDCQ2F65LU` on owner team `54QQCYMGXT` was selected and assigned to the existing EAS staging/ad-hoc application `com.flcopilot.mobile`; no new key or provider subscription was created. Expo config introspection now includes the APNs entitlement. This is configuration evidence, not delivery or current Apple-key validity proof. Verify signed profile, finished binary and physical delivery separately.

After compatible API release and the new build: enable the chat alert; ask a normal question and background the app; verify one generic alert and opening the correct completed response. Then deny/disable notifications and confirm chat remains usable. Preserve build34's two already accepted tests; do not request them again. Documents' remote completion and physical notification acceptance remain T11 work, not closed by this increment.

Implementation references: [Expo push delivery and tickets](https://docs.expo.dev/push-notifications/sending-notifications/), [Expo physical setup and project identity](https://docs.expo.dev/push-notifications/push-notifications-setup/), [Vercel bounded waitUntil lifecycle](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package). These document the transport mechanisms, not acceptance of this app.

## Validation record and external gate

110 targeted tests across eleven files pass, zero skips: real transactional Mongo device registration/ownership/token transfer/unique-claim/refresh lifetime, real HTTP stream disconnection, scoped transport capability, actual SQLite destination visibility, mounted notification navigation/settings, serialized permission/registration and the existing auth-race/database suites. Ten-project strict typecheck, targeted ESLint, API build/import and mobile export pass; full exact-head CI and merge remain separate records.

Apple `credentials:configure-build --platform ios --profile staging` cannot validate or update the signing profile: Apple reports service error `-20209`, account locked for security reasons. Existing Keychain sign-in was attempted once; no password/code was inspected or changed, no repeated login or alternative Apple identity attempted. Owner notified and is handling account recovery. No new paid native build started. Assignment of the existing push key is retained, but this does not certify the Apple account, signing profile or delivery. Device Hub's AX tree was accessible but screenshot capture unavailable, so no new visual/native acceptance is claimed.

Two mounted-provider tests additionally verify no registration on background mount/token events, one reconciliation on foreground return, stable registration across 100 ordinary rerenders and complete listener cleanup. The background token-event case failed before its foreground guard was added. Aggregate validation is 108 tests in the prior ten-file run plus these two final component tests.

Native dispatch also requires the current local opt-in to be loaded and enabled, including when a remote token removal is still awaiting connectivity. Consent is read at dispatch through a stable ref, so loading/changing preferences does not recreate or cancel an in-flight delivery. Existing permission/failed-disable and true/false transport-capability tests qualify the two boundaries. An alert already queued for an earlier opted-in request remains subject to the delivery limits above.
