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
