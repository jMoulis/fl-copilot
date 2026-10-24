# Administrative visual pilot — audit, 24 October 2026

Status: implementation under verification; **production import NOT executed**. The supplied handoff contains specs, candidates with null metadata, and an opaque composite reference. It contains no final individual product PNG, truthful generation record, or human approval. The reference must not be cropped, uploaded, or approved as a product image.

## Canonical contracts and authority

- `packages/domain/src/visual-library.ts`: `visualAssetSchema`, `visualIdentitySchema`, `productVisualLinkSchema`, provenance/review and resolution policy. Existing collections only; no domain model or migration added.
- `packages/domain/src/visual-id.ts`: asset ID from SHA-256 of `visualIdMaterial("visual_asset", storeId, finalContentHash)` through `visualIdFromDigest`; link ID uses `"product_visual_link", storeId, productId`. Identities and command UUIDs are generated once and retained in the private operator journal.
- `packages/sync-contracts/src/sync.ts`: shared command envelopes, bootstrap and acknowledgements. `POST /api/v1/sync/push` uses protocol 1, actual device/store and stable command IDs. Expected version is null only for genuinely new entities. No last-write-wins or silent conflict resolution.
- `apps/api/src/auth/service.ts`, `apps/api/src/build-app.ts`: bearer session checked against live device session and active store membership; body device, store header and protocol checked. Visual writers must be managers. MongoDB/Vercel connector access is not application authentication. Current login supports IOS/ANDROID; this tool reuses a genuine session, does not invent a new platform/session or mint credentials using server secrets.
- `apps/api/src/products/visual-library-sync.ts`: scoped, attributed, transactional visual mutations, history and incremental sync changes; idempotent commands. Importer never accesses MongoDB or history directly.
- `packages/sync-contracts/src/visual-files.ts`, `apps/api/src/products/visual-file-service.ts`: approved asset required before init. `POST /api/v1/visual-files/init {assetId}` → READY or scoped staging PUT → `POST /api/v1/visual-files/complete {assetId,uploadId}`. Authenticated manifest/source/preview reads are under `/api/v1/visual-assets/:id/…`.
- `apps/api/src/uploads/source-upload-service.ts`: 10-minute, content-type/size/path constrained signed upload. Installed Blob SDK uses `https://vercel.com/api/blob/?pathname=…` for PUT, not a private read-domain URL. Upload receives only server-returned content-type, never app bearer credentials; redirects are rejected and signed URLs are not printed.

## Files, approval and mobile

Original immutable bytes stay private. Actual final PNG signature, decoded dimensions/channels, byte length, SHA-256 and transparent/opaque pixels are measured. Maximum 12 MiB, 36 MP and 12,000 px per side; preferred 1024 square. Automated corner-alpha checks do not prove photographic quality, clean silhouette, absence of text, or correct species: those require human visual review.

AI provenance is exactly `{type:"AI_GENERATED",provider,model,promptVersion}`. Actual original, prompt, timestamp, evidence and transformation hash chain are separate operational evidence, not invented domain fields. Metadata cannot prove a provider generated a file: a real reviewer must examine that evidence. Unknown provenance blocks import. No provider calls or new spend are made by the importer.

The bundle cannot provide approval. A genuine authorized human reviews actual file, evidence, exact SKU and digest interactively before commands are constructed. The resulting review is attributed to the current manager and time, and the server checks the actor. No `--yes`/headless approval path exists. The agent must never type the approval on behalf of the user. The private journal is trusted operator state, not a signed independent approval system and must never be accepted from an external image agent.

AI assets are linked only as `INHERITED_GENERIC`, with `GENERIC` identity and no brand/variety claims; never `EXACT` or `PACKAGED_EXACT`. Existing links, including tombstones and manual overrides, block first creation. Existing identical approved AI assets can be reused only with compatible provenance and identity; never relabel user-uploaded assets.

`visual-image-normalization.ts` retains original RGBA but creates a **JPEG preview on white**. `use-visual-library.ts` and mobile transfer/storage/cache consume that preview first. Transparent originals therefore do not imply transparent native thumbnails. This pilot does not alter that shared contract.

Metadata goes through canonical sync to native SQLite; verified files use existing visual-file transfer jobs/cache. First tomato must reach manifest/source/preview readback, then actual mobile sync/display/offline review, before banana/avocado. The optional `mobile-review` command records an explicit human attestation and actual screenshot hash after fresh server readback. It cannot independently establish which app/device produced a screenshot. Isolated SQLite tests are not physical phone acceptance.

## Observed catalogue and matching

Read-only connected audit: database `fl_copilot`, store `b1587682-bb70-4aba-a066-74298ef97640`, 450 products, 2 assets, 2 identities, 3 links. Existing assets are USER_UPLOAD/USER_CONFIRMED and all three links are MANUAL_OVERRIDE. Counts are an observation, not a lock on concurrent catalogue updates. Private audit JSON preserves the observed IDs/hashes; every real import rechecks through the authenticated bootstrap API.

| Subject            | Exact catalogue candidate                                                                                                                    | Disposition                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Round tomato       | `TOMATE RONDE VRAC` — `35140354-dbc3-45fa-902f-5a011c66dfac`                                                                                 | First proposed SKU, no observed link; human match still required                             |
| Cavendish banana   | `BANANE VRAC` — `78370ac3-ed94-4c20-9b2e-33e7c1e84751`                                                                                       | Existing manual link; preserve and stop. Label does not establish variety. Plantain excluded |
| Hass-style avocado | `AVOCAT AFFINE PIECE` — `ef283cad-6fa1-4b98-b74b-c53d6ed969bc`, or `AVOCAT AFFINE GROS CALIBRE PIE` — `eb984b0d-648d-40d2-9b25-2105cb8876e8` | Ambiguous; owner clarification pending, variety not established                              |

The banana manual link currently targets an identity labelled `MYRTILLE BARQUETTE 125G`. This may be a deliberate test or choice: no automatic correction is authorized. No commercial SKU is merged or changed by this pilot.

## Blockers

No final PNGs, generation proof, genuine app session or human approval is available to the importer. No actual mobile screenshot/acceptance exists. Banana has a protected manual association and avocado mapping is unresolved. No production write, image generation, credential workaround or claimed successful integration has occurred. Prepare blocked candidates only until each prerequisite is resolved.
