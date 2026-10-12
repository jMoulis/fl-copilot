import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "mongodb";
import {
  copilotEvidenceSchema,
  productChangesReadInputSchema,
} from "@fl-copilot/domain";
import {
  rankProductDailyChanges,
  type ProductChangePoint,
} from "@fl-copilot/analytics-core";
import { departmentEvidencePerformanceSchema } from "./daily-evidence.js";
import { dailyAnalysisResultSchema } from "./daily-analysis-tool.js";
const performanceSchema = departmentEvidencePerformanceSchema.extend({
  productId: z.string().uuid(),
  formulaVersion: z.literal("product-daily-v1"),
});
export const productAnalysisResultSchema = dailyAnalysisResultSchema.extend({
  products: z
    .array(
      z.strictObject({
        productId: z.string().uuid(),
        label: z.string().max(280),
      }),
    )
    .max(3),
  coverage: z.strictObject({
    status: z.enum(["COMPARED_PRODUCTS", "LIMIT_EXCEEDED"]),
    comparedProductCount: z.number().int().nonnegative().nullable(),
    excludedProductCount: z.number().int().nonnegative().nullable(),
  }),
});
export type ProductAnalysisResult = z.infer<typeof productAnalysisResultSchema>;
/** Comparable daily monetary changes; no sampled global ranking or inferred purchase cost. */
export async function readProductAnalysis(
  db: Db,
  storeId: string,
  raw: unknown,
): Promise<ProductAnalysisResult> {
  z.string().uuid().parse(storeId);
  const input = productChangesReadInputSchema.parse(raw);
  const referenceDate = new Date(
    Date.parse(`${input.businessDate}T00:00:00Z`) - 7 * 86400000,
  )
    .toISOString()
    .slice(0, 10);
  const rows = await db
    .collection<{
      _id: string;
      storeId: string;
      productId: string;
      date: string;
      performance: unknown;
    }>("productDailyPerformance")
    .find({ storeId, date: { $in: [input.businessDate, referenceDate] } })
    .maxTimeMS(2000)
    .limit(1001)
    .toArray();
  const coverageSource = `${storeId}/${input.businessDate}/products/${input.metric}/${input.direction}`;
  if (rows.length > 1000)
    return productAnalysisResultSchema.parse({
      businessDate: input.businessDate,
      referenceDate,
      products: [],
      coverage: {
        status: "LIMIT_EXCEEDED",
        comparedProductCount: null,
        excludedProductCount: null,
      },
      evidence: [
        {
          id: JSON.stringify(["product-changes-limit", coverageSource]),
          sourceType: "DATA_QUALITY",
          sourceId: coverageSource,
          sourceVersion: null,
          label: "Classement des produits — lecture limitée",
          value: "LIMIT_EXCEEDED",
          factKind: "QUALITY",
        },
      ],
    });
  const current: ProductChangePoint[] = [],
    reference: ProductChangePoint[] = [];
  const revisions: string[] = [];
  for (const row of rows) {
    const p = performanceSchema.parse(row.performance);
    if (
      row.storeId !== storeId ||
      p.storeId !== storeId ||
      p.productId !== row.productId ||
      p.date !== row.date ||
      (p.date !== input.businessDate && p.date !== referenceDate)
    )
      throw new Error("COPILOT_PRODUCT_SCOPE_INVALID");
    revisions.push(JSON.stringify([row._id, p.inputRevision]));
    const status =
      input.metric === "sales"
        ? p.availability.salesValue.status
        : p.availability.salesMarginValue.status;
    const point = {
      storeId,
      productId: p.productId,
      businessDate: p.date,
      status,
      value:
        status === "UNAVAILABLE"
          ? null
          : input.metric === "sales"
            ? p.sales.salesValue
            : p.sales.marginValue,
    };
    (p.date === input.businessDate ? current : reference).push(point);
  }
  const result = rankProductDailyChanges({
    ...input,
    storeId,
    current,
    reference,
  });
  const revision = createHash("sha256")
    .update(JSON.stringify(revisions.sort()))
    .digest("hex");
  const catalog = await db
    .collection<{
      _id: string;
      id: string;
      storeId: string;
      label: string;
      deletedAt?: string | null;
    }>("products")
    .find({ storeId, _id: { $in: result.changes.map((c) => c.productId) } })
    .maxTimeMS(2000)
    .limit(3)
    .toArray();
  const products = result.changes.map((c) => {
    const row = catalog.find((p) => p._id === c.productId);
    if (row && (row.id !== c.productId || row.storeId !== storeId))
      throw new Error("COPILOT_PRODUCT_SCOPE_INVALID");
    const label = row
      ? z.string().trim().min(1).max(240).parse(row.label)
      : "Produit à identifier";
    return {
      productId: c.productId,
      label: label + (row?.deletedAt ? " — Produit retiré" : ""),
    };
  });
  const evidence = result.changes.flatMap((c) => {
    const product = products.find((p) => p.productId === c.productId)!;
    const base = {
      sourceType: "COMPARISON" as const,
      sourceId: coverageSource,
      sourceVersion: null,
      factKind: "DERIVED" as const,
    };
    return [
      ["current", "Valeur actuelle (€)", c.comparison.currentValue],
      ["reference", "Valeur à J-7 (€)", c.comparison.referenceValue],
      ["difference", "Écart (€)", c.comparison.absoluteDifference],
      ["percentage", "Évolution (%)", c.comparison.percentageDifference],
      [
        "warnings",
        "Limites de la comparaison",
        c.comparison.warnings.join(", ") || "NONE",
      ],
    ].map(([key, title, value]) =>
      copilotEvidenceSchema.parse({
        ...base,
        id: JSON.stringify([
          "product-change",
          coverageSource,
          revision,
          c.productId,
          key,
        ]),
        label: `${title} — ${product.label} — ${input.metric === "sales" ? "Ventes" : "Marge"} — ${input.businessDate} vs ${referenceDate}`,
        value,
        factKind: key === "warnings" ? "QUALITY" : "DERIVED",
        sourceType: key === "warnings" ? "DATA_QUALITY" : "COMPARISON",
      }),
    );
  });
  evidence.push(
    copilotEvidenceSchema.parse({
      id: JSON.stringify([
        "product-changes-coverage",
        coverageSource,
        revision,
      ]),
      sourceType: "DATA_QUALITY",
      sourceId: coverageSource,
      sourceVersion: null,
      label: `Couverture du classement — ${input.businessDate} vs ${referenceDate}`,
      value: `${result.comparedProductCount} produits comparables ; ${result.excludedProductCount} sans comparaison complète. Classement des écarts en euros, sans attribution causale ni décomposition exhaustive du rayon.`,
      factKind: "QUALITY",
    }),
  );
  return productAnalysisResultSchema.parse({
    businessDate: input.businessDate,
    referenceDate,
    products,
    evidence,
    coverage: {
      status: "COMPARED_PRODUCTS",
      comparedProductCount: result.comparedProductCount,
      excludedProductCount: result.excludedProductCount,
    },
  });
}
