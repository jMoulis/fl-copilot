# Product and sheet presentation — 15 November 2026

## Owner request

Remove routine local-copy/list-context explanations from the product screens,
restore directly selectable identity tags in the editor and soften the backdrop
when opening temporary bottom panels. The accepted Marché solaire identity and
existing business journeys remain the reference.

## Scope

- Catalogue removes the visible list-persistence notice. Navigation, restored
  filters/position, persistence attempts and real read errors keep their behavior.
- Product image removes the routine local-copy/success explanation, including
  Source/options. Provenance, rights, actual transfer errors/pending states and
  recovery actions remain accessible.
- Editor category, nature and sales unit use the existing choice controller as
  wrapping tags. Unknown classifications, draft validation, optional fields and
  explicit saving retain their contracts. The generic offline-save explanation
  is removed and the save acknowledgement is concise.
- Shared BottomSheet uses native fade rather than sliding the full-screen scrim.
  Its dedicated 25% scrim leaves the existing date/camera overlay unchanged.
  Parent-controlled close, native dismissal completion, fixed controls, keyboard
  behavior and header-only swipe remain intact. No animation library or custom
  presence/lifecycle state is added.

No repository writer, sync contract, schema, provider, model, import parser or
API deployment changes. The separate Ma semaine/TG/installation prototype is a
visual proposal awaiting review, not an implemented commercial workflow change.

## Acceptance

Check the actual current-source editor, image panel and catalogue. Open and
close a normal bottom panel, retaining the underlying screen. Confirm the
Mercalys native dismissal still precedes any queued picker action, without
starting an import or publication just to exercise a visual change. Automated
interaction coverage retains unknown classifications, explicit saves and
parent/native dismissal ordering.

## Local verification

- Structure, repository lint, strict typecheck in all ten workspaces and changed
  file formatting pass.
- Full local Vitest: **5,363 passed, 897 skipped**, in 537 passing / 92 skipped
  suites. Skipped environment-gated cases are not claimed as executed database
  integration coverage.
- The existing editor interaction case exercises direct identity tags, explicit
  submission, clearing classifications to unknown and preservation of optional
  product data. Existing form locking/validation cases pass.
- BottomSheet regression coverage keeps the controlled backdrop close, native
  dismissal ordering, fixed controls and header gesture boundaries. Independent
  review finds no change to the Mercalys queued-picker sequencing.

- Production iOS Hermes export passes; it is not an installable release.
- Current-source native verification uses the already installed Expo Go on the
  iPhone 17 Pro simulator. Rendered Modal props show `fade` and `#10241840`.
  The already compiled native weather recipe opens the panel, closes with X,
  reopens and closes with a slow downward header gesture. A second native case
  opens the product directly from Analyses, inspects the tag-based editor without
  typing/saving, returns and performs edge-back. The original row is hittable at
  exactly the same frame. Both native cases pass; the screenshots were inspected.
  Native attachments/video and logs remain private in workspace
  `maintenance/ux-product-sheets-2026-11-15/`. No source intake, new declaration,
  generation or business write was performed for these visual checks.

Exact-head CI/merge and distribution remain separate checkpoints. These source
changes are not included in accepted build 68. A manual new Mercalys picker
session was not exercised here; its native dismissal sequencing is covered by
the existing mounted regression tests and independent source review.
