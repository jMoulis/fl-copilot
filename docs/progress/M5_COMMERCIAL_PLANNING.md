# M5 commercial planning

Date: 2026-10-07.

## Scope and dependencies

The pilot user accepted the core M4 workflow and explicit receipt-label memory on iPhone, and authorized starting M5. Follow `docs/specs/IMPLEMENTATION_PLAN.md` M5-T01 through M5-T13 and `COMMERCIAL_PLANNING_AND_PROMOTION_ENGINE_FUNCTIONAL_SPEC.md`.

A received commercial source is not a validated offer, store plan or execution record. No commercial action or official business observation may be inferred merely from capturing a PDF.

## M5-T01 — Local PDF source capture

- Native `Ma semaine` exposes `Importer le PDF hebdo` using the existing document-picker module. Cancellation changes nothing; an unavailable native module shows a build-update message. The browser route explains that persistent capture is native.
- The selected file is copied from the picker to app-owned `Documents/commercial-pdfs/<stable-file-UUID>.pdf`. Original user files are never deleted or modified. Existing destination paths are never overwritten.
- Before metadata registration, capture checks a bounded PDF header, positive size up to the existing upload-contract limit of 100 MiB, complete copied size and a SHA-256 checksum. Full PDF structure, encrypted/corrupt-page handling and page-text parsing belong to M5-T03; the header check does not certify that every page is readable.
- SourceDocument and LocalFileMetadata reuse existing shared contracts and SQLite tables; no migration or new native dependency is needed. Their creation shares an exclusive transaction. Capture date is not a business period: source generation time and business-period dates remain unknown.
- Exact duplicates are checked within that transaction by store, source type and checksum. A renamed identical file retains the first document and removes only the attempt's redundant copy. A modified file is kept separately, with no overwrite or publication; corrected-version reconciliation belongs to M5-T08.
- Persistence errors roll back source/file metadata and attempt to remove only the new app-owned copy. If cleanup fails, an unreferenced copy may remain; neither existing sources nor originals are removed.
- The source list reads SQLite and returns on focus/restart. Documents display `Conservé sur cet appareil` and `Analyse en attente`. The screen explicitly states that commercial analysis comes in a subsequent version.
- This increment creates no upload job, commercial operation, checklist, SourceRecord or Outbox command. M5-T02 will add idempotent source upload and extraction orchestration; captured documents are retained for that later path. Their current local processing state is `PENDING`, upload and sync state `LOCAL_ONLY`.

## Verification and native acceptance

SQLite tests cover restart persistence, store isolation, exact duplicate content, changed sources, transaction rollback, original-file preservation and no premature jobs/business records. Capture tests cover non-PDF selection, header bytes, empty file and malformed checksum rejection. Lint, strict TypeScript, repository tests and native bundle exports must pass before review.

Physical iPhone acceptance is pending after merge and staging build:

1. Select a locally available PDF from `Ma semaine` with connectivity off. A cloud-only file may first need downloading in Files; the app cannot retrieve uncached iCloud content offline.
2. Confirm it appears in the source list with analysis pending.
3. Close and reopen the app; the document remains listed.
4. Import the identical file again; the app reports that it is already registered and the list retains one entry.
5. Cancel the picker; no extra source appears.

Extraction results are not expected at M5-T01. The next increment is M5-T02, followed by deterministic page parsing and structured commercial extraction.

## M5-T01 native acceptance

The pilot user confirmed that the existing weekly file remains registered with analysis pending after the updated build. The alias cancellation conflict was separately resolved following PR #83; it was unrelated to PDF capture.

## M5-T02 — Upload and durable pipeline registration

- New PDF capture now atomically commits source/file metadata and one stable `SOURCE_UPLOAD_AND_REGISTER` local job. No business observation or general sync command is created.
- Before processing source uploads, the queue transactionally registers existing M5-T01 PDFs without a job. Existing jobs are retained rather than duplicated. Their document IDs, checksums and files stay unchanged.
- The existing private Vercel Blob initiation/completion protocol handles transfer, stable upload identity, expired URL renewal, backoff and interrupted claims. Concurrent local triggers still share one active cycle. A lost completion response retries the same source; an already stored binary is not sent again.
- Native sandbox-path recovery searches `Documents/commercial-pdfs` for PDF sources after an application update, and persists the recovered URI. It retains original PDF bytes locally even after remote confirmation.
- Only after confirmed upload does the API upsert one `commercialDocumentJobs` record with stable source UUID, store, checksum, object key and pipeline version `commercial-pdf.v1`. MongoDB migration 12 adds unique source/pipeline and queue-status indexes. Repeated or concurrent completion does not reset an existing job's progress. Failure between confirmation and job registration is recovered by another completion request.
- The existing completion contract's `jobId` carries this durable registration UUID. It is not proof of completed extraction. This increment registers a pending `TEXT_EXTRACTION` intent; the Inngest consumer and actual page processing are subsequent work. It does not replace the canonical Inngest workflow architecture with a Mongo polling worker.
- `Ma semaine` reads source/job states locally while focused: pending transfer, sending, retry, missing/invalid source, and remotely sent with analysis pending. Retry clears local backoff for a valid pending PDF; missing/invalid originals are not retried blindly. New capture triggers ordinary background synchronization, and legacy PDFs are discovered by the normal sync cycle.
- No PDF parsing, commercial extraction or operation publication happens yet. Remote source/file persistence does not yet restore this source list through bootstrap on a fresh installation; commercial-source history and retrieval remain a later increment.

Verification covers SQLite migration from no-upload-job sources, one stable job, completion-response loss, explicit retry, permanent file errors, local retention, and no Mercalys verification for PDFs. API tests cover confirmation-before-registration, repeated completion, preserving job progress, store isolation and interrupted registration. Isolated MongoDB tests cover concurrent completion with one workflow and the new migration.

Native acceptance after merge/build:

1. Keep the previously imported PDF; do not delete or reimport it. Reconnect and synchronize.
2. In `Ma semaine`, confirm `Document envoyé` and `Analyse commerciale en attente`.
3. Import an already-downloaded PDF offline, close/reopen, then reconnect or choose `Envoyer le PDF` / `Réessayer l’envoi`.
4. A confirmed PDF remains listed and does not enter another upload cycle. Offers and page text are not expected yet.

## M5-T02 native acceptance

The pilot confirmed `Document envoyé` and the subordinate analysis-pending message for the retained weekly PDF. Its pending processing registration was verified in MongoDB. Transfer is accepted; a confirmed transfer is not an extracted or validated commercial plan.

## M5-T03 — Deterministic PDF pages and Inngest execution

- Inngest was provisioned and connected to the existing `fl-copilot` Vercel project on the Hobby (Free) plan after the user accepted Marketplace terms. `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` remain server-side; local environment snapshots and project linkage are ignored by Git.
- The signed `/api/inngest` endpoint is hosted by the existing Fastify/Vercel handler. Both keys are required to enable it. Unsigned execution is rejected; this endpoint uses Inngest signatures rather than mobile bearer authentication.
- Upload completion sends a source/store identity event with a stable ID after durable job registration. No PDF bytes, extracted text or commercial values are placed in event or step result payloads. A five-minute Inngest recovery schedule picks up previously registered or interrupted jobs, including the pilot's existing file.
- Event execution is limited to two concurrent extraction steps; recovery is limited to one coordinator. Each recovery pass selects at most five eligible sources. Processing uses a five-minute CAS lease, per-attempt token, and bounded backoff for temporary failures. Expired claims are recoverable; stale claims cannot overwrite newer job completion.
- `pdfjs-dist` 6.4.299 reads immutable original bytes remotely. The processor verifies the registered SHA-256 checksum and source/store identity before extraction. Limits are 100 MiB, 100 pages, 200,000 text characters and 20,000 spans per page, and 3,000,000 total text characters. Full raster rendering and OCR are not implemented here.
- Every page retains its one-based source number, text, dimensions, rotation and ordered text spans with original PDF transforms/direction. The text is source evidence, not normalized offers: prices, strict `<`, dates and column spans are not interpreted as business mechanics.
- A page without extractable text remains present with `NO_EXTRACTABLE_TEXT`. Scanned image text is not guessed. Encrypted, malformed, over-limit or mismatched sources receive explicit job error codes; temporary storage/database failures retain retryable intent.
- `commercialDocumentPages` is insert-only, with stable UUIDs retained on retries and unique source/parser/page identity enforced by Mongo migration 13. Parser identity is `pdfjs.text.v1.6.4.299`. Partial writes do not duplicate pages on recovery. Originals, source metadata and published business data are not modified.
- Successful jobs become `TEXT_READY` / `AI_EXTRACTION`, with page and text-page counts. This is the boundary for M5-T04; no AI extraction, offer publication or official KPI change occurs yet.

Verification: actual synthetic PDF parsing (literal text, French accents/euro symbols/decimal commas, geometry, blank page, invalid source and page limits); signed route rejection; strict TypeScript/lint/repository tests; real MongoDB concurrent claims, checksum failure, expired-lease restart, stable pages and transient retry; API and iOS/Android exports. The existing real-Atlas concurrent transaction test uses a 20-second budget rather than the unit-test default of five seconds.

Cloud acceptance remains pending after merging/deploying this PR: verify that Inngest registers both functions and processes the retained pilot PDF to `TEXT_READY`, or returns a specific source-reading error. No native UI change is included; the current app continues to say analysis pending because commercial offer extraction is still subsequent work. No reimport or native rebuild is required just to execute this backend stage.

## M5-T03 cloud acceptance

PR #85 was merged and production deployment readiness verified. The signed production Inngest endpoint reports authenticated cloud mode and two functions. The retained pilot PDF reached `TEXT_READY/AI_EXTRACTION` on its first attempt: eight pages, all with extractable text, 16,779 source characters, and no page warnings. Source references and immutable page rows were checked in MongoDB. No reimport or native rebuild was required.

## M5-T04 — Source-anchored commercial AI proposals

- AI SDK 7.0.130 uses the existing authorized Vercel AI Gateway/OIDC path. Default model `openai/gpt-6.1-sol` was verified against the live Gateway catalog; it is configurable for new documents through server-only `COMMERCIAL_PDF_AI_MODEL`. Receipt extraction is unchanged.
- A strict shared Zod schema, `commercial-draft.v1`, covers source operations, offers, execution/communication instructions, merchandising/TG, market signals, preorder/delivery windows and applicability. Fields retain literal raw values, confidence and cited page/span indices/quotes. Seller prices/customer benefits and supplier conditions remain distinct fields.
- Source pages are untrusted data, with no tools or execution side effects. System instructions forbid following embedded prompts, inventing missing fields/years, calculating prices, deduplicating offers, or declaring applicability/planning/execution. `store: false` is sent for the OpenAI provider; tracing/devtools capture is not enabled.
- Extraction runs per target page with bounded first-page/neighbour context, including PDF-space layout hints. Serialized context is capped at 160,000 characters, output at 6,000 tokens, and a model request at 45 seconds with SDK retries disabled. Blank-text pages do not call the model.
- Shared deterministic validation verifies actual cited page/span existence and literal quote/value support. Numeric/word boundaries prevent digits inside another price/identifier from becoming a proposed value. Unsupported blocks are omitted; unsupported/conflicting fields become null with confidence zero and explicit issues. Multiple source identifiers remain strings with leading zeroes. Dates lacking an explicit year remain raw with an uncertainty warning.
- Every retained block and field has `TO_VALIDATE`, regardless of model confidence. AI output is separate from canonical operations, offers, store applicability, planning, execution or official KPI. M5-T05 will normalize mechanisms; M5-T06 will reconcile repeated offers; M5-T07 will add review UI.
- Mongo migration 14 provides unique per-source/parser/schema/model/page cache identity. `commercialDocumentAiPages` stores raw model output separately from anchored proposals, source checksum, model/response/usage, context-page numbers and validation issues. Stable UUIDs survive retries. Completed page proposals are reused without another model call; lost/incomplete calls before persistence may be repeated.
- Per-page CAS leases last 90 seconds; stale claims cannot overwrite newer results. Temporary failures remain retryable, permanent schema/configuration errors stop, and no page makes more than four provider attempts. Configuration/model identity is frozen for the document; changes do not silently mix models into old drafts.
- Inngest adds document/page AI functions, with two concurrent page executions. Page text completion emits an identity-only event, and the five-minute recovery schedule picks up existing text-ready sources. Durable step results contain counts/status only, never PDF text, quotes, raw output or commercial values. Full completion becomes `TO_VALIDATE/DRAFT_REVIEW`; source-reading/AI failures retain specific server codes.

Verification includes source/citation/number-boundary tests, preserved `<`/comma prices/identifiers, duplicate-field guards and omitted-context limits. Real MongoDB tests cover concurrent page claims, completed-cache reuse, blank-page skipping, schema rejection, transient recovery, stable identity, store scope and absence of operational publication. API and native exports pass. Real Atlas auth/transaction round trips use a 20-second test timeout.

A bounded live test on the first pilot page used the authorized Gateway access: model `openai/gpt-6.1-sol`, 15,080 input and 1,376 output tokens, about 21 seconds, six raw blocks and five anchored blocks. One block was rejected by source checks; date uncertainty remained flagged. It wrote no production draft or business record; raw/validated results stayed in an ignored temporary file.

Full-document cloud execution is pending after deploying this PR. Native review/synchronization of draft proposals is not implemented yet; the current app still displays analysis pending. This is a backend increment, so no iPhone rebuild or reimport is needed to trigger the existing PDF. The future review screen must read cached local draft data, not depend on a synchronous remote request.
