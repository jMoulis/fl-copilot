# ADR 0002 — Mercalys import granularity

Date: 2026-09-28

Status: Accepted for the pilot

## Context

Sales and waste observations are daily domain facts. The application needs a business date for `Aujourd’hui`, J-7 and comparable-day analysis, freshness, overlap reconciliation, and the configurable 90-day raw history.

Four pilot exports establish two actual Mercalys variants:

- single-day `Vente Nette` and `Casse` selections with `Détail Période: non détaillée` and no article `Date` column;
- week 39 `Vente Nette` and `Casse` selections with the same non-detailed structure and no article `Date` column.

All four reports retain explicit Mercalys report semantics, article identifiers, value columns, a report total, and a line-count row. The weekly rows aggregate the selected period by article, so their daily distribution cannot be recovered.

The photographed bulk-waste ticket is a separate `WASTE_RECEIPT` source. It may contain bulk and packaged lines and does not alter Mercalys net sales.

## Decision

Detection separates the Mercalys flow from its temporal granularity.

- Accept a non-detailed report when its selection starts and ends on the same calendar date. That date is the unambiguous business date for every article row.
- Accept a multi-day, weekly, or monthly selection only when the report uses `Détail Période: Par Jour` and exposes the `Date` article column.
- Recognize a non-detailed multi-day, weekly, or monthly report as Mercalys sales or waste, but return `UNSUPPORTED` with `AGGREGATED_PERIOD_WITHOUT_DAILY_DATES`.
- Never invent a daily date, spread an aggregate across days, or use the report-generation date as the observation date.

The recommended routine is a daily sales import and daily or periodic waste import, matching the product specification. A weekly selection with daily detail is suitable for catch-up and reduces manual file handling while preserving daily facts. A monthly selection with daily detail can support initial history import, but it is not the preferred freshness workflow.

## Consequences

- M2-T07 and M2-T08 normalize daily-detail or unambiguous single-day files only.
- The UI must explain why a recognized weekly or monthly aggregate cannot be published.
- Weekly and monthly aggregates may be retained as source documents for audit, but they do not create daily observations.
- A real `Par Jour` pilot export remains desirable before accepting that variant for production publication.
