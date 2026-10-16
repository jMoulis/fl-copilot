import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import { z } from "zod";
import {
  copilotAnalyticsQuerySchema,
  copilotEvidenceSchema,
  type CopilotAnalyticsQuery,
} from "@fl-copilot/domain";
import {
  analyticsQueryProductSchema,
  ANALYTICS_QUERY_LIMITS,
  analyticsProductMatches,
  executeAnalyticsQuery,
  type AnalyticsQueryPoint,
} from "@fl-copilot/analytics-core";
import { departmentEvidencePerformanceSchema } from "./daily-evidence.js";
const performanceSchema = departmentEvidencePerformanceSchema.extend({
  productId: z.uuid(),
  formulaVersion: z.literal("product-daily-v1"),
});
const decimal = z
  .string()
  .regex(/^-?\d+(?:\.\d+)?$/)
  .nullable();
const coverage = z.strictObject({
  expectedDays: z.number().int().positive(),
  availableDays: z.number().int().nonnegative(),
  partialDays: z.number().int().nonnegative(),
  missingDays: z.number().int().nonnegative(),
  missingDateExamples: z.array(z.string().date()).max(14),
});
export const analyticsQueryResultSchema = z.strictObject({
  query: copilotAnalyticsQuerySchema,
  status: z.enum(["AVAILABLE", "EMPTY", "UNAVAILABLE", "LIMIT_EXCEEDED"]),
  totalGroups: z.number().int().nonnegative(),
  evaluatedGroups: z.number().int().nonnegative(),
  unknownConditionGroups: z.number().int().nonnegative(),
  knownGroups: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  nextOffset: z.number().int().nonnegative().nullable(),
  unresolvedProductIds: z.array(z.uuid()).max(100),
  scope: z.literal("OBSERVED_PRODUCT_DAYS_CURRENT_CATALOGUE"),
  rows: z
    .array(
      z.strictObject({
        key: z.string().max(100),
        label: z.string().max(280),
        productCount: z.number().int().nonnegative(),
        metrics: z
          .array(
            z.strictObject({
              metric: z.enum(["sales", "margin", "waste"]),
              current: decimal,
              reference: decimal,
              change: decimal,
              changePercent: decimal,
              currentCoverage: coverage,
              referenceCoverage: coverage.nullable(),
              warnings: z.array(z.string()).max(10),
              evidenceIds: z.strictObject({
                current: z.string(),
                reference: z.string().nullable(),
                change: z.string().nullable(),
                changePercent: z.string().nullable(),
              }),
            }),
          )
          .min(1)
          .max(3),
      }),
    )
    .max(20),
  evidence: z.array(copilotEvidenceSchema).max(241),
});
/** Server-owned Mongo plan: scoped canonical snapshots only, no raw model query/code. */
export async function readAnalyticsQuery(
  db: Db,
  storeId: string,
  raw: unknown,
) {
  z.uuid().parse(storeId);
  const query = copilotAnalyticsQuerySchema.parse(raw);
  const catalogue = await db
    .collection<{
      _id: string;
      storeId: string;
      label: string;
      category?: unknown;
      nature?: unknown;
    }>("products")
    .find(
      { storeId },
      { projection: { _id: 1, storeId: 1, label: 1, category: 1, nature: 1 } },
    )
    .maxTimeMS(3000)
    .limit(ANALYTICS_QUERY_LIMITS.maxProducts + 1)
    .toArray();
  const limited = (unresolvedProductIds: string[] = []) =>
    analyticsQueryResultSchema.parse({
      query,
      status: "LIMIT_EXCEEDED",
      scope: "OBSERVED_PRODUCT_DAYS_CURRENT_CATALOGUE",
      totalGroups: 0,
      evaluatedGroups: 0,
      unknownConditionGroups: 0,
      knownGroups: 0,
      hasMore: false,
      nextOffset: null,
      unresolvedProductIds,
      rows: [],
      evidence: [],
    });
  if (catalogue.length > ANALYTICS_QUERY_LIMITS.maxProducts) return limited();
  const products = catalogue.map((p) => {
    if (p.storeId !== storeId) throw Error("ANALYTICS_QUERY_SCOPE_INVALID");
    return analyticsQueryProductSchema.parse({
      id: p._id,
      label: p.label,
      category: p.category ?? "UNKNOWN",
      nature: p.nature ?? "UNKNOWN",
    });
  });
  const unresolvedProductIds = (query.filters.productIds ?? []).filter(
    (id) => !products.some((p) => p.id === id),
  );
  const filtered = Object.values(query.filters).some((v) => v !== null);
  const ids = products
    .filter((p) => analyticsProductMatches(p, query.filters))
    .map((p) => p.id);
  const ranges = [
    query.currentPeriod,
    ...(query.referencePeriod ? [query.referencePeriod] : []),
  ];
  const rows =
    filtered && !ids.length
      ? []
      : await db
          .collection<{
            _id: string;
            storeId: string;
            productId: string;
            date: string;
            performance: unknown;
          }>("productDailyPerformance")
          .find(
            {
              storeId,
              ...(filtered ? { productId: { $in: ids } } : {}),
              $or: ranges.map((r) => ({
                date: { $gte: r.start, $lte: r.end },
              })),
            },
            {
              projection: {
                _id: 1,
                storeId: 1,
                productId: 1,
                date: 1,
                "performance.storeId": 1,
                "performance.productId": 1,
                "performance.date": 1,
                "performance.formulaVersion": 1,
                "performance.inputRevision": 1,
                "performance.computedAt": 1,
                "performance.sales.salesValue": 1,
                "performance.sales.marginValue": 1,
                "performance.waste.salesValue": 1,
                "performance.availability": 1,
              },
            },
          )
          .maxTimeMS(5000)
          .limit(ANALYTICS_QUERY_LIMITS.maxPoints + 1)
          .toArray();
  if (rows.length > ANALYTICS_QUERY_LIMITS.maxPoints)
    return limited(unresolvedProductIds);
  const revisions: string[] = [];
  const points: AnalyticsQueryPoint[] = rows.map((row) => {
    const p = performanceSchema.parse(row.performance);
    if (
      row.storeId !== storeId ||
      p.storeId !== storeId ||
      p.productId !== row.productId ||
      p.date !== row.date
    )
      throw Error("ANALYTICS_QUERY_SCOPE_INVALID");
    revisions.push(JSON.stringify([row._id, p.inputRevision]));
    return {
      storeId,
      productId: p.productId,
      businessDate: p.date,
      sales: {
        value: p.sales.salesValue,
        status: p.availability.salesValue.status,
      },
      margin: {
        value: p.sales.marginValue,
        status: p.availability.salesMarginValue.status,
      },
      waste: {
        value: p.waste.salesValue,
        status: p.availability.wasteSalesValue.status,
      },
    };
  });
  let result: ReturnType<typeof executeAnalyticsQuery>;
  try {
    result = executeAnalyticsQuery({ storeId, query, products, points });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "ANALYTICS_QUERY_LIMIT_EXCEEDED"
    )
      return limited(unresolvedProductIds);
    throw error;
  }
  const revision = createHash("sha256")
    .update(
      JSON.stringify([
        storeId,
        query,
        revisions.sort(),
        [...products].sort((a, b) => a.id.localeCompare(b.id)),
      ]),
    )
    .digest("hex");
  const evidence: z.infer<typeof copilotEvidenceSchema>[] = [];
  const period = `${query.currentPeriod.start} au ${query.currentPeriod.end}`;
  const sourceId = `analytics-query/${revision}`;
  const add = (
    id: string,
    label: string,
    value: string | null,
    detail: string,
    sourceType: "KPI" | "COMPARISON" | "DATA_QUALITY" = "KPI",
  ) => {
    evidence.push(
      copilotEvidenceSchema.parse({
        id,
        sourceId,
        sourceType,
        sourceVersion: null,
        label,
        value,
        detail,
        factKind: sourceType === "DATA_QUALITY" ? "QUALITY" : "DERIVED",
      }),
    );
    return id;
  };
  const metricLabels = {
    sales: "CA net (€)",
    margin: "Marge (€)",
    waste: "Casse au prix de vente (€)",
  };
  const resultRows = result.rows.map((r, i) => ({
    ...r,
    metrics: r.metrics.map((m) => {
      const base = `${sourceId}/${query.offset + i}/${m.metric}`;
      const c = m.currentCoverage,
        ref = m.referenceCoverage;
      const detail = `${metricLabels[m.metric]} · ${r.label} · ${period}. ${query.aggregation === "SUM" ? "Somme" : "Moyenne des jours renseignés"}. ${c.availableDays} jours complets, ${c.partialDays} partiels, ${c.missingDays} absents ou indisponibles sur ${c.expectedDays}. Univers des produits/journées observés, pas estimation des absents. Classification actuelle du catalogue. ${query.referencePeriod ? `Référence ${query.referencePeriod.start} au ${query.referencePeriod.end} ; ${ref?.missingDays ?? 0} jours absents/indisponibles. ${m.warnings.join(", ")}.` : ""} Une variation ne prouve pas une cause.`;
      return {
        ...m,
        evidenceIds: {
          current: add(`${base}/current`, r.label, m.current, detail),
          reference: query.referencePeriod
            ? add(
                `${base}/reference`,
                `${r.label} — référence — ${metricLabels[m.metric]}`,
                m.reference,
                detail,
              )
            : null,
          change: query.referencePeriod
            ? add(
                `${base}/change`,
                `${r.label} — variation (€)`,
                m.change,
                detail,
                "COMPARISON",
              )
            : null,
          changePercent: query.referencePeriod
            ? add(
                `${base}/percent`,
                `${r.label} — variation (%)`,
                m.changePercent,
                detail,
                "COMPARISON",
              )
            : null,
        },
      };
    }),
  }));
  add(
    `${sourceId}/scope`,
    "Périmètre du classement",
    `${result.totalGroups} groupes correspondants sur ${result.evaluatedGroups} évalués ; ${result.unknownConditionGroups} exclus de la condition faute de valeur comparable ; ${query.offset} résultats précédents ; ${result.rows.length} affichés ; ${result.hasMore ? "suite disponible" : "fin des résultats"}.`,
    `Période ${period}. Regroupement ${query.groupBy}, indicateurs ${query.metrics.join(", ")}, tri ${query.sort.metric}/${query.sort.value}/${query.sort.direction}. Classement calculé sur l’ensemble des groupes avant pagination. Jours absents et valeurs nulles non remplacés par zéro ; couverture conservée par groupe. Filtres et catégories du catalogue actuel ; produits retirés conservés pour les chiffres historiques.`,
    "DATA_QUALITY",
  );
  return analyticsQueryResultSchema.parse({
    ...result,
    rows: resultRows,
    status: !result.totalGroups
      ? result.unknownConditionGroups
        ? "UNAVAILABLE"
        : "EMPTY"
      : result.knownGroups
        ? "AVAILABLE"
        : "UNAVAILABLE",
    scope: "OBSERVED_PRODUCT_DAYS_CURRENT_CATALOGUE",
    unresolvedProductIds,
    evidence,
  });
}
export type AnalyticsQueryResult = z.infer<typeof analyticsQueryResultSchema>;
export type AnalyticsQueryInput = CopilotAnalyticsQuery;
