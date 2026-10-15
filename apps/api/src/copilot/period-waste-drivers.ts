import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import { z } from "zod";
import { rankPeriodContributors } from "@fl-copilot/analytics-core";
import { copilotEvidenceSchema } from "@fl-copilot/domain";
import { departmentEvidencePerformanceSchema } from "./daily-evidence.js";
const performanceSchema = departmentEvidencePerformanceSchema.extend({
  productId: z.string().uuid(),
  formulaVersion: z.literal("product-daily-v1"),
});
export const wasteDriversSchema = z.strictObject({
  aggregation: z.literal("SUM"),
  status: z.enum(["AVAILABLE", "UNAVAILABLE", "LIMIT_EXCEEDED"]),
  products: z
    .array(
      z.strictObject({
        productId: z.string().uuid(),
        label: z.string().max(280),
        evidenceId: z.string().max(1000),
      }),
    )
    .max(5),
});
export async function readPeriodWasteDrivers(
  db: Db,
  storeId: string,
  period: { start: string; end: string },
) {
  const rows = await db
    .collection<{
      _id: string;
      storeId: string;
      productId: string;
      date: string;
      performance: unknown;
    }>("productDailyPerformance")
    .find({
      storeId,
      date: { $gte: period.start, $lte: period.end },
      "performance.waste.salesValue": { $ne: null },
      "performance.availability.wasteSalesValue.status": {
        $in: ["AVAILABLE", "PARTIAL"],
      },
    })
    .maxTimeMS(2000)
    .limit(20001)
    .toArray();
  if (rows.length > 20000)
    return {
      drivers: wasteDriversSchema.parse({
        aggregation: "SUM",
        status: "LIMIT_EXCEEDED",
        products: [],
      }),
      evidence: [],
    };
  const revisions: string[] = [];
  const points = rows.map((row) => {
    const p = performanceSchema.parse(row.performance);
    if (
      row.storeId !== storeId ||
      p.storeId !== storeId ||
      p.productId !== row.productId ||
      p.date !== row.date
    )
      throw Error("COPILOT_WASTE_DRIVER_SCOPE_INVALID");
    revisions.push(JSON.stringify([row._id, p.inputRevision]));
    return {
      storeId,
      productId: p.productId,
      businessDate: p.date,
      value: p.waste.salesValue,
      status: p.availability.wasteSalesValue.status,
    };
  });
  const rank = rankPeriodContributors({ storeId, period, points });
  const ids = rank.products.map((p) => p.productId);
  const labels = ids.length
    ? await db
        .collection<{
          _id: string;
          storeId: string;
          label: string;
          deletedAt?: unknown;
        }>("products")
        .find({ storeId, _id: { $in: ids } })
        .limit(5)
        .toArray()
    : [];
  const revision = createHash("sha256")
    .update(JSON.stringify(revisions.sort()))
    .digest("hex");
  const evidence = rank.products.map((p) => {
    const row = labels.find(
      (r) => r._id === p.productId && r.storeId === storeId,
    );
    const label = row
      ? z.string().trim().min(1).max(240).parse(row.label)
      : "Produit à identifier";
    return copilotEvidenceSchema.parse({
      id: `waste-driver/${p.productId}/${period.start}/${period.end}/${revision}`,
      sourceType: "KPI",
      sourceId: p.productId,
      sourceVersion: null,
      label,
      value: p.amount,
      factKind: "DERIVED",
      detail: `Casse renseignée valorisée au prix de vente, du ${period.start} au ${period.end}. ${p.knownDays} journées avec un montant connu ; ${p.incompleteDays} journées de qualité incomplète parmi les lignes consultées. Somme des montants disponibles, pas une estimation des jours absents ni un coût d’achat perdu. Le classement porte sur les produits renseignés et ne prouve pas la cause de la casse.`,
    });
  });
  return {
    drivers: wasteDriversSchema.parse({
      aggregation: "SUM",
      status: rank.knownProductCount ? "AVAILABLE" : "UNAVAILABLE",
      products: rank.products.map((p, i) => ({
        productId: p.productId,
        label: evidence[i]!.label,
        evidenceId: evidence[i]!.id,
      })),
    }),
    evidence,
  };
}
