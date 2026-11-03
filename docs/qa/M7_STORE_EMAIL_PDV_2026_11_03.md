# Readable store email — 3 November 2026

The owner explicitly authorizes activating `pdv09083@selidoruel.resend.app` for the existing pilot store mailbox. Preserve its binding ID, store/owner/sender, receipts, jobs and originals. No new database entity, endpoint, model call, domain/DNS change or separate importer.

Migration 56 backfills each binding’s primary recipient into `routingRecipients` and creates one unique multikey routing index. A primary recipient and its retained aliases therefore reserve the same namespace across all bindings, including revoked ones. Migration replay unions addresses rather than dropping aliases. New bindings populate this existing-record field. Signed inbound admission searches both primary and routing recipients, selects one binding even when two of its aliases appear in the envelope, and retains sender/membership/revocation/ambiguous-recipient checks. Historical chat aliases remain retired after store mailbox setup.

The native cache previously rejected any recipient change. Only store-namespace recipients may now refresh under the same identity; owner, sender, dates and conversation binding immutability remain. Revoked entries cannot reactivate through a delayed response. A delayed former address can still be displayed until the next refresh; it remains a working alias. This does not introduce a general mailbox editing UI or a synchronized store PDV field.

## Verification

49 focused API tests pass without skips using isolated real transactional Mongo and local SDK signature verification. The new integration case covers both addresses, a single envelope with both, stable binding identity, duplicate-address rejection, migration replay, wrong sender, revocation and absence of a store chat. 62 mobile cache tests pass using actual SQLite, including rename refresh and rejection of sender/owner changes, revoked reactivation and historical conversation address changes. API strict types pass. Final CI, deployment, native artifact and live configuration are recorded separately in the external release ledger.

## Administrative activation

After compatible API delivery and native artifact verification, inspect the existing store mailbox and current manager membership. Check address availability and migration/index identity. Use a single compare-and-set update against the exact binding ID/store/owner/store namespace/current recipient and `revokedAt: null`: set `recipient` to the requested address and atomically add both old/new addresses to `routingRecipients`. Do not recreate the binding, change its sender, rewrite historical manifests or manufacture a live inbound event. Read back the exact record and canonical API response when access permits. An email sent by the owner remains the real delivery acceptance; configuration and controlled integration tests are not an assertion that such an email was received.

Rollback to the prior runtime requires first restoring the previous primary recipient, since it cannot route aliases. Keep the additional reserved routing address; never hand it to a different store.
