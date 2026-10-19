import { productCategorySchema, productNatureSchema } from "./products";
import { z } from "zod";
import {
  analyticsExplorerContextSchema,
  analyticsExplorerMetricSchema,
  analyticsExplorerPeriodSchema,
  type AnalyticsExplorerContext,
} from "./analytics-explorer";
const index = z.number().int().min(0).max(95);
const filter = z.strictObject({
  category: productCategorySchema.nullable().optional(),
  nature: productNatureSchema.nullable().optional(),
  productId: z.uuid().nullable().optional(),
  labelContains: z.string().trim().min(1).max(100).nullable().optional(),
  productSet: index.nullable().optional(),
});
const base = z.strictObject({
  version: z.literal(1),
  periods: z.array(analyticsExplorerPeriodSchema).min(1).max(96),
  filters: z.array(filter).min(1).max(96),
  productSets: z
    .array(
      z
        .array(z.uuid())
        .min(1)
        .max(100)
        .refine((v) => new Set(v).size === v.length),
    )
    .max(96),
  targets: z
    .array(
      z.tuple([
        index,
        index,
        analyticsExplorerMetricSchema,
        z.enum(["MONETARY", "RELATED_AMOUNTS"]).nullable(),
      ]),
    )
    .min(1)
    .max(96),
});
type Table = z.infer<typeof base>;
function destination(table: Table, at: number): AnalyticsExplorerContext {
  const target = table.targets[at];
  if (!target || !table.periods[target[0]] || !table.filters[target[1]])
    throw Error("ANALYTICS_DESTINATION_MISSING");
  const { productSet, ...selected } = table.filters[target[1]]!;
  if (typeof productSet === "number" && !table.productSets[productSet])
    throw Error("ANALYTICS_DESTINATION_MISSING");
  return analyticsExplorerContextSchema.parse({
    schemaVersion: 1,
    ...(target[3] === null ? {} : { relation: target[3] }),
    period: table.periods[target[0]],
    metric: target[2],
    filters: {
      ...selected,
      ...(typeof productSet === "number"
        ? { productIds: table.productSets[productSet] }
        : productSet === null
          ? { productIds: null }
          : {}),
    },
  });
}
/** Private presentation payload, bounded independently of the readable 16k message. */
export const analyticsDestinationTableSchema = base.superRefine(
  (table, ctx) => {
    // ASCII-escaped length bounds actual UTF-8 JSON size on every JS runtime.
    if (
      JSON.stringify(table).replace(/[\u0080-\uffff]/g, "\\u0000").length >
      16384
    )
      ctx.addIssue({
        code: "custom",
        message: "ANALYTICS_DESTINATIONS_TOO_LARGE",
      });
    for (let at = 0; at < table.targets.length; at++) {
      try {
        destination(table, at);
      } catch {
        ctx.addIssue({
          code: "custom",
          path: ["targets", at],
          message: "Invalid analytical destination",
        });
      }
    }
  },
);
export type AnalyticsDestinationTable = z.infer<
  typeof analyticsDestinationTableSchema
>;
export function packAnalyticsDestinations(
  contexts: readonly AnalyticsExplorerContext[],
): AnalyticsDestinationTable | undefined {
  if (!contexts.length) return undefined;
  const periods: Table["periods"] = [],
    filters: Table["filters"] = [],
    productSets: Table["productSets"] = [],
    targets: Table["targets"] = [];
  function intern<T>(values: T[], value: T) {
    const serialized = JSON.stringify(value),
      existing = values.findIndex((v) => JSON.stringify(v) === serialized);
    if (existing >= 0) return existing;
    values.push(value);
    return values.length - 1;
  }
  for (const raw of contexts) {
    const c = analyticsExplorerContextSchema.parse(raw),
      { productIds, ...rest } = c.filters;
    const selected: z.infer<typeof filter> = Object.fromEntries(
      Object.entries(rest).filter(
        ([k, v]) => v !== undefined && (v !== null || k === "labelContains"),
      ),
    );
    if (productIds === null) selected.productSet = null;
    else if (productIds) selected.productSet = intern(productSets, productIds);
    targets.push([
      intern(periods, c.period),
      intern(filters, selected),
      c.metric,
      c.relation ?? null,
    ]);
  }
  return analyticsDestinationTableSchema.parse({
    version: 1,
    periods,
    filters,
    productSets,
    targets,
  });
}
export function readAnalyticsDestination(
  raw: unknown,
  at: number,
): AnalyticsExplorerContext {
  return destination(
    analyticsDestinationTableSchema.parse(raw),
    index.parse(at),
  );
}
