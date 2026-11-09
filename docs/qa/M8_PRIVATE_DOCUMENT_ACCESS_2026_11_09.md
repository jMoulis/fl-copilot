# M8 T06 — remaining private document response boundaries, 9 November 2026

## Review and prior-runtime reproductions

After PR482, review the remaining private file HTTP paths as one batch: source upload init/completion, legacy commercial original links and layout illustration manifests/streams. The canonical source-original service already rechecks its document binding, expiry and supplied authorization callback; preserve that path.

Sixteen route cases reproduce successful responses after session or store-membership withdrawal during file preparation, using controlled auth/file/signing ports. Five additional cases on real disposable Mongo reproduce the legacy commercial signer returning a source deleted before lookup, a source withdrawn during signing, a replaced object path, a link already expired during signing, or a non-private URL. No production exploit, real user logout, source mutation or provider call is claimed.

## Correction using existing boundaries

Recheck the existing store authorizer after awaited upload work and legacy link creation, and immediately before returning an illustration manifest or starting its verified stream. Source upload and legacy link responses use private/no-store like current original/image endpoints. No new authorizer, middleware, polling task, permission model, entity, schema migration, native code or AI request.

The legacy commercial link preserves its response contract and registered-object path (including old internally registered paths). Filter out deleted sources, reread the same scoped confirmed PDF after signing, reject path/filename changes and elapsed expiry, and reuse the canonical private-original URL validator. No metadata is invented and no original is rewritten. Existing immutable Blob upload constraints, source/photo ownership, byte/MIME/hash verification, approval checks and idempotent completion remain in their existing services.

The last check does not recall previously delivered bytes, interrupt an HTTP stream already started, revoke a capability already issued before withdrawal, or undo accepted file work committed before the response. Existing signed links remain short-lived. A refused completion response can be retried through the existing stable upload/source IDs; it is not permission to delete retained files or start a new business publication.

## Verification and delivery

104 tests across eleven suites pass, none skipped. Include actual transactional Mongo for commercial link changes, upload acknowledgements, original recovery, illustration persistence and auth/session races; native/Blob/auth route ports are controlled where stated. The new link cases insert only source fixtures: creating unrelated PDF-processing jobs filled the bounded pending page and caused two pre-existing processor tests to skip their own targets during the first run. Correcting fixture isolation restores those tests; no processor behavior or read limit changed. The selected five-case negative run skips seven unselected cases by name, distinct from the complete positive run.

Workspace typecheck, changed-file lint/format and both exact-head checks remain required before merge. Delivery identities and API health/refusal probes are recorded separately in the release ledger. This API-only increment needs no new paid iPhone build and no repeat of the owner-accepted build43 logout recipe. Broader M8/security qualification and the owner-deferred Atlas backup rehearsal remain separate.
