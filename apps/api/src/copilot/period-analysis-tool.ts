import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "mongodb";
import {
  copilotAnalysisPeriodSchema,
  periodAnalysisInputSchema,
  copilotEvidenceSchema,
} from "@fl-copilot/domain";
import {
  calculateCalendarPeriodComparison,
  type DatedKpiValue,
} from "@fl-copilot/analytics-core";
import { departmentEvidencePerformanceSchema } from "./daily-evidence.js";
const productPerformanceSchema = departmentEvidencePerformanceSchema.extend({
  productId: z.string().uuid(),
  formulaVersion: z.literal("product-daily-v1"),
});
const coverageSchema = z.strictObject({
  expectedDays: z.number().int().positive(),
  availableDays: z.number().int().nonnegative(),
  partialDays: z.number().int().nonnegative(),
  missingDays: z.number().int().nonnegative(),
  missingDateExamples: z.array(z.string().date()).max(14),
});
export const periodAnalysisResultSchema = z.strictObject({
  target: z.strictObject({
    type: z.enum(["DEPARTMENT", "PRODUCT"]),
    productId: z.string().uuid().nullable(),
    label: z.string().max(280),
  }),
  currentPeriod: copilotAnalysisPeriodSchema,
  referencePeriod: copilotAnalysisPeriodSchema.nullable(),
  aggregation: z.enum(["SUM", "AVERAGE"]),
  coverage: z
    .array(
      z.strictObject({
        metric: z.enum(["sales", "margin", "waste"]),
        current: coverageSchema,
        reference: coverageSchema.nullable(),
        comparisonStatus: z
          .enum(["AVAILABLE", "PARTIAL", "UNAVAILABLE"])
          .nullable(),
        warnings: z.array(z.string()).max(10),
      }),
    )
    .max(3),
  evidence: z.array(copilotEvidenceSchema).max(24),
});
export type PeriodAnalysisResult = z.infer<typeof periodAnalysisResultSchema>;
/** Explicit arbitrary calendar ranges. Missing dates are materialized as unknown, never zero. */
export async function readPeriodAnalysis(
  db: Db,
  storeId: string,
  raw: unknown,
): Promise<PeriodAnalysisResult> {
  z.string().uuid().parse(storeId);
  const input = periodAnalysisInputSchema.parse(raw);
  let target: PeriodAnalysisResult["target"] = {
    type: "DEPARTMENT",
    productId: null,
    label: "Rayon fruits et légumes",
  };
  if (input.productId) {
    const product = await db
      .collection<{
        _id: string;
        id: string;
        storeId: string;
        label: string;
        deletedAt?: string | null;
      }>("products")
      .findOne({ _id: input.productId, storeId });
    if (
      !product ||
      product.id !== input.productId ||
      product.storeId !== storeId
    )
      throw new Error("COPILOT_PERIOD_PRODUCT_UNAVAILABLE");
    target = {
      type: "PRODUCT",
      productId: input.productId,
      label:
        z.string().trim().min(1).max(240).parse(product.label) +
        (product.deletedAt ? " — Produit retiré" : ""),
    };
  }
  const ranges = [
    input.currentPeriod,
    ...(input.referencePeriod ? [input.referencePeriod] : []),
  ];
  const rows = await db
    .collection<{
      _id: string;
      storeId: string;
      date: string;
      productId?: string;
      performance: unknown;
    }>(
      input.productId
        ? "productDailyPerformance"
        : "departmentDailyPerformance",
    )
    .find({
      storeId,
      ...(input.productId ? { productId: input.productId } : {}),
      $or: ranges.map((p) => ({ date: { $gte: p.start, $lte: p.end } })),
    })
    .maxTimeMS(2000)
    .limit(7321)
    .toArray();
  if (rows.length > 7320) throw new Error("COPILOT_PERIOD_DATA_LIMIT");
  const snapshots = new Map<
    string,
    | z.infer<typeof departmentEvidencePerformanceSchema>
    | z.infer<typeof productPerformanceSchema>
  >();
  const revisions: string[] = [];
  for (const row of rows) {
    const p = input.productId
      ? productPerformanceSchema.parse(row.performance)
      : departmentEvidencePerformanceSchema.parse(row.performance);
    if (
      input.productId &&
      (row.productId !== input.productId ||
        !("productId" in p) ||
        p.productId !== input.productId)
    )
      throw new Error("COPILOT_PERIOD_SCOPE_INVALID");
    if (
      row.storeId !== storeId ||
      p.storeId !== storeId ||
      p.date !== row.date ||
      snapshots.has(p.date) ||
      !ranges.some((r) => p.date >= r.start && p.date <= r.end)
    )
      throw new Error("COPILOT_PERIOD_SCOPE_INVALID");
    snapshots.set(p.date, p);
    revisions.push(JSON.stringify([row._id, p.inputRevision]));
  }
  const revision = createHash("sha256")
    .update(JSON.stringify(revisions.sort()))
    .digest("hex");
  const evidence: z.infer<typeof copilotEvidenceSchema>[] = [];
  const coverage: PeriodAnalysisResult["coverage"] = [];
  const describe = (p: z.infer<typeof copilotAnalysisPeriodSchema>) =>
    `${p.start} au ${p.end}`;
  const rangeId = JSON.stringify([
    storeId,
    input.productId,
    input.currentPeriod,
    input.referencePeriod,
    input.aggregation,
  ]);
  for (const metric of input.metrics) {
    const label = {
      sales: "Chiffre d’affaires net",
      margin: "Marge",
      waste: "Casse valorisée au prix de vente",
    }[metric];
    const points: DatedKpiValue[] = [...snapshots.values()].map((p) => {
      const status =
        metric === "sales"
          ? p.availability.salesValue.status
          : metric === "margin"
            ? p.availability.salesMarginValue.status
            : p.availability.wasteSalesValue.status;
      const value =
        status === "UNAVAILABLE"
          ? null
          : metric === "sales"
            ? p.sales.salesValue
            : metric === "margin"
              ? p.sales.marginValue
              : p.waste.salesValue;
      return { businessDate: p.date, value, status };
    });
    const {
      comparison,
      currentCoverage: c,
      referenceCoverage: r,
      complete,
      warnings,
    } = calculateCalendarPeriodComparison({
      kpiId: metric,
      currentPeriod: input.currentPeriod,
      referencePeriod: input.referencePeriod,
      aggregation: input.aggregation,
      points,
    });
    coverage.push({
      metric,
      current: c,
      reference: r,
      comparisonStatus: input.referencePeriod ? comparison.status : null,
      warnings,
    });
    const add = (
      key: string,
      title: string,
      value: string | null,
      quality = false,
    ) =>
      evidence.push(
        copilotEvidenceSchema.parse({
          id: JSON.stringify([
            "department-period",
            rangeId,
            revision,
            metric,
            key,
          ]),
          sourceType: quality
            ? "DATA_QUALITY"
            : key === "difference" || key === "percentage"
              ? "COMPARISON"
              : "KPI",
          sourceId: rangeId,
          sourceVersion: null,
          label: `${title} — ${label} — ${target.label}`,
          value,
          factKind: quality ? "QUALITY" : "DERIVED",
        }),
      );
    const amountLabel = (
      cov: typeof c,
      period: z.infer<typeof copilotAnalysisPeriodSchema>,
    ) =>
      `${input.aggregation === "SUM" ? "Total" + (cov.availableDays !== cov.expectedDays ? " partiel" : "") : "Moyenne journalière" + (cov.availableDays !== cov.expectedDays ? " partielle sur les jours renseignés" : "")} (€) — ${describe(period)}`;
    const coverageText = (cov: typeof c) =>
      `${cov.availableDays} jours complets, ${cov.partialDays} partiels, ${cov.missingDays} absents ou indisponibles, sur ${cov.expectedDays} jours calendaires${cov.missingDateExamples.length ? "; dates à compléter (extraits) : " + cov.missingDateExamples.join(", ") : ""}`;
    add(
      "current",
      amountLabel(c, input.currentPeriod),
      comparison.currentValue,
    );
    add(
      "current-coverage",
      `Couverture — ${describe(input.currentPeriod)}`,
      coverageText(c),
      true,
    );
    if (input.referencePeriod && r) {
      add(
        "reference",
        amountLabel(r, input.referencePeriod),
        comparison.referenceValue,
      );
      add(
        "reference-coverage",
        `Couverture — ${describe(input.referencePeriod)}`,
        coverageText(r),
        true,
      );
      add(
        "difference",
        `Écart${complete ? "" : " partiel des données disponibles"} (€) — ${describe(input.currentPeriod)} vs ${describe(input.referencePeriod)}`,
        comparison.absoluteDifference,
      );
      add(
        "percentage",
        `Évolution${complete ? "" : " partielle des données disponibles"} (%) — ${describe(input.currentPeriod)} vs ${describe(input.referencePeriod)}`,
        comparison.percentageDifference,
      );
    }
  }
  return periodAnalysisResultSchema.parse({
    target,
    currentPeriod: input.currentPeriod,
    referencePeriod: input.referencePeriod,
    aggregation: input.aggregation,
    coverage,
    evidence,
  });
}
