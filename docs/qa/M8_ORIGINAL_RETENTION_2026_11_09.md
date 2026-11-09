# M8 — original retention on uncertain Mercalys publication, 9 November 2026

## Storage audit and bounded finding

The existing product-image cache is cleaned after synchronization with a 64 MiB soft budget. Its canonical planner protects unuploaded/dirty assets, absent or revoked remote proofs, pinned/offline-required copies and shared paths. Protected files can exceed the budget. The separate derived layout cache reserves a 64 MiB budget, protects retained/displayed results and removes only exact account/store-bound downloaded variants. Neither is a global device-storage limit.

Mercalys originals can be marked CLEANUP_ELIGIBLE after remote confirmation; this audit finds no automatic consumer deleting those source files. Original captures and documents are retained. Do not introduce automatic original purging while treating those two cache budgets as sufficient protection or a verified cloud backup. T05's broader retention and native storage qualification, and owner-deferred T12, remain open.

The single-file Mercalys import screen deletes its newly created durable XLSX copy whenever publication rejects. Successful publication normally relinquishes this cleanup reference before later work. However, an uncertain transaction completion can reject after COMMIT: the failure path then removes a file already owned by source_document/local_file rows and a pending upload. A cleanup filesystem error also escapes before the original publication error reaches the screen.

This is a controlled reproduced risk, not an established explanation of a historical production incident or proof of a particular Expo bridge failure.

## Correction within existing services

Reuse the existing restoration repository's exact reference lookup against local_files, source_documents and source_original_restorations. Export that lookup from the same module and delegate the existing method to it; there is one query, no new retention service or database model. Before failed-import cleanup, preserve any referenced copy. If the ownership read fails, retain the copy conservatively. Delete only the newly created unreferenced copy; a deletion error must preserve the original publication error for the UI.

Uncertain publication remains an error, not a fabricated success. Existing publication transactions, stable IDs, upload jobs, reconciliation and exact-duplicate refusal are unchanged. A later retry can use that refusal rather than double-publish. No business data, Outbox commands, original files or backups are deleted by the test work. No API change, AI instruction/tool/call, dependency, schema or new recovery writer.

## Verification and limits

The prior mounted screen fails the two original-preservation cases and allows a cleanup error to escape. Four mounted cases now cover committed ownership, failed ownership read, rolled-back/unreferenced cleanup and failed deletion while retaining the publication error. The fake filesystem now tracks actual create/delete state rather than always reporting a missing file.

A real SQLite fixture commits a canonical publication and then deliberately rejects the transaction acknowledgement. The reference lookup still finds its original before and after database reopen, the upload remains PENDING, and retry is refused as an exact duplicate with one sales observation. This tests application/storage boundaries with a controlled acknowledgement fault; it is not a physical iPhone fault injection.

**154 tests across eight suites pass, zero skips**, covering these paths, original restoration, typed originals, visual-cache retention, native storage, transfer and illustration cache. Ten-project strict types, targeted lint, formatting and local iOS export pass. Exact-head CI, merge and grouped native delivery are tracked separately. Current build40 does not acquire this native code from an API release. Do not request a dangerous production commit-failure test or repeat the accepted PDF/offline recipes.
