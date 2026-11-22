# Native catalogue and offers — 22 November 2026

Owner approved the interactive import/Product mockup, then authorized integration.
This increment implements native code, not a production release or beta reset.

## Implemented boundary

- Imports → Catalogue et offres: reopen retained JSON drafts, choose a published
  Mercalys article reference, review ready matches and optional exceptions, then
  confirm the snapshot and reviewed links in one SQLite transaction/Outbox path.
- Missing reference does not prevent preserving offers. Reference import reuses
  the existing Mercalys flow. No Product is created for a supplier offer.
- Explicit PDV configuration in Mon magasin is authoritative; no source payload
  silently configures the store. Original JSON is immutable and app-owned.
- Manual matching requires current ITM/EAN ownership and a reason. Private scoped
  form drafts survive restart; changed evidence invalidates their confirmation.
- Previously accepted or withdrawn links are not silently replaced/reactivated.
  Pending, failed and conflicting links cannot be overwritten by another review.
- Product displays dated supplier offers, missing tariffs honestly, supplier
  packaging and original sources. Mercalys PA history remains separate.
- Optional nature/content/Petit Prix proposals use the shared deterministic
  preview and existing Product editor writer. Preserve existing values, Product
  IDs, aliases and historical sales units. Category remains an explicit choice.
- Native provider negotiates the existing procurement snapshot/link capabilities.
  Deploy the compatible API before distributing this native source.

## Verification

Automated tests exercise actual SQLite/native services for atomic confirmation,
rollback, scope changes, source freshness, no Product/PA writes during import,
ordinary sync ACK stability, current identifier ownership, missing newer tariff,
and selected attribute application through the canonical editor. Native component
harnesses exercise retained-draft reopening, deferred sheet navigation, repeated
confirmation, offer-sheet reopening and attribute confirmation. File adapter tests
cover immutable retention, app-container relocation, changed bytes and invalid paths.
React checklist: scoped query keys, unmount guards, busy guards, preserved background
content, bounded rows and deferred navigation after native sheet dismissal.

The owner-provided JSON and workbook also run through the same confirmation service
in an isolated SQLite database, persisted/reopened and confirmed twice. Evidence:
`maintenance/procurement-native-2026-11-22` outside Git; source customer data stays
private. This seeds Product identities from the reference for a bounded service
rehearsal; it does not claim the complete empty-base financial reconstruction.

Local result: **101 tests / 15 suites pass**, mobile TypeScript and repository ESLint
pass. Real-file service rehearsal: 1,226 seeded reference Products, 691 offers,
421 links, 63 exceptions, two Outbox commands, unchanged Product count and zero
PA writes. Reopening SQLite and confirming again preserves the publication ID.
Carrot generic 5002 exposes four distinct dated supplier offers; its missing quote
remains missing. Final exact-head CI is the merge gate.

## Remaining release gates

1. Compatible API release and private original upload/recovery acceptance against
   that released version. No production writes or deployment in this increment.
2. Procurement-specific concurrent conflict resolution UI remains pending. This
   increment conserves both versions and blocks replacement; it does not claim
   a completed domain resolver or universal last-write-wins.
3. Full reference → JSON → historical sales/waste ZIP rehearsal on an empty isolated
   base, including original preservation and completeness checks.
4. Grouped native build and physical iPhone acceptance: visual fidelity, picker,
   swipe-close/reopen, navigation return, long lists and offline restart. Component
   harnesses do not prove native gesture or visual acceptance.
5. Concrete owner-approved reset scope, backup/reconstruction evidence and final
   reset approval. No purge or production reassignment is performed here.

Do not confuse merged code, deployed API, distributed binary and device acceptance.
