# M4 native waste receipt workflow

Date: 2026-10-04.

## Scope

The active milestone covers M4-T01 onward from `docs/specs/IMPLEMENTATION_PLAN.md`: native camera capture, persistent offline source images, local receipt and line state, private upload, assisted extraction, arithmetic and product validation, duplicate handling, waste publication and recoverable pending AI states.

## Implemented

### M4-T01 — Camera capture

- `expo-camera` is installed at the Expo SDK 57-compatible version and configured with a French iOS permission explanation.
- The `Casse` tab now opens a dedicated native capture screen instead of a product placeholder.
- The first-use and denied-permission states explain why camera access is needed, request permission when possible and open system settings after a permanent denial.
- The native camera uses the rear lens, waits for readiness, exposes a flash control and displays a tall receipt framing guide with the instruction to avoid cropping and glare.
- Captured images open in a review step with explicit `Utiliser cette photo`, `Reprendre` and `Annuler` actions.
- Confirmation copies the temporary camera JPEG into the app-owned `Documents/waste-receipts` directory under a stable UUID filename, verifies that the durable copy exists and removes the temporary cache file.
- The camera preview unmounts when the screen loses focus, preventing an inactive tab or screen from retaining the camera session.
- Browser routes state that capture is native and never simulate a successful persistent capture.
- The saved state confirms that the original file is local; receipt-domain persistence, upload and AI processing remain assigned to M4-T03 onward.

The complete camera flow was validated on the target iPhone Air with the M4-T01 staging build.

### M4-T02 — Image import

- The `Casse` tab exposes `Importer une photo` as the secondary entry point, including when camera permission is unavailable.
- The native picker accepts one JPEG, PNG, HEIC or HEIF image at a time and keeps its original quality.
- A selected image is copied into the same app-owned `Documents/waste-receipts` directory under a stable UUID filename while preserving its supported extension.
- The source selected from the photo library is never deleted; only the application-owned copy is used by the future receipt workflow.
- A declared unsupported MIME type is rejected before persistence, even when the source filename has a misleading supported extension.
- Cancellation leaves no local success state. Copy failures remain visible and retryable on the import screen.
- The browser route explains that image import and private native storage require the mobile application.

The photo-library import, cancellation and source preservation flow was validated on the target iPhone Air with the M4-T02 staging build.

### M4-T03 — Offline receipt domain model

- SQLite schema version 12 adds the canonical `waste_receipts` and `waste_lines` tables, store/status indexes, stable local IDs, source lineage, validation state and sync metadata.
- Shared runtime-neutral schemas define receipt, line, AI, duplicate, matching, validation and synchronization states without treating pending values as completed work.
- Camera capture and image import now calculate the durable file size and SHA-256 checksum before creating a local receipt draft.
- The local file metadata and its receipt are inserted in one SQLite transaction with `CAPTURED`, `PENDING`, `UNCHECKED` and `LOCAL_ONLY` initial states.
- Receipt lines share the receipt and store identity, preserve raw labels, decimal strings, extraction evidence and independent product nature.
- The `Casse` tab reads its ticket list from SQLite, exposes local/analyse-pending state and reloads on focus or pull-to-refresh.
- Repository acceptance coverage closes and reopens a file-backed SQLite database, then verifies that the receipt, image reference and lines remain available.

The local receipt and restart-persistence flow was validated on the target iPhone Air with the M4-T03 staging build.

### M4-T04 — Receipt upload queue

- Capturing or importing a ticket now creates the receipt, immutable source-document lineage, retained local-file metadata and `SOURCE_UPLOAD_AND_REGISTER` job in one SQLite transaction.
- The shared private-source upload queue accepts `WASTE_RECEIPT` images and reuses the existing Vercel Blob authorization and completion endpoints.
- A failed network attempt returns the job and source to `PENDING`, applies the existing retry backoff and preserves the application-owned image.
- App activation, manual synchronization and the pending-job timer resume the upload without blocking the capture result.
- Receipt images bypass Mercalys record verification. A confirmed upload records `UPLOADED` while leaving AI extraction pending for M4-T05 and M4-T06.
- The Casse list distinguishes `Envoi en attente`, `Image envoyée · analyse en attente` and terminal upload failure states in French.
- iOS container-path repair now searches the correct `waste-receipts` directory for receipt sources.

The offline queue and automatic reconnect upload were validated on the target iPhone Air with the M4-T04 staging build.

### M4-T05 — Remote image normalization

- The API invokes a dedicated Sharp adapter after a private `WASTE_RECEIPT` source upload is confirmed.
- EXIF orientation is applied before resizing, so portrait tickets remain portrait even when their encoded pixels use camera orientation metadata.
- The extraction derivative is a metadata-free JPEG at quality 85 with a maximum edge of 2048 pixels and no enlargement of smaller sources.
- The immutable original remains in private Blob storage; the derivative is written to a deterministic private `derivatives/{storeId}/{sourceDocumentId}/extraction-v1.jpg` key.
- MongoDB stores the normalizer version, derivative location, ETag, MIME type, byte size, dimensions and completion timestamp for traceability.
- Completed normalization is idempotent. A failure records a bounded code, retains the original and is retried when the mobile upload queue calls the idempotent completion endpoint again.
- Automated coverage verifies EXIF rotation, the extraction-size bound, durable derivative evidence, idempotency and recovery after a post-upload normalization failure.

The JPEG and HEIC normalization path was validated from the target iPhone Air against the production API.

### M4-T06 — Receipt Vision AI

- A provider-neutral receipt Vision service sends only the normalized private JPEG to the OpenAI Responses API with `store: false`.
- The model is configurable through `WASTE_RECEIPT_VISION_MODEL`; the pilot default is `gpt-5.6-luna`. Vercel uses its short-lived OIDC token with AI Gateway, while local development uses the dedicated server-side OpenAI key.
- Strict Structured Outputs cover detected receipt date, raw label, quantity, weight, unit, unit price, total price, per-field confidence and optional normalized source region.
- The same Zod schema is applied again after the provider returns. Invalid values, extra fields and duplicate source-line indexes never enter extraction evidence.
- Image text is explicitly treated as untrusted document data and cannot replace the system extraction instructions.
- MongoDB stores one idempotent extraction per source/provider/model/schema version with response ID, resolved model and timestamp.
- Valid evidence moves remote processing to `TO_VALIDATE`; provider, blob, incomplete and schema failures remain explicit and retryable without discarding the original or derivative.
- ADR 0005 records the provider, minimized payload, current retention limits and privacy follow-ups before wider rollout.
- The real pilot HEIC fixture produced a schema-valid result with 31 distinct readable lines after normalization; logs exposed only dimensions and aggregate counts.

### M4-T07 — Deterministic arithmetic validator

- Shared runtime-neutral code checks complete `weight × unit price ≈ total price` lines with exact decimal arithmetic and a configurable EUR tolerance, defaulting to `0.01`.
- The expected amount is rounded half-up to euro cents before comparison, so `0.580 × 4.99 ≈ 2.89` is accepted.
- A mismatch produces the explicit `AMOUNT_TO_REVIEW` warning with expected amount, observed amount, absolute difference and tolerance.
- Missing weight, unit price or total leaves the line `NOT_CHECKED` and records the missing fields; no value is inferred.
- Arithmetic validation never rewrites Vision evidence. MongoDB stores separate immutable, versioned and idempotent validation evidence linked to the extraction.
- The source document exposes warning and unchecked-line counts while remaining `TO_VALIDATE` for product matching and human review.
- Upload completion and retry run normalization, Vision extraction and arithmetic validation in order.

### M4-T08 — Receipt product matching

- The server reuses the canonical shared ProductMatcher against the active products, validated identifiers and validated aliases belonging to the receipt's store.
- Exact canonical labels and unique validated aliases can produce an `AUTO_MATCH`; fuzzy candidates remain `REVIEW`, collisions remain `AMBIGUOUS` and absent candidates remain `NO_MATCH`.
- Every line retains the complete matcher result and enriched candidate snapshots with product label, nature and sales unit for the later validation UI.
- The matched product supplies line-level nature. One receipt can therefore preserve both `BULK` and `PACKAGED` lines without applying a document-wide classification.
- Matching evidence is immutable and idempotent for an extraction, matcher version and deterministic catalog fingerprint. A changed product catalog produces new evidence and updates the source-document pointer.
- MongoDB exposes matched, review and unmatched counts while keeping the receipt `TO_VALIDATE`; ambiguous identity is never silently accepted.
- Upload completion and retry now run normalization, Vision extraction, arithmetic validation and Product Master matching in order.

### M4-T09 — Receipt validation UI

- Upload completion now returns one validated review draft assembled from the immutable Vision, arithmetic and product-matching evidence. Stable line IDs make retries idempotent.
- The mobile upload queue saves that draft to SQLite before completing its job and moves the receipt to `TO_VALIDATE`; a network retry never depends on volatile screen state.
- Opening a processed ticket from `Casse` displays the locally retained source image, the detected date and a date-confirmation field.
- Repeated labels are grouped for readability while every source occurrence keeps its own index, values, evidence and edit action.
- Weight, unit price, total and raw label can be corrected locally. Exact shared decimal arithmetic is rerun after every edit and keeps mismatches visible as `Montant à vérifier`.
- Safe matches show the associated Product Master entry. Ambiguous candidates remain explicit choices with their nature and confidence; selection is stored locally without silently accepting an AI suggestion.
- SQLite schema version 13 preserves arithmetic and product-match evidence alongside each draft line. Existing unsynchronized lines are never deleted when a remote draft is applied.
- Draft corrections remain local review decisions until M4-T11 publishes a confirmed waste event and its outbox mutation.

### M4-T10 — Exact receipt duplicate detection

- A captured or imported image is checked locally by store, `WASTE_RECEIPT` source type and SHA-256 checksum inside the same SQLite transaction that preserves its source, file and receipt.
- An exact match creates a `POSSIBLE_DUPLICATE` receipt, links the prior source and deliberately withholds the upload job until the user decides. Failed, cancelled and already confirmed-duplicate receipts are not reused as candidates.
- The validation screen exposes the required `Comparer`, `Conserver les deux` and `Marquer comme doublon` actions. When available on the device, the prior retained image and capture date are shown for comparison.
- `Conserver les deux` atomically records the decision and queues the retained new source for upload. `Marquer comme doublon` keeps the newly captured source locally and prevents publication without deleting either file.
- The API independently compares confirmed receipt checksum evidence within the same store and returns a possible-duplicate candidate for receipts first seen on another device.
- A server result cannot undo an explicit local `Conserver les deux` decision. Product/day similarity alone is never used as duplicate evidence.
- SQLite schema version 14 records the candidate source and exact-checksum reason for recoverable review.

## Verification evidence

| Check                | Result                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------- |
| Persistent filename  | One UUID capture produces a stable `.jpg` destination under `waste-receipts`                 |
| Failed persistence   | A copy failure never returns a durable capture result                                        |
| Repository checks    | Structure, lint, strict TypeScript 6 and 256 tests pass                                      |
| Expo compatibility   | Expo Doctor passes all 21 checks with SDK-compatible packages                                |
| Native configuration | Expo public config resolves the French camera and photo-library permissions                  |
| Bundle acceptance    | Expo export completes for both iOS and Android                                               |
| Web boundary         | The browser exposes an explicit native-only state instead of attempting local camera storage |

## Next work

1. Validate M4-T10 on the target iPhone by importing the same image twice and exercising both resolution choices.
2. Implement M4-T11 atomic publication of confirmed waste lines and their outbox mutations.
