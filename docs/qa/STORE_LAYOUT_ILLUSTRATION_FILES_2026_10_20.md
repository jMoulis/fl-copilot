# Private illustration files and comparison — 20 October 2026

## Story

A result remains anchored to its exact unpaid preparation, allocation card and historical physical revision. Conserve the original provider PNG, normalized viewing PNG, canonical schematic PNG and structured source JSON separately. An authorized owner can recover the images into private local storage and compare them in the existing scenario sheet, then reopen them offline. This increment cannot call an image provider, authorize spending, adopt a plan or record execution.

## Remote conservation and access

Strict shared manifests bind immutable result ID, complete preparation, source hashes, renderer/prompt/model provenance, token usage (unknown remains null), limitations, MIME/size/dimensions and file checksums. A canonical SHA-256 covers the metadata. PNGs are bounded to 12 MiB and 1536 × 1024; structured source to 2 MiB. Original pixels are decoded and the viewing image must match their metadata-stripped normalization. The compiled source frame/binding must match the frozen preparation. A manifest never contains a URL, key or inline binary. Source bindings explicitly retain only store/owner/conversation identities from a wider caller context; unrelated fields cannot change the canonical binding or leak into it.

Mongo migration 50 adds the owner/preparation/result history index. A private STAGING checkpoint precedes binary writes. The original is written first using the existing immutable private Blob adapter; the manifest becomes READY only after all four files are conserved. Repeated completion cannot replace a result. Internal recovery uses that same archived original to reconstruct remaining files without another provider invocation. If the original never reached storage, the checkpoint remains uncertain and unavailable; recovery refuses to synthesize a replacement. This is not proof of exactly-once provider billing or crash recovery before the checkpoint.

Conservation of already-produced bytes and permission to view them are deliberately separate. The internal completion/recovery seam validates immutable preparation/card/historical-plan hashes; it retains output even after role revocation or logical chat deletion. It has **no HTTP write route**, and a future worker must separately enforce authorized attempts/budgets before invoking a provider. GET routes revalidate active store membership, owner, visible conversation/card/assistant chain and historical binding. Reads of tombstoned or foreign sources fail. The ordinary PREPARE push continues to require MANAGER before first acceptance and cached replay; an active STAFF owner can read its previously prepared result. Binary reads revalidate access after Blob I/O.

Routes:

- GET `/api/v1/copilot/layout-illustrations/:preparationId/manifest`: EMPTY or READY manifest, authenticated store/owner context, no shared caching.
- GET `/api/v1/copilot/layout-illustrations/:preparationId/results/:resultId/:variant`: `source`, `image`, `original` or `data`, exact checked bytes streamed in bounded chunks, `private, no-store`, `nosniff`.

## Local restoration and UX

SQLite migration 58 stores only verified derived manifest metadata, scoped by store/owner/preparation/result. The normal preparation Outbox/sync remains unchanged; retrieving a derived file creates no business action or new command. Existing source-file hash/verification and file-operation gates are reused. File paths are derived from validated IDs/checksums inside an owner-specific document directory; no absolute sandbox path is synchronized. Native verification reads bounded chunks and checks hash, type, size and image dimensions before installing a temporary file. A corrupt derived cache can be replaced only after a complete replacement is verified; selected/unsynchronized business originals are never involved.

The transfer loads locally first, coalesces repeated recovery taps and checks account/private source before metadata commit. Session changes, a deleted parent, forged binding or truncated bytes cannot produce a cache proof. API manifest/binary reads have a 120-second deadline and refuse redirects; oversize streamed bodies are cancelled. The existing visual-file reader shares this bounded transport, retaining its prior scope/error contracts.

The existing scenario sheet compares **Schéma source** with **Illustration proposée par l’IA**, offers the provider original and preserves images when refresh fails. Source changes show a historical warning. Images do not certify dimensions, capacity, compliance, stock, adoption or execution. No new menu, global model instructions or agent architecture.

## Evidence and limits

Local SQLite and file-system tests cover restart, double-tap coalescing, original bytes, partial cleanup, corrupt derived-cache repair, scope/deletion changes, failed download and network deadlines. Expo/native file calls and the native image-size decoder are test bridges; Node files and SQLite are real. Authenticated Fastify injection checks private headers, stream bytes and absence of public result-write routes. Five Mongo scenarios require transactional CI: durable duplicate/restart, owner restoration to a cold SQLite/file cache and offline reopen, partial-bundle recovery, missing-original uncertainty, revoked/deleted/foreign read refusal and corrupt/rebound output refusal.

A disposable route mounted the production scenario sheet and comparison component with explicitly synthetic geometry/pixels and in-memory UI ports. At 320/390 px, source and image/original display, page width remains the viewport width and console errors are empty. After closing/reopening from the synthetic cache, a simulated network refusal preserves images and shows an inline error. A changed-source scenario shows the historical warning. Temporary QA route/data, owned tab/server and viewport override are removed/reset before final checks. Screenshots/harness/data are retained in the task artifact directory. This does not prove native gestures/decoder/accessibility or image-generation quality.

## Delivery and remaining V1 work

Code under verification, not in production API or iOS build 5 (`1e7684d`). API/migration compatibility must precede a future grouped native delivery; no new EAS build is required for this isolated increment. PR 306/307 are merged but unreleased.

Workstreams **6 and 7 remain in progress**, **1/3/4/5 remain in progress, 2 code ready**. T28 still needs explicit generation authorization and attempt/cost reservations, its durable worker/result handoff and unknown-outcome recovery, native cache-size/retention policy, approved provider/model/budget activation, optional real store photos and a measured/native pilot. No provider call, Blob operation against the real account, environment-file access, system configuration change or production deployment is used for these tests. V1/M8 and the other eleven UX lots remain open.
