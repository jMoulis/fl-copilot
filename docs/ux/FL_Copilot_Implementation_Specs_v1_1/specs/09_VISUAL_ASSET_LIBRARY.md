# Visual Asset Library — Functional & Technical Specification v1.0

**Status:** Proposed implementation contract. **Scope:** Product catalog imagery, shared across Products, Analytics, Copilot and Actions. **Platform:** React Native / Expo; SQLite offline-first. **Priority:** Implement after navigation and Analytics Explorer vertical slice unless a current workflow requires imagery sooner.

## 1. Objective

Create a persistent, reusable visual library so that a product import **never triggers image generation by default**. Resolve an existing approved image first; only enrich a missing identity asynchronously. An image is fetched or generated once and may be linked to many commercial SKUs without duplicating the binary.

## 2. Core principles

1. **Import is never blocked by image availability.** Product and sales ingestion must complete independently of enrichment.
2. **Reuse before enrichment.** Exact approved link -> normalized visual identity -> approved generic fallback -> asynchronous enrichment queue.
3. **No silent false match.** A similar product is not necessarily visually identical. Uncertain matches require review or a clearly generic placeholder.
4. **No uncontrolled web scraping.** Only approved image sources with documented commercial-use rights, provenance and applicable attribution. Do not assume that search result visibility grants reuse rights.
5. **AI imagery is illustrative, not evidence.** Never present synthetic images as actual packaging, brands, origin labels or the exact sold product.
6. **Single logical asset, many links.** Keep images independent of product rows, sales periods and import runs.
7. **Offline first.** SQLite stores asset/link metadata and local file paths; actual binaries live in app file storage with durable cache policy.
8. **Human correction wins.** Approved manual links must not be silently overwritten by future imports or AI matching.

## 3. Domain model

### `visual_assets`
- `id`: UUID
- `storage_key`: durable object-storage reference (nullable before upload)
- `local_uri`: device file path (nullable)
- `content_hash`: SHA-256 of binary for deduplication
- `mime_type`, `width`, `height`, `file_size_bytes`
- `origin_type`: `licensed_source | supplier | user_upload | ai_generated`
- `source_url`, `source_provider`, `license_type`, `license_reference`, `attribution_text` (nullable where not applicable)
- `generation_model`, `generation_prompt_version` (for generated imagery, no secret keys)
- `review_status`: `pending | approved | rejected`
- `created_at`, `updated_at`, `version`, `deleted_at`

### `visual_identities`
- `id`: UUID
- `canonical_name`: e.g. `red round tomato`
- `normalized_taxonomy_id`: existing catalog taxonomy link, when available
- `variety`, `appearance`, `color`, `packaging_type`, `brand` (nullable; only if verified)
- `specificity`: `generic | variety | packaged_exact`
- `primary_asset_id`: nullable FK to `visual_assets`
- `created_at`, `updated_at`, `version`

### `product_visual_links`
- `id`: UUID
- `product_id`: FK to existing normalized catalog product/SKU
- `visual_identity_id`: FK
- `override_asset_id`: optional FK for an exact SKU-specific image
- `link_type`: `exact | inherited_generic | manual_override`
- `confidence`: nullable score; not an authorization to auto-approve
- `verification_status`: `approved | needs_review`
- `verified_by`, `verified_at`, `created_at`, `updated_at`
- Unique active link per product and display role; respect existing catalog identifiers and product/UB substitution semantics.

### `image_enrichment_jobs`
- `id`, `visual_identity_id`, `status`: `queued | running | awaiting_review | completed | failed | skipped`
- `strategy`: `licensed_lookup | ai_generate`
- `attempts`, `last_error_code`, `created_at`, `updated_at`
- Idempotency key on normalized identity + strategy + prompt/version, preventing repeated jobs from repeated imports.

## 4. Resolution algorithm

```text
On normalized product upsert:
  if approved manual/exact link exists -> reuse it
  else if approved visual identity matches at safe specificity -> link it
  else if an approved generic category image is appropriate -> show fallback
  else -> show neutral placeholder
  enqueue one idempotent enrichment job only when policy allows
  continue import immediately

Background enrichment worker:
  check library again (avoid duplicate concurrent jobs)
  query licensed/approved supplier image sources
  validate identity, licensing, quality and provenance
  if acceptable -> store asset, create/reuse identity, link with review policy
  else if identity is generic and AI generation is enabled -> generate candidate
  store candidate, mark for review if uncertain
  after approval -> link and sync metadata
```

**Matching priority:** verified exact SKU/packaging -> verified variety and appearance -> generic produce type -> placeholder. Never infer brand, origin, organic status, packaging or exact cultivar from generic images. A gencode alone does not justify generic reuse if packaging/brand visuals matter.

## 5. Example

`Tomate ronde vrac France`, `Tomate ronde vrac Espagne`, and `Tomate ronde calibre 67/82` may share a generic **round red tomato** visual identity, if their actual appearance is sufficiently similar. A **cherry tomato punnet** requires a distinct packaged identity. Image reuse must not collapse commercial product records or alter pricing, sales, waste, UB or substitution data.

## 6. Sourcing and generation policy

- Preferred: existing approved library -> supplier/manufacturer asset with valid rights -> curated licensed image provider -> AI-generated generic visual.
- Do not hotlink third-party sites in the app. Ingest approved binaries into managed storage subject to license terms.
- Record rights and attribution; reject assets with unknown or incompatible licenses.
- Generate only generic unbranded produce visuals; never synthesize exact branded packs as if authentic.
- Use consistent 1:1 crops, centered subjects, neutral/transparent backgrounds when possible, and variants optimized for Dark Premium.
- Make provider/model, image size, budget cap and automatic-generation policy configurable. Default automatic AI generation **off** until explicitly enabled.
- Deduplicate binaries by hash and logical jobs by identity; avoid one image generation per SKU or import.

## 7. Offline architecture and sync

- SQLite is the authoritative local operational metadata cache. Images are files in app storage, not blobs embedded in SQLite.
- Maintain a persistent local thumbnail cache with bounded storage, versioning and LRU cleanup for nonessential files; preserve offline-required assets.
- Product screens render local approved images instantly when cached; otherwise a branded-neutral placeholder, never a blocking spinner.
- Outbox for manual asset assignments, overrides and approvals. Bidirectional incremental sync for assets, identities, links and statuses.
- Resolve concurrent edits with version-aware conflict handling; manual approvals/overrides are not replaced by automated matches.
- Sync image files separately from metadata, retry safely and validate hashes after download.
- Protect uploads and signed URLs; never embed provider secrets in the mobile client.

## 8. UX requirements

- No image selection step in the normal Mercalys import flow.
- Product detail can show `Add/Change image`, `Choose from library`, `Upload photo`, `Review suggestion` (authorized roles only).
- A small `Illustrative image` indicator is required where AI-generated imagery might be confused with a real packaged product.
- Missing image -> consistent category placeholder, not a broken image icon.
- Review queue groups ambiguous matches and candidate assets; batch approval is optional, with preview and undo.
- Shared visual identity edits update linked products unless a product has a manual override.

## 9. Security, governance, and observability

- Enforce role-based approval and source-management permissions.
- Record provenance, actor, timestamp, changes, generation cost and job failures.
- Support takedown/revocation: unlink and stop distribution when license expires or a rights claim arises.
- Apply content validation, MIME/size limits and safe image decoding to user uploads.
- Metrics: library hit rate, generic fallback rate, pending review count, duplicate jobs avoided, average enrichment cost and cache hit rate.

## 10. Acceptance tests

- [ ] Reimporting the same SKU does not fetch or generate another image.
- [ ] Two suitable SKUs can share one visual identity and binary without duplicate storage.
- [ ] Distinct packaging does not silently inherit a misleading exact-product image.
- [ ] Missing image never blocks product import or analytics.
- [ ] Offline product list uses cached images or placeholders without network access.
- [ ] Manual override survives subsequent imports and synchronization.
- [ ] Unknown license is rejected for sourced assets.
- [ ] AI generation is disabled by default and never occurs per sales import.
- [ ] Concurrent enrichment jobs for the same identity deduplicate safely.
- [ ] Generated generic imagery is identifiable as illustrative when relevant.
- [ ] Image revocation invalidates linked displays and cached distribution according to policy.
- [ ] Test rights metadata, sync conflicts, invalid image files, low storage, and partial downloads.

## 11. Agent delivery sequence

1. Audit existing product normalization, image fields, local storage, backend object storage and licensing constraints.
2. Propose minimal migrations and repository interfaces; do not introduce parallel product catalogs.
3. Implement lookup/reuse and offline placeholder first.
4. Implement durable asset storage, metadata sync and manual linking.
5. Add licensed-source lookup and review workflow behind feature flags.
6. Add optional AI generation only after provenance, cost caps and approval workflow are in place.
7. Provide tests, migration notes, offline device screenshots and a documented rollback plan.

**Non-goal:** automatic creation of new imagery on each imported daily sales, waste, or promotion file.
