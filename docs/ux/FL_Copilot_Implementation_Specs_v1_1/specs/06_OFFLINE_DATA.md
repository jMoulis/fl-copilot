# Offline-first integrity

SQLite is the local operational store. All reads use local repositories first; local writes use mobile UUIDs and an outbox. Incremental bidirectional sync runs independently of navigation. Screens remain usable offline, with status labels: `Up to date`, `Saved locally`, `Sync pending`, `Sync error`.

Source integrity: Mercalys Net Sales does not include waste-ticket amounts. Non-bulk waste comes from Mercalys Waste Excel; bulk waste from receipt photos. Barcoded lines on bulk receipts must be assigned to non-bulk waste without double counting. Promo PDFs, weather and exceptional events provide context. Approved existing domain specs control SKU/UB and KPI definitions.

Comparison queries require store-local trading date, ISO week-year, ISO week number, source completeness, closures and freshness. Missing imports are not zero-sales days. Do not derive intra-day data from daily aggregates. Index queries for date/category/product and avoid refetching on every tab switch.
