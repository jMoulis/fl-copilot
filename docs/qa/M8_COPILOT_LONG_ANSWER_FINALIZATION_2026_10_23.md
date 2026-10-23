# Copilot long-answer finalization — 23 October 2026

## Confirmed cause

Fresh read-only Sentry inspection identifies `FRUITS-ET-LEGUMES-API-6`, event `9497519d1deb43a0871834c0ebc07aa6` at 13:06:48 UTC, production `error_reason=ANSWER_TEXT_TOO_LARGE`. The stream displayed provisional text, but final reply rendering rejected the fully expanded source links above the 16,000-character message allowance. This is a server finalization failure, not evidence of an offline recovery or Inngest defect. No private conversation/provider content was read and no paid provider request was used.

A synthetic 24-row, grounded table reproduces the overflow through the former inline renderer. Its complete source snapshots remain valid; the excessive size comes from their percent-encoded inclusion in conversational text. The new regression runs generation, rendering and canonical message validation without a fallback or extra generation.

## Narrow correction

Reuse the native source validator as a shared domain contract. If an expanded answer exceeds the existing readable-message allowance, retain the full source snapshots once in `answerSources` and use message-local `ref` links. Deduplicate identical snapshots. Keep the existing analytical destination table, exact values, qualifications, source IDs, original-file references and model-grounding checks. No source truncation or model instruction is introduced. Both provisional and final rendering use the same bounded representation; provisional citations needing the table become resolvable when the final canonical message arrives.

The source table has at most 96 snapshots and a conservative 512 KiB escaped-JSON allowance, independent of the readable text. The stream decoder accepts individual final frames up to 1 MiB, consumes complete coalesced lines before checking the residual buffer and retains its 4 MiB total-stream limit, scope checks, cancellation and required final result. Partial text is never persisted as a completed reply.

Canonical response construction is independent of client presentation capabilities. Version 2 of the existing analytical-presentation header includes source snapshots on turn/history/bootstrap/pull. Versions 0/1 retain readable canonical text and the metadata they understand; compact source links require the updated renderer. The server must be released before native acceptance. No new independent capability flag, retry loop, queue, business mutation or provider is added.

SQLite JSON persistence needs no migration. Enrichment from an older projection may restore source metadata; an older replay cannot erase it, and conflicting metadata, text or ownership is rejected. Source-presentation metadata is excluded from business-message digests alongside analytical destinations and from model input. Exact canonical reply content remains immutable on the server. TOOL builders do not inherit assistant presentation tables.

## Verification and release gates

- Render a table whose inline sources exceed 16k; preserve all rows, numeric values, source snapshots and analytical targets in compact form.
- Preserve shared citations without duplicating their snapshots. Reject malformed/missing indices, invalid or excessive tables and source metadata on USER/TOOL messages.
- Receive coalesced progress plus a final source table over the former 256k buffer limit; enforce the new per-frame bound and existing total/terminal/scope rules.
- Commit the generated long answer to transactional test MongoDB, replay the same reply without a second provider call and read the same text through legacy/current private history.
- Upgrade a projected message locally, reject altered source content/owner/text, replay the older projection, reopen file-backed SQLite and open the preserved citation without an Outbox mutation.
- Preserve existing auth, stream failure, cancellation, restart, idempotency and recommendation/action tests.

Run structure/lint/strict types/format/full local tests and both exact-head push/PR CI before merge. Record API staging/public health, source SHA, grouped EAS build and owner acceptance separately. Device acceptance must cover a long comparative answer ending without a late error, working Source/Analyses links, horizontal table scroll and conversation reopen. No claim of V1/M7 completion follows.
