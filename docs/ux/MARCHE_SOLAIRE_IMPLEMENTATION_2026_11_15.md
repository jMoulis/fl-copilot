# Marché solaire — native implementation

The owner accepted the four primary journeys on 15 November, then selected the
light-led Marché solaire direction and accepted its five-screen visual extension.
Implement the existing application, not a demo or a second architecture.

## Authority and scope

- Visual reference: the owner-private study at
  https://fl-copilot-audit-ux-novembre-2026.safeyak15.chatgpt.site/marche/ .
- Local exact visual source: workspace maintenance/ux-ui-audit-2026-11-14/
  mobile-report-site/dist/marche/ at b7efcf56098eaef93cb2c762f650e08ae4206d77.
- The study's numbers, products, dates, states and cards are illustrative. Native
  UI continues reading actual SQLite/domain outputs and canonical private files.
- Light is the default identity. A new theme-switching feature is not required.
  The comparison's optional dark study does not authorize a new theme framework.
- Keep Journal, Analyses, Copilote and Imports. Products/settings remain header
  shortcuts; product detail/edit retain their origin and do not add a fifth tab.
- First tap on a product in Analyses opens its fiche; explicit filters still
  support product exploration. Preserve period, filters, metric and both scrolls.
- Fixed close and swipe for temporary panels use the existing onClose handlers,
  including their dirty/in-flight safeguards; do not introduce universal prompts.

## Shared visual roles

Root owns tokens/tailwind/shared components/navigation/Journal/Analyses. Keep one
palette and reuse current components, no theme provider or one-off CSS-in-JS layer.

- canvas #FAFBF5; surface #FFFEF9; surfaceMuted #F0F3E8;
- ink #213B29; muted #64725C; line #DCE3D5;
- forest #276442 (readable green text/lines), forestStrong #24563B;
- forestSoft #E7EEDC; accent #D6EC8C; onAccent #294025;
- hero #163F2A; heroInk #F4F3E7; heroMuted #BED0B6;
- navigation #1C3E2A; navigationInk #ECF3DC; navigationMuted #B9CBB8;
- positive #276442 / soft #E6EFDF;
- warning #946525 / soft #F7EAD1;
- critical #B54E3C / soft #F8E6DE;
- info #356B85 / soft #E5EFF2; pending #705485 / soft #EEE7F3.

Existing forest was overloaded as both bright text and button background.
Use accent/onAccent for solid actions or selected pills; forest for green text.
Hero/heroInk/heroMuted qualify explicitly dark KPI blocks; do not put light-theme
ink/muted on them. Keep signed charts, exact zero/missing and all source qualifiers.

## Delegation and invariants

- Product agent: presentation files in products (detail/editor/performance/catalogue)
  and their native tests only; no repositories, sync or matching changes.
- Copilot agent: native chat/message/conversation/card presentation only; no tools,
  prompts, model routing, history persistence or network/generation lifecycle.
- Imports agent: Imports landing and Mercalys batch/file UI only; no parser,
  reconciliation rules, publication, archive mutations or source-retention changes.
- Root: shared components/tokens/app chrome/Journal/Analyses and integration tests.

Do not replace working UI with study HTML. Keep current scopes, pagination, hooks,
mutations, stale/busy/role checks, offline data, unknown vs zero, confirmations,
source metadata and all previously accepted workflows. No synthetic records, new
model/provider spend, API deployment or dependency/toolchain changes.

## Verification and delivery

Run formatting, lint, strict typecheck, relevant existing native tests and iOS
export. Check actual simulator when available; distinguish visual source checks,
native execution, CI, merge, build availability and physical owner acceptance.
Both exact-head push and PR checks must pass before merge. Follow grouped native
release policy; no Vercel deployment is required for this mobile-only batch.

Native implementation and local evidence are recorded in
`../qa/MARCHE_SOLAIRE_NATIVE_2026_11_15.md`. CI, release availability and physical
iPhone acceptance are distinct checkpoints.
