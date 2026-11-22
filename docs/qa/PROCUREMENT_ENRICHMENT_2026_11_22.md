# Read-only procurement enrichment preview

22 November 2026, after merged PR 561. Step 3(b) implements proposals, not an
application/persistence path. No new migration, sync entity, API route, native
screen, source activation, AI request, build, deployment or production mutation.

## Implemented and checked

Shared Domain function accepts an existing Product and active link/source pairs.
It checks store/Product/snapshot identity/checksum and carries Product/link versions
plus immutable original reference evidence. It never writes or selects a PA.
Known attributes are preserved; disagreement is explicit. Multiple linked source
references combine evidence deterministically, independently of input order.

Reference label markers can propose retail nature. One unambiguous stated mass or
count can propose content alongside a retail packaging marker. Supplier labels,
packagingQuantity, source weight and priceUnit are separate context and cannot
populate retail attributes. Multipacks, bonuses, multiple amounts, contradictory
nature and incomplete labels retain uncertainty. Complete Petit Prix evidence can
propose true; missing evidence never proposes false. No inferred category or
analytic quantity unit, including when PIECE or source kg appears in the label.

46 targeted tests across four suites passed: enrichment, reviewed links,
crosswalk and JSON parsing. All ten workspace typechecks pass. Exact-head CI
is required before merge; its final results are recorded in the PR.

## Real-file read-only fixture

Private evidence lives outside git at
maintenance/procurement-enrichment-2026-11-22/{verify.mts,result.json,proposals.json}.
The source files are the retained 21 November Mercalys reference and full ordering
JSON. Fixture Products start with unknown attributes and the previously identified
421 unambiguous identity proposals are simulated as confirmed links, not changed
in the owner's store. This does not validate the remaining 63 identities.

- Nature: 194 proposals, 227 unknown.
- Packaging content: 82 proposals, 121 review, 218 unknown.
- Petit Prix: 16 proposals, 3 review, 402 unknown.
- Category and analytic unit: all 421 remain unknown in these blank fixtures.
- Zero application writes; supplier quotes and source originals unchanged.

Counts overlap by field, not distinct Product counts. Label-based proposals are
not verified physical packaging or a final reference cleanup. The existing Product
values/conflicts and historical quantity meaning need real review at integration.

## Next gate

Review the import/Product prototype in this conversation before native integration.
One explicit confirmation should apply ready choices, with exceptions deferrable;
source rows remain traceable and sources/links/Product versions are rechecked.
Existing Product/Outbox writers own any accepted edits. Keep navigation context,
swipeable sheets and immutable history; never silently reinterpret earlier sales.
Empty-base reference → JSON → sales/waste ZIP replay and final concrete owner reset
approval remain separate. No iPhone acceptance is claimed by this increment.
