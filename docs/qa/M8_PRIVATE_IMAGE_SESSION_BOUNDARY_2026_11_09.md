# M8 T06 — private image response authority, 9 November 2026

## Reproduced gap

The private image routes authorized the caller before file preparation. The visual service already rechecked live store membership, approval and immutable file binding, but it does not own the bearer session. A logout, verified replacement login or access expiry while reading an image could therefore still return its bytes. Upload initialization/completion and manifests had the same HTTP response boundary; a manager losing that role while preparing an upload result could still receive it.

Sixteen controlled route cases return HTTP 200 against the prior runtime after session/membership/manager-role withdrawal. Four additional real-auth cases on disposable transactional Mongo reproduce returned bytes after logout, replacement login, membership removal and access expiry. These are test fixtures, not evidence of a production incident. The selected negative real-auth run skips its thirteen unrelated cases by name; the final positive suite runs all cases without skips.

## Bounded correction

Reuse the existing route authorization function immediately after each awaited file operation and before returning upload capabilities, manifests or bytes. Writers must still be managers at that boundary; authorized staff retain read access. Manifest and upload JSON responses explicitly use `Cache-Control: private, no-store`, matching the existing binary responses and source-original route convention. No new service, token, model, dependency, collection, migration, native code or AI request.

Keep existing service checks for store/owner isolation, approval, MIME/size/hash binding, transparent preview derivation and canonical idempotent completion. Do not trust a caller-supplied object key. A final refusal does not undo a file already stored or a transaction already committed; retry follows the existing completion path and keeps the original. Previously delivered bytes or already-issued expiring Blob capabilities cannot be recalled by this final response check. This is an additional current-session boundary, not a globally atomic permission/HTTP-send guarantee or a complete T06 penetration test.

## Verification and delivery

85 tests in ten suites pass, none skipped, including actual transactional Mongo auth/visual/original recovery fixtures. Existing private source signing/rechecking, visual MIME normalization, approval/store isolation and completed-upload retries remain covered. Workspace types, lint, formatting and complete exact-head push/PR checks remain required before merge. Release records distinguish these checks, merge and API delivery. This server-only change is compatible with build43 and needs no new paid iPhone build or repeated owner logout recipe.

The owner accepts the supplied build43 offline logout/previews/reconnection/new-notification recipe. Keep that accepted case closed. Wider M8, server backup/restore and the remainder of the security review remain separate; the Atlas subscription remains owner-deferred.
