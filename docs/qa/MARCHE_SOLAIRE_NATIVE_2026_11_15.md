# Marché solaire — native implementation and verification

## Accepted scope

Owner-approved visual source and adaptation contract:
[implementation brief](../ux/MARCHE_SOLAIRE_IMPLEMENTATION_2026_11_15.md).
Baseline is `e4a65f10302cf9c90e6d40a325cbd7bde6ee666c`; implementation branch is
`feat/marche-solaire-native`.

- One shared light palette, warm-white surfaces, forest KPI/navigation blocks and
  lime actions. No runtime theme provider or new component library.
- Journal keeps actual dates, weather/context, observations, private reminders and
  Ma semaine; no invented daily values or product binding on free-text reminders.
- Analyses keeps canonical signed charts, coverage and comparable-day deltas.
  A first tap opens the fiche with its origin/period retained. Product filters
  remain explicit. Critical trends retain their semantic color, including waste.
- Copilote keeps its actual title, one header, conversation history, horizontal
  tables, composer, sources and business cards. No model/tool/prompt/lifecycle
  change accompanies the presentation work.
- Imports mounts the existing Mercalys history reader once at the landing. A lot
  remains a full page; file review uses the shared sheet. Email, tickets, commercial
  documents, original files, archives and synchronization remain accessible.
- Product catalogue/detail/editor/photo/metrics reuse existing repositories,
  drafts, permissions and origin returns. An additional bounded local waste read
  supports the displayed secondary KPI; no extra network call is added.
- Sheets keep header/close and optional footer outside scrolling content.
  Swipe is on the handle/header; the body keeps native scrolling. All close
  paths call the existing controlled `onClose`; native `onDismiss` remains
  distinct (Mercalys queued file processing depends on it). Horizontal gestures,
  scrolling below the top and keyboard-form body scrolling are preserved.

## Deliberate production adaptations

The study's example amounts, products, dates and states are not inserted. The
existing signed bar chart remains interactive; there is no fabricated dotted
reference curve. Free-text reminders use an icon because they have no product
foreign key. The product editor does not invent an editable active flag outside
its canonical draft. Mercalys details retain actual publication/extraction states,
with totals available in Résumé and source-specific missing states intact.

Muted text is slightly darker than the study (`#64725C`) for at least 4.55:1 on
the three shared light backgrounds. The Journal banana is a decorative asset
copied unchanged from the owner-approved study, not a generated/approved product
visual-file record: SHA-256
`54b6bdf12af191ebe8d6f85d34a2c48b35009987f8670a820a2196f9dc71557d`.
No product visual manifest, approval or provenance was fabricated.

## Local verification

- Structure verification passes.
- Repository lint and formatting pass.
- Strict typecheck passes for all ten workspaces.
- Full local Vitest run: **5,348 passed; 897 skipped**, across **535 passing and
  92 skipped suites**. Skips retain the existing environment-gated integration
  policy; they are not claimed as executed MongoDB transaction tests. Exact-head
  CI runs with the configured transactional MongoDB service.
- Included native component checks cover direct first-tap fiche access, primary
  tabs/header shortcuts, one canonical Imports reader, file-picker sequencing,
  fixed sheet controls/footer, controlled dismissal, handle/header gestures,
  horizontal-scroll preservation, form draft guards, metrics and offline sources.
- iOS Hermes export succeeds locally. This is a source/bundle check, not a new
  installable release or physical iPhone acceptance.
- Independent code review found the unfavorable evolution badge; it is corrected
  using the already computed metric-aware direction. No remaining actionable
  finding from that review.

## Actual native verification and delivery

Simulator capture must use the current source. The initial Expo runtime was still
serving old dark tokens; it was rejected as evidence and its development server
was restarted with a fresh transform cache, preserving the installed application
and its data. Current-source native checks pass on the existing authenticated
iPhone 17 Pro simulator (iOS 26.3, Expo Go), with no domain mutation:

- Journal, Analyses, Imports, existing Copilote history, product detail and editor
  render the light roles. The initially clipped tab glyphs are fixed with explicit
  icon-slot dimensions and verified again on the real native screen.
- A first tap on BANANE VRAC opens the fiche. Opening the editor without typing,
  returning to the fiche and native edge-back restores Analyses at the exact
  position. Before/after list captures have the same SHA-256:
  `32a50de23e6a6a7d0300c53d4e0d096ab13e8d5016ea56743830aeec07b34cbe`.
- Actual downward handle gestures close the weather and Analyses filter panels;
  the weather handle is checked at ordinary and slow speeds. Fixed X closes both
  panels in actual native tests; body scrolling remains separate. The body deliberately uses native scrolling rather
  than an additional gesture-interception layer.
- Existing published import `13112026.xlsx` opens its file panel, closes back to
  the lot, then returns to Imports. The full-screen lot's own safe-area context
  keeps its Back control below the status bar and natively hittable. No extraction,
  publication, recalculation or archive mutation was requested in this recipe.
- A short read-only navigation recording and native XCTest attachments are kept
  outside this public repository, in workspace maintenance/ux-ui-audit-2026-11-14/
  marche-native-qa/. Existing private data and captures are not published to GitHub.

Exact-head CI/merge and any new binary remain pending at this source checkpoint.
M0–M8 acceptance and explicit Atlas/M9 reserves are unchanged. No API deployment is required for this mobile-only batch.
