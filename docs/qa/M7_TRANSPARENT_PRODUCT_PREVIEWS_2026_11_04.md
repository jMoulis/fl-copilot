# M7 — transparent product previews, 4 November 2026

## Reproduced defect and scope

The owner uploads transparent PNGs through the app but sees white backgrounds and a recurring “Générique” label. The original remains immutable RGBA; the old preview processor flattens to white JPEG. A real transparent-pixel regression fails before the correction (alpha 255 instead of 0). This is a derived-preview/display defect, not missing source provenance or a reason to reupload.

Keep the existing private visual-file endpoints, asset/identity/link models and approval checks. Manifest readers explicitly opt into `preview=transparent`. Default initialization/completion/manifest/download requests keep the v1 JPEG proof, so deployed old binaries remain compatible. New readers can obtain a v2 PNG proof for PNG originals. A discriminated shared contract binds format/version, exact source/hash/dimensions and the existing 2 MiB/1024-pixel preview limits. Very noisy PNGs downsize to 512 rather than discard alpha or exceed the byte cap. Metadata is stripped from the derived image; source bytes are untouched.

The service derives a PNG from the verified retained original on first opted-in use, including already uploaded assets, and stores its descriptor beside the existing legacy proof in the same file record. Immutable versioned keys and repeated asset/approval checks remain; no new database model, migration, domain revision, approval, provider call or product association. Old JPEG proofs stay unchanged. New mobile caches accept strictly bound JPEG/PNG previews. The existing durable worker upgrades a legacy PNG preview while keeping it visible offline. Failed transfer preserves that copy; only after a committed replacement may an unreferenced old derived file be removed. Shared previews and originals are protected. Existing job deduplication, backoff and terminal-failure rules remain.

Remove the “Générique” image overlay and default product-panel caption. Keep underlying specificity/link/provenance and explicit library/editor distinctions. AI imagery still has its separate Illustration disclosure; no image becomes an exact branded/varietal photograph by changing its presentation.

## Verification

**66 tests across 12 files pass, zero skips**, including real PNG pixel decoding, bounded noisy alpha output, immutable source/legacy proof, opt-in HTTP/authentication, strict API-client manifest/download/hash handling, actual Mongo → another SQLite/file cache, restart/revocation/manual association behavior and the administrative visual pilot’s existing compatibility. A mounted real hook/SQLite case shows a cached JPEG immediately, queues one upgrade, then resolves the new PNG without a generic badge or requeue. Native transfer tests preserve the offline copy on failure and never remove another asset’s shared derived file.

All ten strict type projects, targeted lint, formatting and API build/import pass before merge. Mongo runs on an owned localhost replica with disposable databases; private Blob/filesystem adapters are controlled in tests. No production review, association, original or image-generation record is changed; no paid model request. These checks do not certify actual device pixel rendering or live Vercel PNG regeneration.

## Release and focused native check

Deliver the backward-compatible API from the green exact source first, stage/verify/promote the same production artifact, then build the native client and verify its actual archive identity. Build 31 is the accepted baseline and lacks this correction. New native metadata/cache formats are not a promise of downgrade compatibility; retain the installation/originals and prefer a compatible forward fix.

After the new build, use an existing transparent PNG already assigned to a product. Open it online, allow the queued preview update, then reopen it: the background should match the app surface and the “Générique” overlay should be absent. Reopen the cached image offline if practical. No new source upload, product reassignment, AI approval, TG declaration or memory confirmation is needed. The owner retains image selection/uploads; the separate three-generated-image administrative pilot is not claimed completed by this fix. Existing build-31 chart and new-discussion memory recipes remain closed.
