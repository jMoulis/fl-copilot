# M7 — réalisation d’un conseil du chat (PR 257)

Code proof is separate from deployment and iPhone acceptance. No paid model call or EAS build is part of this lot. API migration/capability must precede SQLite 48 / the grouped compatible native delivery.

## Automated acceptance

- Native confirmation creates a separate private statement, without a prior Accept choice and without a commercial-plan task. Initially preparing a card alone creates no execution; repeat confirmation of the same card is idempotent.
- Real SQLite restart retains the statement and unsent command. Atomic enqueue failure/cancellation leave no partial record. Owner/permission/card sync/source visibility and snapshot identity are checked before save. Failed-command diagnostics are private.
- Old acknowledgement/pull cannot discard a pending withdrawal. Withdrawal keeps source/action/actuals/notes and cannot reactivate from the original card.
- Transactional Mongo produces a valid owned TOOL atomically through the real turn producer, with mock provider generation and replay. No execution or decision is inserted during preparation.
- Actual Outbox/MobileSyncService → Mongo → second SQLite restore and withdrawal propagation pass. Same-card confirmations coalesce with the first confirmation time. Legacy bootstrap/pull exclude the new entity; another owner sees no record or cached private response. Capacity preserves local intent without evicting history. Read pages use owned UUID cursors, include withdrawn history and never count physical actions.
- SDK tools are capability-gated and preserve the read budget; request/response scope mismatches become unavailable results, without leaking raw internal errors. Transport is mocked. Client query flags are appended, independent of commercial execution flags.

Local verification: `pnpm check` passed 1,885 tests (database-dependent suites skipped without their environment), and the dedicated disposable transactional Mongo suite passed seven cases. Native iPhone and real-model dialogue acceptance remain pending.

## Pending grouped iPhone acceptance

1. In a chat with an earlier suggestion, say what you actually did and ask to note it. Check source/action and nullable real details in the card. No preliminary acceptance or invented price/date/unit.
2. Check the confirmation, save offline, close/reopen, reconnect and synchronize. Verify the same statement on another compatible device.
3. Ask which actions you reported. It should cite private statements and distinguish realization, advice, decisions and observed figures, with concise coverage qualifications.
4. Withdraw using the original active card and its separate unchecked confirmation. Verify both devices retain the original details and show withdrawal. No financial adjustment.
5. Test revoked access, hidden source, scope changes while loading/saving, and retry of the same card. Preserve local work and avoid duplicate statements or cross-account content.

Corrections currently require explicit withdrawal and a newly reviewed statement; withdrawing/editing from a new chat or archived original card remains open. These are private follow-up statements, not shared operational-store tasks, formal recommendation eligibility or proof of causal impact.

Seven workstreams: 1 ongoing, 2 code ready, 3 ongoing, 4 ongoing, 5 ongoing (this increment code ready), 6 not started, 7 ongoing. No change to recorded API/iPhone delivery or user acceptance.
