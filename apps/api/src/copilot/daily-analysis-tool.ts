import { createHash } from "node:crypto";
import { z } from "zod";
import {
  dailyReadInputSchema,
  copilotEvidenceSchema,
} from "@fl-copilot/domain";
import { compareJMinus7, type DatedKpiValue } from "@fl-copilot/analytics-core";
import type { Db } from "mongodb";
import {
  readDepartmentDailySnapshot,
  departmentSnapshotEvidence,
} from "./daily-evidence.js";

export const dailyAnalysisResultSchema = z.strictObject({
  businessDate: dailyReadInputSchema.shape.businessDate,
  referenceDate: dailyReadInputSchema.shape.businessDate,
  evidence: z.array(copilotEvidenceSchema).max(24),
});
export type DailyAnalysisResult = z.infer<typeof dailyAnalysisResultSchema>;

/** Explicit day + same weekday reference. Uses shared comparisons, never model arithmetic. */
export async function readDailyAnalysis(
  db: Db,
  storeId: string,
  raw: unknown,
): Promise<DailyAnalysisResult> {
  const { businessDate } = dailyReadInputSchema.parse(raw);
  const referenceDate = new Date(
    Date.parse(`${businessDate}T00:00:00Z`) - 7 * 86400000,
  )
    .toISOString()
    .slice(0, 10);
  const current = await readDepartmentDailySnapshot(db, storeId, businessDate);
  const reference = await readDepartmentDailySnapshot(
    db,
    storeId,
    referenceDate,
  );
  const missing = (date: string) =>
    copilotEvidenceSchema.parse({
      id: JSON.stringify(["department-day-missing", storeId, date]),
      sourceType: "DATA_QUALITY",
      sourceId: `${storeId}/${date}`,
      sourceVersion: null,
      label: `Chiffres du rayon — ${date}`,
      value: null,
      factKind: "QUALITY",
    });
  const evidence = [
    ...(current
      ? departmentSnapshotEvidence(current)
      : [missing(businessDate)]),
    ...(reference
      ? departmentSnapshotEvidence(reference)
      : [missing(referenceDate)]),
  ];
  const revision = createHash("sha256")
    .update(
      JSON.stringify([
        current?.sourceId,
        current?.performance.inputRevision,
        reference?.sourceId,
        reference?.performance.inputRevision,
      ]),
    )
    .digest("hex");
  const metrics = [
    ["sales", "Chiffre d’affaires net", "salesValue", "salesValue"],
    ["margin", "Marge", "marginValue", "salesMarginValue"],
    [
      "waste",
      "Casse valorisée au prix de vente",
      "salesValue",
      "wasteSalesValue",
    ],
  ] as const;
  for (const [key, label, field, availability] of metrics) {
    const point = (snapshot: typeof current, date: string): DatedKpiValue => {
      const p = snapshot?.performance;
      const status = p?.availability[availability].status ?? "UNAVAILABLE";
      return {
        businessDate: date,
        status,
        value:
          !p || status === "UNAVAILABLE"
            ? null
            : key === "waste"
              ? p.waste.salesValue
              : p.sales[field],
      };
    };
    const comparison = compareJMinus7({
      kpiId: key,
      current: point(current, businessDate),
      history: reference ? [point(reference, referenceDate)] : [],
    });
    for (const [suffix, title, value, quality] of [
      ["difference", "Écart (€)", comparison.absoluteDifference, false],
      ["percentage", "Évolution (%)", comparison.percentageDifference, false],
      ["status", "Disponibilité de la comparaison", comparison.status, true],
      [
        "warnings",
        "Limites de la comparaison",
        comparison.warnings.join(", ") || "NONE",
        true,
      ],
    ] as const) {
      evidence.push(
        copilotEvidenceSchema.parse({
          id: JSON.stringify([
            "department-J7",
            storeId,
            businessDate,
            revision,
            key,
            suffix,
          ]),
          sourceType: quality ? "DATA_QUALITY" : "COMPARISON",
          sourceId: `${storeId}/${businessDate}/J7`,
          sourceVersion: null,
          label: `${title} — ${label} — ${businessDate} vs ${referenceDate}`,
          value,
          factKind: quality ? "QUALITY" : "DERIVED",
          analyticsContext: {
            schemaVersion: 1,
            period: {
              kind: "range",
              current: { start: businessDate, end: businessDate },
              reference: { start: referenceDate, end: referenceDate },
              aggregation: "SUM",
              basis: "DEPARTMENT",
            },
            metric: key,
            filters: { category: null, nature: null, productId: null },
          },
        }),
      );
    }
  }
  return dailyAnalysisResultSchema.parse({
    businessDate,
    referenceDate,
    evidence,
  });
}
