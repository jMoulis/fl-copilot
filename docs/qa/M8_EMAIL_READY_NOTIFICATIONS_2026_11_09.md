# M8 T11 — store email reception alerts, 9 November 2026

## Scope and semantics

One optional notification per store email after its complete attachment envelope reaches terminal preservation states. The success message says originals are retained and offers Actions → Documents par email; a terminal preservation failure offers the same inbox to examine the error. This is **not** a notification of completed PDF extraction, Mercalys publication or indicator recomputation. Pending downloads, including daily-budget deferral, do not trigger an alert. No confirmation, publication, business mutation or AI request follows from receiving/opening an alert.

Reuse the existing Expo transport, authenticated device-session registration, serialized native registration controller and notification response listener. The email switch defaults off, independently of chat consent. Preserve the original chat SecureStore key and its values; store the email preference separately. One channel's disable keeps the other channel's token registration. Pending disables survive offline failure and reconcile on foreground. No second provider, listener, notification collection, new queue or business schema migration.

## Authority, privacy and failure

The existing preservation transaction completes before the callback. Resolve the canonical store email namespace, active owning manager, current mailbox binding and complete receipt; never revive the removed chat reception flow. An internal optional `readyNotificationClaimedAt` on the existing receipt atomically prevents concurrent attachment workers and explicit retries from sending another alert. This field is absent from receipt DTOs, business versions and sync payloads. Old clients retain chat-only registration; only explicit `channels.email=true` authorizes the new typed payload. Missing channels keep legacy chat behavior.

Recheck membership, binding, receipt and exact live device session immediately before each dispatch. Logout, expiry, token transfer and channel disable retire delivery authority. Only owner/store/receipt UUIDs enter navigation data; no email subject/body, sender, filename, storage URL or financial content appears in the notification. An invalid Expo token is removed only if still registered to the same session/token. Opening an alert navigates to the current owned store inbox, not an arbitrary URL or automatic document action.

Delivery is best-effort with an atomic at-most-once attempt per receipt, not guaranteed notification delivery: a process interruption after claim may lose the alert. No push retries can cause repeated original processing. Provider rejection/failure is logged with a fixed redacted code and never changes retained originals or successful jobs. No historical backfill is run on opt-in. Existing receipt states remain the source of truth in Actions. Foreground banner behavior remains that of the current shared notification handler; this increment targets background delivery.

## Verification

Focused suite: **132 tests passed in ten suites, zero skipped**, using a disposable transactional local Mongo database and mocked Expo delivery. Covers concurrent terminal workers, pending envelope, terminal failure wording, existing chat opt-in, independent channel disable/retry, token retirement, current and late authority revocation, and preserved READY/DONE jobs after failed notification. A mounted inbox test also verifies notification-driven rereading, including a key arriving during an existing refresh, without remounting or losing unsaved input. Mounted native components cover the independent switch, owned Actions destination, response deduplication and foreign owner/store/role refusal. Existing chat/reminder lifecycle tests remain included.

Workspace typecheck, changed-file lint/format and iOS export are required before commit. Exact-head push and PR checks, merge, compatible API deployment, grouped native binary identity and physical iPhone acceptance remain separate delivery gates. No live email/push or paid AI test was sent.

## Device recipe after compatible API and binary delivery

1. In Notifications sur ce téléphone, enable Documents reçus par email. Keep the chat switch as desired.
2. Send one email with two supported attachments to the existing store address, then background the app. Expect one reception alert after both originals are retained; no per-attachment alerts.
3. Open it: Actions → Documents par email should show the files, still requiring the existing explicit business admission. Back should preserve normal navigation.
4. Disable email alerts and verify the already accepted chat alert remains usable. Rechecking/retrying an existing ready receipt should not generate another email alert.

Native delivery, provider acceptance and owner acceptance are not inferred from mocks. Full document-processing/import-completion coverage, broader T11 and M8, and the owner-deferred Atlas restore gate remain open.
