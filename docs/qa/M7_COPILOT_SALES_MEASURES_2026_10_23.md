# Copilot quantities and realized prices — 23 October 2026

The owner supplied an assistant answer reporting that tools expose sales/margin/waste amounts, but not quantities or historical unit selling prices. Code confirms the gap: Mercalys QUANTITE is parsed into validated sales observations; product daily snapshots retain quantities and compatible units. The analytical Mongo projection and typed result only exposed money. The shared average-price formula already exists. No private production conversation or observation was inspected in this increment.

## Existing tool extension

`analytics_query` accepts optional `includeSalesMeasures: true` for PRODUCT groups including sales, with pages limited to ten products. Existing filters, global monetary ranking, pagination, scope and revisions remain authoritative. One query supplies quantities and weighted realized prices for current/reference periods across multiple products, within the existing five-read budget. No agent, tool registry entry, global prompt instruction, provider or native module is added.

The shared `calculateSalesMeasures` reuses canonical decimal quantity and average-price formulas. Quantities are period sums even when the money query requests daily averages. Price uses the same complete product-days with both sales and compatible quantities; paired sales, quantity and day count are separate from the full known quantity. It is a ratio of sums, not an average of daily ratios. Missing is not zero; partial results remain qualified. Unknown/mixed units and non-positive denominators block a price. KG, PIECE and PACK remain distinct; PACK is described as unité conditionnée. Units come from retained snapshots, without an invented current-catalogue conversion.

KPI specs §11.1 leave HT/TTC semantics unconfirmed. Results carry `taxBasis: UNCONFIRMED`: this is an average on the source sales-value basis, not an asserted TTC price or a historical shelf-price sequence. No VAT rate or price is invented. Existing unknown-unit diagnostics are retained; legacy snapshots without quantities stay unavailable, not an automatic request to reimport files.

Each quantity/price has a verified value and evidence ID for natural Markdown tables and source links. Non-monetary-chart facts do not receive a misleading money-chart destination. The evidence limit stays 241; ten products, three monetary metrics and a reference yield at most 161 facts. The model does not calculate official KPIs.

## Verification and delivery

Shared tests cover weighted ratios, paired dates, decimal precision, period coverage, true zero, non-positive denominators, unknown/mixed units and independent daily-average money queries. Mongo integration tests cover the actual projection, store isolation, legacy fields, rendered sourced tables and maximum detailed pages. The mocked model/tool roundtrip proves quantities/prices reach the assistant and verified placeholders render their values. No paid model request is made.

Final local/CI results belong in the PR and artifact. This server tool is compatible with existing chat clients and needs an API release, not a paid EAS build. Production delivery and actual conversation acceptance remain distinct from merge. PR 324 automatic mobile recovery still needs its grouped native release.
