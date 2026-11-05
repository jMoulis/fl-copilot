# M8-T06 — session revocation races

Four controlled real-Mongo scenarios failed against the previous auth service:

- A refresh which had already read the user/session could clear a later logout's revocation.
- Re-login reused the same session ID, making an unexpired pre-logout access token usable again.
- A late old refresh could overwrite the credential issued by a newer verified login.
- Two refreshes which had read the same credential could both succeed and overwrite one another.

No exploit or incident against the production store is claimed. The reproductions use a disposable local Mongo replica, actual auth service and synthetic login codes delivered to a no-op test sender.

## Change

Refresh uses one conditional update on the exact session ID, user/device, current refresh hash, unrevoked state and expiry. A stale update fails closed; it cannot upsert or unset revocation. The update follows Mongo's [expected-current-value atomic update semantics](https://www.mongodb.com/docs/v8.0/core/write-operations-atomicity/).

A verified login replaces only that user's session for that device with a fresh session ID. Deletion/insertion are one Mongo transaction, retaining the existing unique user/device index. Failure rolls back the old session. Old access/logout tokens still reference the retired ID and cannot authorize or revoke the new session. Other devices retain their own sessions.

No new collection, field, migration, auth endpoint, token claim shape, mobile schema, dependency or model tool. Existing sessions continue to refresh with their current ID; no forced global logout. Routine refresh remains a single-document update; only verified login performs the replacement transaction.

## Validation

**124 tests pass across nine files; zero skips**, using real transactional Mongo where applicable:

- Seven new cases cover the four races, concurrent verified logins, rollback of a failed replacement, other-device isolation, device binding and live store-membership revocation.
- Existing database integration: 12; API route/config: 40; original routes: 1; original service: 26; upload service: 6.
- Native session manager: 12; mounted auth provider: 12; recovery ownership/storage: 8.

The read gate pauses after an actual Mongo user read and before session persistence. Local native/SecureStore and Blob ports remain controlled in their existing suites. No real email, paid AI call, production login, business mutation or phone logout is performed.

Ten-project typecheck, targeted ESLint/format/structure and API build/import checks are required before delivery. Exact-head CI, merge and API release remain separate records. Compatible with the accepted build34; no new native binary is required by this server change.

## Boundaries

This focused fix does not close all T06: it is not a complete penetration test or native logout/Keychain/privacy certification. Local logout clears credentials/access, preserving offline business records and unsent originals under the existing owner gate. Never interpret the old “local wipe” label as permission to delete unsynchronized data.

The owner accepts both build34 cases: readable retained PDF and offline cold launch/read/reconnection. The PDF-opening defect and that offline-launch case are closed accepted cases; they do not certify mid-upload network loss, two physical iPhone conflicts or full M8 completion.
