# M8 — typed native original opening, 5 November 2026

## Reproduced boundary

The isolated restore rehearsal preserved `semaine45.pdf` bytes, size and SHA-256, but iOS received its retained email URL ending in `.bin` and presented an archive instead of a PDF. Email originals are deliberately unclassified immutable bytes. Their later canonical PDF metadata does not rename that retained path. The installed Expo Sharing 57.0.24 iOS implementation passes the file URL directly to `UIActivityViewController`; setting only the Android MIME option does not change that URL.

## Correction

Reuse `nativeSourceOriginalFiles.existing` and the existing private `source-originals/store/actor/source/original-checksum.extension` convention. Verify the retained original against the canonical manifest (size, SHA-256 and content header). Only when its suffix is unsuitable, copy to a unique private partial file, verify it, then await native relocation to the typed immutable path. Existing typed copies are verified, never overwritten. The extension comes from the supported canonical MIME, not the sender filename. Original bytes, email path, source metadata and business commands stay unchanged by this local read.

Partial-copy or verification/move failure deletes only its own disposable partial file and retains the original. No whole-file buffer, new dependency/schema/API, import publication, AI call or provider spending is introduced. Scope/record lifetime checks still run in the canonical transfer service after asynchronous native work.

## Automated evidence

The new classified-email PDF assertion fails against the previous implementation: its proof returns `.bin`. After correction, **112 tests across four suites pass, zero skips**: original files, original transfer, original hash and real-SQLite email handoff. Additional regression coverage qualifies immutable original preservation, untrusted filename exclusion, typed-copy reuse, deferred native copy and move, copy failure, changed bytes, move failure and refusal to overwrite an altered typed copy. Existing raw email retention remains `.bin` until actual classification; existing correctly typed originals keep their paths.

Workspace typecheck, targeted lint and formatting pass. Native confirmation and grouped delivery are recorded separately; automated proof does not certify iOS preview by itself.

## Native and delivery boundary

Use the existing authenticated iPhone 17 Pro simulator with the current-source Metro on port 8082 and the retained PDF. Open Actions → Documents commerciaux → Consulter le PDF original → Ouvrir ou partager le fichier, inspect the iOS file type and cancel without sending. Native check **passes** on the retained `semaine45.pdf`: iOS shows **Document PDF · 2 Mo**, a rendered thumbnail and an Aperçu action. Opening Aperçu renders the actual think-sheet pages and their readable text. Read-only file/SQLite readback confirms the retained `.bin` is unchanged and CONFIRMED, the `.pdf` copy has identical size and canonical SHA-256, and the Outbox remains empty. No new upload/import/chat message or sharing transmission is submitted. Private screenshots and readback are retained under `artifacts/2026-11-05-m8-typed-original/` outside Git. This establishes simulator behavior on current-source Expo Go; it does not certify installation of a release binary on the owner phone. No new paid binary or API release is required for this local-source check. Owner phone acceptance requires a later identified grouped binary.

[M8 current scope](../progress/M8_HARDENING_STATUS.md) retains queued business-command recovery and production backup/restore after this focused correction. Android and dedicated accessibility qualification remain deferred to M9.
