# M8 — session startup during secure-storage failure, 24 October 2026

## Defect and resulting behavior

Two reproductions against the merged PR 342 code failed: a rejected cold credential read called logout/clear, and an unreadable restored-copy owner trace cleared an otherwise valid stored session. Neither read failure proves a logout or a foreign account. A failed cached restoration promise also prevented an ordinary retry.

The existing session manager now releases only a failed restoration attempt; simultaneous calls still share one attempt. AuthProvider preserves credentials on unreadable local storage/ownership, removes operational children, and displays a French retry screen. No private native diagnostic or token is displayed. Retry is explicit, disabled while pending and uses the same manager/storage service; no new timer, protocol, provider or remote request policy is introduced.

As soon as a validated local session marker is available, cached content reopens **before** network token renewal finishes. Remote sensitive commands retain their existing access-token checks. A known foreign marker still requires the original owner's authentication; unknown ownership grants no access but does not clear credentials. A malformed stored-marker structure cannot be published as authenticated. Late startup failures cannot log out a newer authenticated session or affect an unmounted provider.

No business rows, source files, Outbox commands, local device identity, migrations or backend contracts change. This is a native/UI hardening increment, not acceptance of the full V1.

## Automated evidence

- Before fix: real mounted AuthProvider, **2 failed / 5 passed**, both unwanted-clear assertions reproduced.
- After fix: **58 targeted tests passed** across real mounted AuthProvider/DatabaseProvider and copy panel, session manager, secure-storage functions and real file-backed SQLite copy/recovery tests.
- Cold error, missing/unreadable owner trace, explicit retry, repeated failure, blocked operational children, offline reopening before unresolved network renewal, late failure after newer login/unmount, coalesced failed manager restore and malformed marker structure are exercised.
- Complete local suite: **3 399 passed / 636 environment-dependent skipped**, ten projects typed, lint/structure passed. Final exact-head push and PR CI must also pass transactional Mongo tests and native exports before merge.

Filesystem/SecureStore/network/native host ports are controlled in these tests; no real OS Keychain fault, physical unlock/background behavior, device gesture or native latency is claimed. Baseline/final logs and release status are retained in the PR/private verification record.

## Remaining native acceptance

Install the grouped update over the existing app, never uninstall/reset it. Cold-open online and offline with a previously authenticated session, confirm retained data/actions, resume connectivity and normal sync. Exercise the copied-database restart/original-owner flow from `M8_LOCAL_DATABASE_COPIES_2026_10_24.md`. If an actual secure-storage availability error occurs, retry after unlocking/reopening the device and confirm no unsent data loss or private diagnostics. Verify iOS and Android separately.

Full M7/V1, real email reception, measured layout/illustration activation, actual backup/restore, physical notifications/accessibility/performance and human acceptance remain open. No new credential, paid AI request, production business mutation or per-PR paid build.
