# Independent bottom-panel and backdrop motion — 16 November 2026

## Owner acceptance boundary

On build 69, the owner accepts the week/TG navigation, declaration details/close
and product identity tags. The whole-panel fade is rejected: the panel must slide
up/down while the stationary backdrop fades. Those accepted journeys remain the
reference and are not reopened as feature work.

## Scope and safeguards

The shared BottomSheet keeps one transparent native Modal with native animation
set to none. One native-driven progress value animates opacity on a full-viewport
stationary scrim and translateY on the measured panel. The scrim remains at the
approved 25% maximum tint. Keyboard avoidance affects the panel, not the scrim.
No new animation dependency or domain/data contract is introduced.

Close requests still go through the owner's existing handler. A refused dirty or
busy close cannot start the exit. An accepted visible=false retains the last
rendered title/content/footer, blocks outgoing controls and completes the slide
before hiding the native modal. On iOS, only the actual native onDismiss releases
queued actions. Interrupted animations cannot dismiss a reopened sheet or invoke
queues after unmount. Other platforms retain a completion fallback because the
native onDismiss event is iOS-only. Saved presentation nodes are released after
dismissal rather than kept indefinitely.

The editor owners that previously unmounted their panel immediately now expose a
controlled visible state and retain presentation until dismissal. Their existing
explicit saves, dirty/busy checks and business repositories remain authoritative.

## Verification

Automated regressions cover measured panel/scrim separation, guarded close,
content retained during exit, actual iOS dismissal ordering, duplicate event,
rapid reopen before and after native hide, unmount cancellation, web/Android
reopen, fixed footer/body, keyboard and header-only gesture boundaries.

Local mobile Vitest passes **3,313 tests**, with 12 environment-gated cases
skipped; repository lint, strict mobile TypeScript and formatting pass. The
focused parent/picker cases also run on iOS, Android and web mocks; those do not
certify an Android device.

Native recording, final checks, merge and TestFlight delivery are separate
checkpoints. Their observed evidence and receipts are stored outside the repo
in workspace `maintenance/sheet-motion-2026-11-16/`; a code merge alone is not
physical iPhone acceptance.
