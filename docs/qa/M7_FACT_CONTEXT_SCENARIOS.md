# M7 — revérification des lectures d’un conseil (PR 259)

Active workstream: **5**. Code evidence is separate from API delivery and iPhone acceptance. This increment covers changed captured reads, not complete operational eligibility.

## Automated acceptance

- Server-produced, validated and budget-accepted tool results create bounded read descriptors/digests; no trace input is accepted from model output or client sync. Duplicate cached reads keep one snapshot and preserve the original period metric order. Unsupported/failed/oversized reads make coverage incomplete.
- An owned assistant reply and immutable private provenance commit atomically. Retry returns one reply/context. Invalid metadata rolls back reply and sync event; no orphan provenance. Existing decisions/actions are unchanged.
- Actual canonical period, daily, product-change, catalogue, field-event and saved-plan readers replay. Changed data yields STALE with exact bounded reader parameters; missing/failed/old/incomplete data never defaults to current. Source archive/masking/foreign scope prevents disclosure; source drift during replay invalidates the result.
- Fresh tracking on changed captured reads produces no card. A historical choice saved offline before a source change is preserved and synchronizes as intent through the existing repository/Outbox; it creates no execution.
- The SDK tool stays capability-gated with the existing read/input budget, sanitizes mismatched/unavailable responses and renders progress/source links through existing chat behavior. Transport is mocked; no paid model call or EAS build.

Local validation: `pnpm check` passes 1,925 tests (476 environment-dependent cases skipped locally). Disposable transactional Mongo suites pass 25 cases, including each replayed canonical reader and historical offline choice preservation. Formatting and both exact-head CI events must pass before merge.

## Pending grouped pilot acceptance

1. Ask for sourced advice based on published figures, retain a decision and describe any actual realization separately.
2. Publish a correction affecting those figures; ask whether the advice still applies. Expect a concise “À recalculer”, refreshed figures and a new suggestion, with prior intent preserved.
3. Revisit an older response without provenance. Expect a short qualification, never a blanket validity claim or invented facts.
4. Try a source with missing data or a document/unsupported dependency. Known changed reads can still be flagged, but remaining coverage stays unverified. No unnecessary reimport or generic debug dump.
5. Check saved choices and realizations after offline/restart/reconnection; fact checks never silently execute or erase them.

Fingerprints cover the whole reply's recorded reads conservatively. Unchanged reads do not establish exact quote relevance, current stock/field conditions, correctness of user hypotheses, source-document completeness, causal effect or formal eligibility. Source archive/masking retains history while preventing a fresh check. API Mongo migration 42 is required; no new native migration or dependency. Deployment and dialogue/iPhone acceptance remain grouped.

Seven workstreams: 1 ongoing; 2 code ready; 3 ongoing; 4 ongoing; 5 ongoing; 6 not started; 7 ongoing.
