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
