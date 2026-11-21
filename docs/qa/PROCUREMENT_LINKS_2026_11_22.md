# Reviewed procurement Product links

22 November 2026. Step 3(a), following PR 560 (merged). Code only; no deployment,
native opt-in, build, actual store edits or reset. Enrichment/UI remain open.

## Evidence

The real reference export contains ITM8 rather than the previous ITM header.
Both exact aliases now parse; conflicting aliases reject. Its 231 explicit PLUs
are numeric safe integers with General format: preserve those numeric values;
never invent zeroes or suffixes. A companion identity parser retains indexed
ITM/EAN/label/PLU facts without coupling them to PA availability. Financial source
normalization is unchanged. Original checksums and facts are verified again by
the API, together with confirmed upload metadata and configured PDV.

A confirmation retains existing Product IDs. Both validated source code owners
must still resolve to the same non-inactive Product. PLU/constructed ITM proposals
require explicit review, contradictions require manual reason, and a manual choice
cannot bypass source/code ownership checks. Withdrawing retains evidence/history.

One immutable review event and its full decision set are the canonical sync unit;
current link rows are a projection. SQLite 70 and Mongo 65, expected link versions,
transactional all-or-nothing writes, retries/idempotency and history pull are used.
Overlapping queued reviews serialize by link IDs. Newer pending edits survive
older acknowledgments/history. A distinct capability prevents writes against an
older API. Runtime remains disabled until UI and compatible release qualification.

## Real-file isolated rehearsal

Private script/result: maintenance/procurement-links-2026-11-22/verify.mts and
result.json, outside git. Local SQLite and disposable local Mongo replica set;
source bytes read from retained attachments through an injected private reader.
No production credentials or live Blob writes. Products are isolated fixture
identities built from source references, not an actual store rebuild.

- 1,226 financial rows / zero issues; 1,226 identity rows / zero issues.
- 231 explicit PLUs; 88 PLU matches, 333 constructed ITM candidates, one review,
  62 unmatched. These are proposals, not owner-confirmed production links.
- Simulated explicit selection: 421 links, one 410,705-byte review command.
- Server APPLIED: 421 links, one immutable review, one original read for the lot.
- Product count remains 1,226; zero PA observations created.
- Recorded local confirmation ~185 ms, server ~256 ms on this fixture/run; these
  are diagnostics, not device/network performance guarantees.

Focused automated tests cover malformed/formula/zero-preserving PLUs, old/new
header parity, duplicate headers, current owner ambiguity, required manual reason,
immutable revisions, atomic scope rollback, whole-batch rollback, second-device
replay, withdrawal, older ACK/history preserving newer edits, actor queue scope,
ordered reviews, API parent retry/replay, byte forgery, changed code ownership,
expected-version conflicts and old API adoption/rollback. Existing snapshot,
Outbox, sync, migration and financial parser regressions are included.

Exact verification counts and exact-head CI are recorded in the PR. No iPhone
acceptance is claimed. Next: enrichment proposals and approved mockups before UI,
including manual and conflict review; then reference → JSON → sales/waste ZIP
reconstruction and concrete final reset approval. No financial history rewrite.
