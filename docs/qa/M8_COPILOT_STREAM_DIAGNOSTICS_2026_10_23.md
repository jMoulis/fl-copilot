# Copilot stream failure diagnosis — 23 October 2026

The owner reports a new Copilot Sentry alert and requests a grouped native build. Read-only Sentry inspection identifies `FRUITS-ET-LEGUMES-API-6` in production, latest event `b16eab6805e9416abe745665da4cd6df` at 11:35:28 UTC. Existing production Vercel logs show three `COPILOT_STREAM_FAILED` entries between 11:34 and 11:36 UTC on deployment `dpl_H5hDjvA8aRjzHm6oves5RSvmxUfh`. They retain no original failure reason. EventEmitter listener warnings at these times are not proof of the stream failure cause. No private conversation or provider payload was retrieved. Full Sentry export was refused by automatic review; inspection proceeded through explicitly selected safe fields.

## Narrow change

Keep the existing stream error behavior, cancellation/authorization exclusions, final reply identity, transaction, server lease and retry policy. Classify unexpected failures only into a fixed list of application error codes or broad validation/database/type/range families; every other value maps to `UNEXPECTED`. Send that reason as a server log field and Sentry `error_reason` tag alongside the unchanged general code. Never retain thrown text, cause chains, schema inputs/paths, stack variables, database query content, request data or provider bodies. No reason is sent to the mobile stream.

This is a diagnostic correction, not a demonstrated fix for the historical exception. The next actual occurrence must identify its reason before claiming resolution. No provider request is made to manufacture a production failure.

## Validation and delivery

Unit cases cover the closed classification, error families, non-error input and prefix/spoof rejection. Route tests exercise post-progress oversized-answer and schema failures, verify the log/Sentry reason, ensure private input never reaches either sink, preserve the generic client failure and retain cancellation exclusions. Existing streamed HTTP/auth/cancellation tests remain.

Both exact-head push and PR foundation checks must pass before merge. Release the API separately from the already-requested native build: staging/internal iOS build 10 (`d512fe40-3b5f-4eee-aaae-44861b8b5042`) is based on exact master `0aa99ea133bf90b2dde9c86a59b6f4d473fd84c9`, which includes PR 324 automatic native recovery and PR 325 compatible analytics. Build completion, API diagnostic deployment, actual historical-error resolution and owner acceptance are separate states. No second paid EAS build is needed for this server-only change.
