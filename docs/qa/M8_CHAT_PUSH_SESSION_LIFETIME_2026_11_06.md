# M8 — session authority at chat notification dispatch, 6 November 2026

## Reproduced boundary

The completion sender originally captured its device token and membership before reading the conversation and persisted assistant reply. Logout, explicit alert disable, token transfer, membership removal or session expiry could win during those asynchronous reads while the already captured token was still sent to Expo.

Five new integration cases pause after the real Mongo reply read, apply the real authority change, then release the read. All five fail before correction: the mocked provider is called once. Tests use an isolated localhost replica set, canonical auth/registration services and a mocked Expo fetch; no actual alert or AI request is sent.

## Focused correction

Move the existing membership and live registered-token lookup after reply visibility/schema checks, immediately before provider dispatch. The token is resolved last, so a session revoked/expired, explicitly disabled or transferred while the reply was being read cannot supply the old destination. No extra query, transaction, model, job or native contract is introduced. Existing conversation/owner/store checks and persisted answer remain intact.

This does not recall a notification already handed to Expo/APNs, or make a network dispatch atomic with a subsequent logout. The tested guarantee concerns authority changes completed during reply lookup, before final authorization. No blanket claim of eliminating every external-delivery race is made.

## Verification

51 tests across six files pass, zero skips: actual-Mongo registration/revocation/transfer/read races; completion lifecycle and cached-result deduplication; preview formatting; one-request handoff; native preference serialization and mounted registration lifecycle. All five new refusal cases retain the persisted answer; the transferred token remains registered to its new session. Ten-project strict types, targeted lint, formatting and API bundle/import checks pass.

## Delivery boundary

API-only correction, compatible with build38 and the earlier notification-capable binaries. No new EAS build is warranted. Exact-head CI, merge and production promotion are recorded in the private release ledger; tests alone do not establish release. T06/T11 remain open for their other gates, including owner acceptance of build38 notification navigation. Build38 is available, not owner-accepted by this note. Atlas backup activation remains owner-deferred.
