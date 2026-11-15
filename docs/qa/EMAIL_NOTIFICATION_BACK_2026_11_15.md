# Email notification entry — usable Back without a previous screen

## Cause and focused fix

An email-ready notification targets the existing root `/email-inbox` route. When
the app starts with no tab container, the existing notification `dismissTo`
replaces the root entry; the SDK stack then contains only `email-inbox`.
The screen's unconditional `router.back()` is unhandled in this state, leaving
the manager trapped on the received-documents page.

Reuse the existing screen's close callback in both normal and unavailable-access
views. If history exists, use Back to preserve the caller and its state. Otherwise
replace the isolated inbox with `/(tabs)/actions` (Imports), or isolated email
configuration with `/settings`. No extra tab container, route flag, navigation
manager, notification payload, receiver, authorization, sync or import writer is
introduced. A configuration opened from the inbox still returns through the
inbox before using its cold-entry fallback.

## Verification

- Before the fix, the new screen tests reproduce four failures (cold entry,
  unavailable access, the configuration/inbox chain and direct configuration),
  while three existing-history paths already work.
- After the fix, **45 tests pass across three suites**: seven screen-return cases,
  two existing inbox-refresh/configuration cases and 36 notification-provider
  cases. Tests exercise the actual StackRouter from the pinned Expo SDK.
- Notification regressions include cold root replacement, an already-open inbox,
  a duplicate tap and receipt ID refresh. Existing owner/store/role rejection
  remains covered; entry does not start synchronization or document processing.
- Scoped lint, formatting and strict mobile typecheck pass.
- Actual native reproduction uses the authenticated iPhone 17 Pro simulator and
  a cold Expo URL to `/email-inbox`, not a manufactured APNs receipt. Before the
  fix, a hittable Back button leaves the one-route inbox unchanged. After the fix,
  the same route exits to Imports. Warm Imports → inbox → Back restores a
  pixel-identical Imports capture (SHA-256
  `eea159ed4e926e7b520384ce88e1c3523ac2eb10f9bf9f2a8eae1a17a36e78a8`).
  Final native state has one tab container, Imports selected, and no email route
  stacked above it. No email, APNs push or business mutation was generated.

Private native evidence is retained outside this repository in workspace
`maintenance/email-notification-back-2026-11-15/`. The exact notification-opening
decision is covered by the provider tests; a physical notification tap on the new
binary remains a distinct owner acceptance step.

## Delivery boundary

This is a native-only runtime correction after build 62. It requires a new iPhone
binary; no API deployment or data migration is needed. Exact-head push/PR checks,
merge, build identity and TestFlight availability are recorded separately from
physical iPhone acceptance. The prior build 62 remains the rollback reference.
