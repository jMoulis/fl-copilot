# Notification settings resume — 15 November 2026

## Report and evidence

The owner reports that changing one of the first three notification switches
briefly disables the other two, and that switches can remain unavailable after
backgrounding and returning without terminating the app. A preceding read-only
production check found three recent email envelopes with retained READY originals
and no notification claim, and no currently registered push destination. This
locates that observation before dispatch; it does not prove why registration was
lost or that any specific native network request hung.

The first three channels intentionally share one authenticated Expo destination
and serialized registration writer. Their preferences are independent. Previously
the settings screen disabled all three for any channel change. Moreover, the
push-token PUT used the API client's unbounded request path: a suspended request
could keep the writer and foreground refresh waiting indefinitely.

## Correction

- Use the existing API request deadline (30 seconds) for push registration,
  covering response headers and body even when native fetch ignores abort.
- Identify the channel being changed and disable only its switch. Retain the
  existing serialized writer, consent defaults, pending-disable handling and
  owner/store/device/session retirement checks.
- Put the common error and verification button below the three channels and
  label it « Vérifier les alertes de ce téléphone ».

There is no new registration queue, retry service, provider, schema, notification
backfill or automatic opt-in. The existing foreground refresh remains responsible
for reconciling the saved choices. This mobile/API-client change requires a new
native binary; it does not require an API deployment.

## Verification

Two transport tests fail before the deadline change for a suspended fetch and
suspended JSON body. After correction they verify the timeout, abort signal,
timer cleanup and successful retry with unchanged authentication and channels.
The screen regression fails before the channel change because all three switches
are disabled. The controller regression verifies the affected channel, retained
choice and released busy state after failure.

A mounted provider consumer uses the actual API client with a suspended transport:
enable email, background, foreground, expire the request deadline, reconcile,
then change document/email preferences. It verifies usable settings, independent
final choices, registration payload, one state/token listener and no timers left.
Existing token rollover, session retirement, account replacement and independent
channel-disable coverage remain required.

Local verification: 200 tests pass in 26 notification, reminder, offline-logout
and API-client suites; strict mobile/API-client typechecking, changed-file lint
and formatting, and an iOS production export pass. Independent review found no
blocking issue.

Local automated checks, exact-head CI, merge, TestFlight availability and physical
iPhone acceptance are separate checkpoints. Expo Go cannot validate remote push
registration or APNs delivery; no live notification or email was sent by the agent.

## iPhone acceptance on the new build

1. Open notification settings and change email alerts. Only that switch may be
   temporarily disabled; the other two choices remain available.
2. Leave the app for the iPhone home screen, then return without force-quitting.
   Verify that the switches remain usable and saved choices are retained.
3. With email alerts enabled, send a new email to the existing store address and
   background the app. Check its reception notification and Back to Imports.

Do not resend existing attachments or treat old notification claims as permission
to replay historical alerts. Physical notification delivery is not inferred from
the automated tests.
