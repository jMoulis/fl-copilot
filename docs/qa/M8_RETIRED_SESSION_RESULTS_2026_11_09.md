# M8 T06 — discard results from retired native sessions, 9 November 2026

## Reproduced boundary

The existing NativeSessionManager checked its generation after obtaining a token, but its later success checks depended on an optional caller-supplied owner ID. An ordinary request without that argument could return a successful response after logout or a new login, including a same-owner login with another selected store. A stale replay's 401/500 could also escape as an ordinary remote error. Separately, AuthProvider checked its active manager only before invoking an authorized request; an old provider's callback could return after unmount or replacement, or ask its old manager to retry a late 401.

Thirteen targeted cases fail against the unchanged build42 runtime: three ordinary-response login/logout transitions, three replay outcomes, six provider lifetime/outcome combinations and one SQLite/Outbox acknowledgement case. This is a controlled reproduction, not evidence of a production disclosure.

## Bounded correction

Reuse the existing session generation unconditionally at the request/response/error/replay boundaries; the optional owner check stays additional. Reuse AuthProvider's active-manager check inside each authorized transport callback, before sending and in an awaited finally. A retired provider therefore cannot pass its late 401 to the manager as a request for renewed credentials. Ordinary renewal retains the same generation and its existing single replay/coalescing behavior.

No new authentication mechanism, provider, session flag, timer, request, database field, migration, API, dependency, AI call, file deletion or credential-clearing policy. In particular this is not permission to implement the old destructive “logout/wipe” label: preserve unsynchronized actions and originals under the current authority gates described in [the existing session review](M8_SESSION_REVOCATION_RACES_2026_11_05.md).

## Persistence and verification

The combined test uses actual file-backed SQLite, the canonical local writer, NativeSessionManager and MobileSyncService. A controlled transport records a commit before releasing its acknowledgement. Logout retires that acknowledgement; the Outbox entry returns to PENDING with byte-identical payload and command ID. Normal same-owner login replays that ID and receives ALREADY_APPLIED, ending ACKNOWLEDGED locally with one simulated remote application. The remote acknowledgement/journal is controlled here, not an actual Mongo or production write; existing Mongo idempotency qualification remains distinct.

**133 focused tests pass across nine suites, zero skipped**, covering session startup/recovery, normal renewal and 401 replay, private owner checks, mounted AuthProvider, preserved Outbox work, push registration and reminder lifetimes. Workspace typecheck, changed-file lint/format pass. Exact-head push/PR CI, merge and grouped native delivery are separate gates. Do not request a destructive logout or an artificial unsent production mutation on the owner's working phone to reproduce this race. No standalone paid build or API redeployment is justified for this small native correction.

## Remaining T06 boundaries

This closes the reproduced late-result/retry path in controlled execution, not the complete session/privacy review. AuthProvider's remote logout remains best-effort and currently uses an in-memory access token; durable remote revocation after offline logout and OS-level retirement of remote notification registration require a separate qualification. Other signed-URL, MIME, entity-authorization and broader T06/M8 requirements remain open. No production privacy incident or real OS fault was inferred or tested.
