# Illustration download retention — 20 October 2026

## User-visible behavior and scope

M7 workstreams 6/7, L10 and M8 media hardening. Bound downloaded illustration copies to **64 MiB per store/account on this installation**, including interrupted or unknown files in that owned directory. This is not a device-wide quota for all stores, a server retention policy, permission to generate an image, or a billing limit. No business original, product image, receipt photo, source document, Outbox command or remote file is deleted.

Before a download, reserve enough disk space for all missing requested variants, including temporary installation overhead. Reclaim only exact files described by previously received, integrity-checked private manifests, least recently consulted result first. Provider-original/data copies precede the comparison pair within an eligible result. Keep every explicitly offline-retained result and all results of the currently viewed preparation. Keep metadata after eviction so recovery downloads the same source/result rather than generating again. If protected/unindexed files leave insufficient capacity, stop before downloading with a French explanation; never exceed the quota silently or delete unknown files. A pre-existing directory already over budget is not a license for another download.

The comparison offers **Conserver hors connexion** and its reversible local release preference. It does not download unseen originals or promise backup; only the downloaded copies are protected against this cache policy. Pinning requires a verified source/image pair. The preference applies to all downloaded results of the same preparation, is inherited by newer results and can release older protected versions from the current view. It survives SQLite restart, works offline and does not require a manager role or enqueue a business action. Damaged/missing copies retain their private metadata and allow unpinning/recovery rather than locking capacity permanently.

## Implementation and invariants

SQLite migration 59 extends the existing `copilot_layout_illustration_files` table with `last_accessed_at` and `offline_required`; existing rows retain their manifest and inherit creation time as initial recency. No remote schema, capability or provider configuration changes.

A shared account/store queue serializes transfer, read/touch and pin operations across controller instances before native file gates and SQLite transactions. No SQLite transaction remains open during provider/file transport. Other stores/accounts have independent quotas. File measurement walks only the dedicated account directory, counts actual byte lengths and refuses inaccessible/oversized directory inventories; cleanup never follows an arbitrary stored URI. Empty owned result/preparation directories are removed only when empty. Unknown files are counted but preserved.

After a validated download buffer and private-source check, register its immutable remote manifest before installing the first file. Interrupted transfers therefore keep an indexed recovery/cleanup target. This row alone is never file-presence proof: every display still checks actual size/hash/MIME/native dimensions. A partial pair cannot be pinned; source and result identity remain unchanged. The active owner/private parent is checked again in the registration transaction and around asynchronous file operations. A queued failure releases the gate; retry never authorizes generation.

## Evidence

- A production transfer with real disk files refuses before downloading while older copies are pinned, evicts only those copies after release, preserves a separate unsynchronized receipt, and reopens the new pinned comparison offline from SQLite.
- Actual file-backed SQLite close/reopen retains the same manifest and offline preference without new Outbox entries.
- Capacity uses real file lengths, including unindexed interrupted files; exact-path native removal preserves other copies and unknown files.
- LRU, protected current/historical source, pin, foreign owner/store, malformed manifest, rejected capacity before network, scope change, partial transfer/retry, damaged-copy unpinning and shared-queue failure recovery are covered.
- Migration 58→59 preserves existing private recovery metadata and pending-command count.
- A disposable route mounted the production viewer with clearly marked synthetic pixels and an in-memory transfer port. At 390 and 320 px: retain → close/reopen → preference present; unpin; cache-full and offline failures preserve displayed images and show distinct French messages. Page width equals viewport, console warnings/errors empty. The browser exercise is UI evidence only, not a real native filesystem/gesture or AI-provider test. Temporary route/data/tab/server are removed before final checks; screenshot/harness evidence is retained in the task artifacts.

## Delivery and remaining V1 gates

This increment is **not deployed** and is absent from installed build 5. It follows PR 306–308, which are merged but unreleased. PR 308 exact-head push/PR CI both passed 3,449 tests / 6 skipped, including five real Mongo transaction scenarios; merge `0b7f9af89598e2d78251f22fdfaac30c5c56b9aa`, source `20efafd77054a0f29501b5736c280a201a191279`, both branches deleted.

Workstreams **1/3/4/5/6/7 remain in progress, 2 code ready**. T28 still needs explicit generation/budget authorization, durable provider-attempt reservations and worker/result handoff/unknown outcome, approved model/cost activation, optional store-photo reference and measured iOS/Android acceptance. Full V1 UX and M8 gates remain open. No paid AI request, real Blob operation, environment-file access, system modification, production deployment or EAS build is used in this increment.
