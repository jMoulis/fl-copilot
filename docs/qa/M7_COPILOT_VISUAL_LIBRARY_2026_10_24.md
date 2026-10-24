# M7 — visual metadata and conversational conflict review, 24 October 2026

## Scope and acceptance

Capability 7 extends the existing `store_conflict_review` to VISUAL_ASSET, VISUAL_IDENTITY and PRODUCT_VISUAL_LINK. A bounded read-only `product_visuals` SDK tool discovers exact synchronized targets: one product returns its link, identity and up to two referenced assets; library mode pages ten records by UUID. The existing five-read/turn and evidence budgets remain unchanged. No global prompt, model/provider change, migration or universal metadata writer is introduced.

Metadata excludes image bytes, URLs, file paths, storage keys, licensing free text and actor identities. Explicit status distinguishes unavailable product, incomplete parent metadata and a successful metadata read. The canonical `resolveProductVisual` supplies selected image versus placeholder; approval, explicit override and withdrawn-image rules are reused, not inferred by the model. This describes synchronized metadata, not image availability on the current device, physical product identity or confirmed usage rights.

The existing native `VisualConflictRepository.review/resolve` remains the writer. The chat card shows the same full two-version presentation as the manual page, including optional verified local image consultation. A compact model-facing basis binds the full canonical metadata hash. Review checks the current complete group, exact anchor, active commands, current scope and cancellation at commit. KEEP creates one canonical rebase/Outbox command; ADOPT sends none. Original packets and metadata history remain retained; privately recorded operation results support replay after restart.

Uploaded-image rights and restoration of a withdrawn image/association require separate native consents. Merely comparing the two versions grants neither. Trusted visual-library permission is required even if a caller has product-edit permission. Capabilities and artifact versions 1–6 retain their existing shapes/semantics; only exact header 7 exposes the new read and three comparison kinds. Unknown/combined versions remain disabled.

## Verification

- 19 controller cases cover all three kinds and both choices, SQLite file close/reopen/replay, separate rights/reactivation, role refusal, stale hash and aborted operations. Product records, original packets and private journal are checked.
- Two mounted actual React cards use migrated SQLite, the actual controller and shared visual presentation. They verify disabled/forced old button callbacks without rights and independent consent reset when the selected side changes. File storage is controlled; this does not prove physical file decoding, touch gestures or hardware rendering.
- Six additional real disposable Mongo/SQLite chat cases share the existing two-device conflict scenario, including a second group packet and newer pull. A real server preview reaches SQLite confirmation/Outbox, actual Mongo push, a third SQLite and file-backed offline reopen. Replay does not duplicate metadata history. Existing manual scenarios remain exercised.
- Six real disposable Mongo read cases cover product graph/privacy, foreign store, absent parents, canonical override/revoked-image policy, ten-record pagination/empty results and corrupt IDs/mixed filters. Read status is not rights/binary approval.
- Four additional installed-SDK tests use controlled provider HTTP: all three visual kinds negotiate only capability 7; metadata read validates adapter scope and remains absent for capability 6. No live provider/model call. HTTP negotiation and API client header tests include 7 and reject unknown versions.
- Targeted SDK/API/Mongo/client suite: **281 passed**, five files. Full `pnpm check`: **4,213 passed / 698 skipped** across **410 passed / 73 skipped** files, structure/lint and ten strict TypeScript projects green. The skipped cases require database configuration in that invocation; the targeted real Mongo suite above runs separately. CI runs its own Mongo 7 environment.

Initial local failures were test setup/timing/assertion errors (Mongo dates, wrong expected preview field, React async readiness, public error redaction and missing-parent fixture expectation), plus an empty-query evidence sourceVersion zero corrected to null. They are not claimed as reproduced production regressions. Lint also caught the unused import left by presentation extraction; it was removed.

## Delivery and remaining gates

This source is outside API `4941513` and iOS build 14 (`7e46885`). Group the compatible API deployment before a substantive native release. Both exact-final-head push and PR checks must pass before merge; delete the branch afterward. No paid EAS build, provider activation, production business write or physical acceptance is part of this increment.

This is metadata discovery and conflict review, not full conversational image upload/link/edit/retirement CRUD, original transfer acceptance, external image sourcing or generation. Immutable commercial-transcription comparison remains native-only. The complete V1/UX/M8 and other manual/chat exceptions, real expert/advice loop, Resend key approval, second-device originals, actual plan measurements/mobiles and illustration budget gates remain open.

Seven states unchanged: **1/3/4/5/6/7 IN_PROGRESS; 2 CODE_READY**. This increment advances 1 and 7 without closing either.
