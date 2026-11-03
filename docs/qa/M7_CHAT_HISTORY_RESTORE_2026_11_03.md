# M7 — recover historical chat cards, 3 November 2026

## Reproduced gap

The initial chat bootstrap deliberately contains only the latest 50 messages across the owner/store, but the mobile controller only paged SQLite thereafter. A conversation restored on another installation could therefore have a title/recent messages without its older preparation card. The server already provides the private paginated history endpoint; its normal message mode was only used to recover a pending reply, not to restore visible chat history. This is a demonstrated partial-history gap, not proof that every previously unobserved card had this sole cause.

## Bounded reuse

Keep local opening/draft/send independent of the network. On opening the selected conversation, fetch one bounded latest page in the background using the existing authenticated API and source-capable client. Continue through the existing messages-previous action; the remote cursor is independent of the oldest cached message so gaps can be filled. No whole-account download, background polling, AI request, new endpoint, table, migration, workflow or model tool.

Restore through the canonical message applier in one SQLite transaction. Validate owner/store/conversation for the complete page before writing, retain current deletion metadata and refuse archived/deleted parents. Preserve local dirty records, immutable message identity, numerical citations and drafts. Cancel an obsolete initial request; ignore late UI results after a conversation/account change. Cached older pages remain readable when remote retrieval fails. The server paging cursor stays transient: reopening starts from the latest bounded page; already restored messages remain local and are deduplicated by their canonical IDs.

A recovered card may have no device-local confirmation receipt even though its week already exists. Keep the original preview READY/STALE/COMPLETED rules and confirmation guards, but expose the existing read-only week link when the canonical local preparation exists. Opening it shows the current saved choices for that week; it does not claim the historical proposal was applied on this installation, reconstruct an approval or create another plan. Existing runtime and mounted card tests cover the stale-card link without confirmation.

## Verification

Eight isolated SQLite/controller regression tests cover a valid preparation card outside the bootstrap excerpt, 126 messages in bounded pages, no Outbox intents, draft retention, repeat reads, offline local paging, owner/conversation rejection, cancellation, deletion retention, invalid cursors, late archive and gaps between old cache and recent sync. Existing repository/chat/card tests are retained. Full check and exact-head CI results are recorded in the release ledger.

The native Mac is locked during this increment, so actual simulator gestures/rendering are not claimed. The test card is a controlled fixture and is never confirmed or written to the real store. No live model call, production mutation or actual store execution.

## Delivery and focused iPhone acceptance

Mobile-only; the deployed API already exposes the required endpoint. Build 23 does not contain this correction. After exact-head CI/merge/master validation, use the owner-authorized more frequent staging iPhone cadence and record the new build identity. Availability is not acceptance.

1. Open the earlier commercial-planning conversation. Load previous messages if needed: its actual saved preparation card should become reachable; open the saved week without creating another plan.
2. Leave/reopen the discussion: no duplicate messages or cards, and a typed draft remains intact.
3. After loading that history, temporarily disconnect and reopen it: cached messages/card remain readable. Reconnect and check previous-page retrieval resumes.

The prior four weekly UX journeys remain accepted; do not repeat them. This advances M7 workstreams 5/7; **1/3/4/5/6/7 ongoing, 2 code ready**. The real advice → explicit choice → actual execution → useful review pilot remains open. M0–M6 functional iPhone baseline stays closed; implantation depth and broader UX remain deferred.
