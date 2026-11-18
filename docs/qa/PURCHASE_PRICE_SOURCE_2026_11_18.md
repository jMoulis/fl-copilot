# Daily purchase prices — source qualification, 18 November 2026

Owner supplies `base article.xlsx` after requesting daily purchase-price uploads.
This record scopes that next increment; no prices have been published and no
numerical counter-promotion scope is reopened.

## Observed source

- Original retained privately outside Git at
  `maintenance/purchase-prices-2026-11-18/base-article-source.xlsx`.
- SHA-256: `98582cfe93892912a5f5f98b92606b864f9b31a9d191091f452ef883e3dca6a1`.
- `Mercalys` populated; `Feuil2` and `Feuil3` empty. No formulas.
- Store 9083. Export timestamp at A2: 14 November 2026 17:46:30.
  Application date at A5: 14 November 2026. A3 contains `TEST`.
  Use the declared application date, not upload date or file modification time.
- Headers A10:F10: ITM, EAN, LIBELLE, NOMENCLATURE,
  PRIX ACHAT PAR UNITE, ACTIF.
- Rows 11–1236: 1,226 records, matching the declared footer A1239.
  550 FRUITS FRAIS, 620 LEGUMES FRAIS, 56 POMMES DE TERRE.
- 1,176 marked Oui and 50 Non. Preserve this as source status; it must not
  silently deactivate current catalogue products.
- ITM and EAN are both 13-character strings with leading zeros; each column
  has 1,226 unique values and no missing identifier. Preserve exact strings;
  do not truncate ITM into ITM8 without verified mapping. Existing product
  matching uses exact validated identifiers and exposes ambiguity.
- No missing, zero or negative prices. 170 prices equal 0.01 and two equal
  0.001; all 172 rows are marked active. Preserve three-decimal precision.
  Do not silently treat these as missing or reliable calculation inputs before
  owner clarification. Source nomenclature also includes unexpected labels;
  it must not overwrite validated product category/nature automatically.
- No explicit per-row KG/UNIT basis, currency field or HT/TTC field.
  A label mentioning a package weight is not proof of the price denominator.

## Existing implementation and proposed small first lot

The current Mercalys detector supports sales/waste movement reports with flow,
quantity and monetary-value columns. This article-price snapshot is a separate
format, not a compatible sales report. Reuse the local XLSX reader, source-file
retention, Imports entry point, product matching/review and canonical Outbox/sync.

Proposed journey: Imports → Prix d’achat → select workbook → preview store,
application date, matched/unmatched products and price issues → confirm import.
Keep source lines and historical dated price observations; a repeated identical
source must not double-publish. A corrected source on the same application date
needs explicit reconciliation, not additive prices or silent history overwrite.
Do not fabricate prices for absent days or replace official Mercalys margins.
First lot should expose dated price history and coverage, with no AI parsing,
new provider or simulation feature. Domain contract, local migration, server
persistence and incremental synchronization must precede publication code.

## Owner decisions — 18 November 2026

1. Owner confirms purchase amounts are HT, per kg for weight-based articles and
   per sold unit/package for other articles. Resolve that basis from validated
   product units; do not infer it solely from label text or package weight.
2. Owner describes prices of 0.01 and 0.001 as generally belonging to inactive
   products. All 172 corresponding rows in this file nevertheless say ACTIF=Oui.
   This does not authorize changing catalogue status or calling every price false.
3. After that discrepancy was explained, owner explicitly approves keeping these
   exact values as “Prix à vérifier”, excluded from calculations until confirmed.
   Preserve the raw amount and source status. No automatic product deactivation,
   no replacement with zero, no extension to other price thresholds by inference.

The two source interpretation questions are resolved. The first import increment
can use these rules; numerical counter-promotion simulations remain deferred.

The original workbook was read only with the bundled Python/openpyxl runtime.
No app import, remote publication, build or paid AI operation was performed.

## Approved implementation and verification in progress

Owner explicitly authorizes local and email imports with Mercalys feature parity.
Implementation extends the existing pipeline rather than introducing another
parser service, agent or provider. Local migration 66 and Mongo migration 63,
source-backed publication, preview comparisons and product history are included.
The supplied 1,226-row workbook parses without issues and publishes in an isolated
SQLite fixture within the 3 MB publication cap, retaining all 172 review prices.
That fixture supplies synthetic matching products: it does **not** establish a
real-catalogue automatic match rate. The owner's data has not been imported into
the live application. Private evidence remains outside Git.

Synthetic tests cover local publication, duplicate refusal, explicit confirmation,
same-date correction/tombstones, restart persistence, XLSX and interrupted ZIP
email handoff, remote original proof, rejected tampering, idempotent replay,
legacy-client filtering and cross-device pull. Full checks and delivery identity
will be recorded after completion. No native or owner acceptance is claimed yet.

## Local verification completed

- `pnpm check`: structure, lint, all typechecks; 549 test files passed,
  5,466 tests passed. The usual 93 integration files/899 tests require their
  external fixtures and were skipped in this default run.
- Explicit local transactional Mongo run: existing Mercalys canonical sync and
  new purchase-price source proof both passed. PA plus migration tests: 13 passed.
  The initial shared local Mongo process stopped between runs; the final run uses
  a separate disposable local replica and passed without changing production.
- Targeted XLSX/ZIP email and local publication tests: 52 passed. Native component
  tests: two passed (precision/date/source/offline state, explicit confirmation
  prompt, viewer restriction, empty state).
- `pnpm format:check`, API build/import check and mobile web export passed.
- Review preserves the existing legacy publication size rule; only the new PA
  format uses the bounded 3 MB UTF-8 envelope. No dependency/provider added.

Delivery remains pending CI/merge, API release and local iPhone archive. These
checks do not constitute physical iPhone acceptance. Historical snapshots with
unknown units remain excluded; correcting the catalogue qualifies subsequent
imports, not the interpretation of old source records automatically.
