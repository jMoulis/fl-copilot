# Product illustrations from the product sheet — 12 November 2026

## Owner-approved scope

Reuse the Copilot OpenAI account. Generate one realistic square PNG with actual alpha, with a coherent studio style. Canonical product nature drives loose versus packaged presentation. Packaging is allowed; generic packaging must not pretend to reproduce an exact branded pack. The existing photo/library chooser and explicit approval remain available. No image generation on imports or on opening the product sheet; no agent, tool loop, chat history or new catalogue.

The generation action replaces the chooser content inside the same native sheet. Its first screen is free: it reads current product and configured indicative cost. The user then starts one billable image and separately chooses whether to use its preview. The old original and existing links are retained until that choice. Actual photographic background removal remains a separate backlog item; this increment requests alpha at generation time.

## Implementation and recovery

- Shared Zod request/options/result contracts; authenticated manager-only routes, reauthorization before returning private content.
- Direct AI SDK image adapter on the existing OpenAI provider, exactly one image, 1024×1024, high quality, transparent PNG and zero automatic provider retries. Model defaults to the currently documented `gpt-image-2.6-flare`; there is no paid fallback.
- Decode and check PNG signature, dimensions, alpha, transparent corners and a visible nonempty subject. This is a technical check, not automated proof of visual fidelity; the human preview remains necessary.
- A small private server attempt ledger (`productImageGenerations`, Mongo migration 59) retains the immutable product snapshot, policy, result, provenance and provider token counts when reported. Its unique partial index limits simultaneous runs to one per store. This is not a second product/visual model or a business writer.
- The existing device `local_jobs` table retains the exact request ID before sending. `AWAITING_REVIEW` is excluded from normal sync counts/retry processing. Reopening reads the result; re-sending the same request cannot trigger another provider call. Transport failures, validation failures and stale workers are conservatively uncertain because they may have been charged. Another billed attempt requires abandonment and a new explicit launch.
- Unapproved output is privately stored and downloaded to an app-owned verified source file. Only `Utiliser cette image` calls the canonical `assignCapturedVisual` local transaction: actual AI provenance, attributed human review, generic visual identity, product-specific manual override and the existing file upload job. Canonical sync and visual-file init/complete/manifest endpoints handle durable library ingestion and cross-device retrieval. A generated packaged visual is never marked `PACKAGED_EXACT`.
- Existing approved library binaries remain reusable. No global shared primary visual is overwritten and no product or KPI is changed by generation.

## Pricing and activation

Generation defaults off. Activation requires the existing server OpenAI key and a verified positive `PRODUCT_IMAGE_ESTIMATED_COST_USD`; no price is silently invented. The estimate, model, quality and dimensions form a policy fingerprint. Changed policy or product version rejects a new request before billing. The UI describes the estimate as indicative USD, not a guaranteed ceiling. A fresh provider request is never a test side effect.

Official documentation consulted 12 November:

- [Single-image API, transparency and current models](https://developers.openai.com/api/docs/guides/image-generation).
- [Current Flare model](https://developers.openai.com/api/docs/models/gpt-image-2.6-flare).
- [Token pricing](https://developers.openai.com/api/docs/pricing): direct image calls have image output plus input cost; a Responses text agent would add another charge. Do not use the deprecated 1.5 per-image table to quote 2.6.

No new key, remote environment change, paid image, deployment, native binary or owner acceptance is implied by local tests. Actual provider availability, final indicative estimate and a real image quality review remain activation/acceptance gates.

The official guide’s current calculator computes 1,756 image output tokens for 1024×1024/high on 2.6 (48×48 tiles with the published pixel factor): approximately $0.05268 image output at $30/M, plus the short product prompt at $5/M text input. **$0.06 is a proposed indicative total, not a guaranteed cap or a measured bill.** The provider prompt is bounded to 4 KiB and no chat history is transmitted. Record the real provider usage on the first explicitly authorized generation before treating this estimate as calibrated.

## Validation

The focused tests use explicitly synthetic alpha fixtures and an isolated local Mongo replica set; they do not fabricate production images or approvals. They cover prompt nature/packaging, provider parameters and absence of retries, opaque/empty/wrong-size rejection, concurrent deduplication, policy/source changes, scope/role restrictions and revocation before returning data, crash/reopen request identity, separate native preview approval and canonical local writes. The complete protocol case runs generated output → explicit local selection → canonical Mongo push → canonical file init/complete → transparent manifest/bytes → second local device resolution and file cache. Private storage is simulated in this case; no claim of live Vercel Blob or iPhone acceptance follows.

Remaining device recipe after API-before-mobile delivery and activation: generate one loose produce image; inspect it on the app background; cancel without replacing; reopen the retained preview and use it; synchronize another device. Repeat with a conditioned product and inspect its generic packaging. Leave/reopen the app while generating and verify no new charge-producing attempt is made. Check that the previous photo and ordinary offline library access still work.

Local checks: complete `pnpm check` passes (5,152 tests passed, 865 conditional integrations skipped); format, API build/import and iOS/Android exports pass. The focused local replica-set run additionally passes 38 tests across nine suites without skips, including the generation, file-service and two-device suites. GitHub exact-head checks, merge, release and actual device acceptance are tracked separately.

Live-store read-only preflight found that the initial generation reader incorrectly assumed transport-shaped product rows. Production uses Mongo `_id`, BSON dates and Decimal128 packaging. Reuse `serializeProductDocument`, also used by canonical bootstrap/pull, and seed integration products in the actual BSON form. The added packaged-product regression covers IDs, dates and decimal quantities. This is an API-only correction; the build-50 mobile tree is unchanged. No image was billed before this preflight and no broken generation API was promoted.
