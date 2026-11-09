# M8 — reopen retained Mercalys history, 9 November 2026

## Owner report and read-only evidence

Build43 displays LOCAL_FILE_MISSING while opening `08112026.xlsx` from an old batch. The file-review screen unconditionally reads the batch member URI before it can show its duplicate/published result. The batch location lookup only knows explicit restoration history; an unavailable batch copy therefore blocks consultation even when another published copy or the canonical original can be recovered.

Read-only Atlas queries find one matching source for the pilot store, a confirmed source/upload of 22,368 bytes with matching checksum and a recorded Blob etag, and 128 source records still PUBLISHED. This is evidence of registration/publication, not a fresh Blob HEAD/download or a diagnosis of what removed/invalidated the phone path. No live record, file, job or business number was modified. The screenshot is a native local-read failure, not evidence of a signed-URL permission rejection.

## Reuse and preservation

Keep the normal retained read first. Only LOCAL_FILE_MISSING on a known checksum permits a scoped SQLite lookup by store/checksum and supported Mercalys source type, excluding deleted documents. Try the already-published local URI next; its absence permits on-demand recovery through the existing SourceOriginalTransfer and canonical manifest/download APIs. Expose that existing coalesced, owner-scoped transfer through SyncProvider's current original facade; preserve its checks before and after recovery. No extra provider, endpoint, migration, directory search by filename, business publication or full synchronization/AI pipeline.

The existing file-review checksum guard still runs before parsing or consulting the publication repository, including after recovery. Canonical recovery retains its own metadata/size/hash/ownership checks, immutable install, original cache transaction and refusal to replace pending local work. Subsequent opens can use the retained published URI offline. Recovery failures keep a safe, actionable message and an explicit “Réessayer la lecture” action; opening an old file does not republish its lines.

## Validation and delivery

177 tests in eight suites pass, none skipped: real SQLite schema62 source selection and unchanged business rows/empty Outbox, native path relocation, mounted duplicate/history/retry and checksum rejection, canonical source transfer/files, batch restoration, source upload recovery and the sync pipeline. Both new mounted cases fail against the prior screen. The first retry fixture inherited a previous test's rejected continuation mock; resetting that fixture restores test isolation without changing continuation behavior. Workspace typecheck (10 projects), targeted lint/format and full exact-head push/PR checks remain required before merge.

This is a native JavaScript fix; the unchanged API release remains compatible. Group one iPhone build after checks and record its signed identity. Do not claim the owner's installed build43 is fixed by the preceding API-only releases. Device recipe on the new binary: reopen `08112026.xlsx` with connectivity, verify the prior published/read-only result and retained original; reopen the same file offline after the copy is retained. Do not reimport, republish, reset/uninstall the app or delete its files to perform this test. Actual phone recovery remains pending until the owner tests it.
