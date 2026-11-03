# M7 — descriptive review of an offer-free TG, 3 November 2026

## Delivery checkpoint

Released to production in API source `fe57a80aae4797b560671334d99eb32fd57bbc79` (deployment `dpl_BDpxj1wyroSpc7NmDbDxoPG1peWR`). The historical delivery paragraph below describes the pre-release boundary. Real-model/pilot acceptance remains open; no native rebuild is needed for this server behavior.

## Reproduced mismatch

Qualitative commercial plans can save and confirm a TG theme without inventing an offer or product allocation. The existing `commercial_action_review` still required a matching saved offer for every task, so the canonical theme-only TG fixture returned PRODUCT_NOT_IN_TASK. Six new boundary cases fail before the correction and pass after it. This is a follow-through gap in the existing decision/execution/review loop, not a new planning module.

## Bounded correction

Reuse the existing read-only task review. Only a current INSTALL_TG whose exact placement has a nonempty theme and **zero offer IDs** permits a product selected as analytical context. The product is still resolved by the canonical store-scoped period reader. The primary source explicitly says this selection does not prove presence on the TG and saves no product allocation.

For that case, during must lie within the saved plan week; an outside window returns PERIOD_OUTSIDE_PLAN without KPI/event reads. The week is planned context, never an inferred physical installation period. Offer-backed TG/signage keeps its original associated-product and exact-offer-period checks. All windows remain explicit, ordered, bounded and not future; before/optional after comparisons keep the shared calculations, coverage and unit semantics.

Current task checksum/revision, declaration matching, private-decision ownership/version/source validation and concurrent rereads remain intact. Missing/TODO declarations stay unknown/unperformed; selecting a product neither marks a task DONE nor claims causality. No task, decision, plan, score, source or Outbox mutation. No new input field, business entity, migration, tool, agent, provider or instruction block. The existing tool description is replaced and shortened from 1,062 to 1,044 characters; this is not a billed-token or cost-saving measurement.

## Verification

- 62 targeted tests across three files, zero skips, including actual isolated MongoDB readers. Controlled database fixtures use the real canonical builder/checklist to create offer-free plans; no source offer/product association is fabricated.
- Real Mongo verifies a theme-only TG with no execution declaration, exact numerical evidence, recorded events, unchanged plan and zero new tasks/sync changes; foreign product/store access is refused.
- Existing offer-backed unsafe product/period, stale task, concurrent revision, decision and source checks continue passing.
- Installed AI SDK 7.0.130 transport test covers definition → tool call → qualified numerical result/evidence. It is scripted transport, not an actual model-quality evaluation.
- Full lint/structure/typecheck/tests, formatting and API bundle/import checks are recorded in the parent workspace artifacts and exact-head CI. No paid model call or operational mutation.

## Delivery and completion boundary

Server-only behavior, no mobile binary required. Merge and API release are separate; production remains unchanged until an explicitly recorded compatible API release. Existing historical replies are not rewritten. No EAS build, provider activation or paid live test is implied.

M0–M6 functional iPhone baseline remains closed. Advances M7 workstream 5; **1/3/4/5/6/7 ongoing, 2 code ready**. Current real dialogue and the complete recommendation → decision → actual realization → qualified bilan pilot remain open. This does not close workstream 5 or M7 from tests alone. Deeper implantation and UX redesign remain deferred as agreed.
