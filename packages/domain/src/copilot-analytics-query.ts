import { z } from "zod";
import { copilotAnalysisPeriodSchema } from "./copilot-context-tools";
import { productCategorySchema, productNatureSchema } from "./products";
/** Analytical plan only. No database operators, tenant/actor, collection or code. */
export const copilotAnalyticsQuerySchema = z
  .strictObject({
    currentPeriod: copilotAnalysisPeriodSchema,
    referencePeriod: copilotAnalysisPeriodSchema.nullable(),
    groupBy: z.enum(["PRODUCT", "CATEGORY", "NATURE", "DAY", "TOTAL"]),
    metrics: z
      .array(z.enum(["sales", "margin", "waste"]))
      .min(1)
      .max(3),
    aggregation: z.enum(["SUM", "AVERAGE"]),
    includeSalesMeasures: z.boolean().optional(),
    filters: z.strictObject({
      productIds: z.array(z.uuid()).min(1).max(100).nullable(),
      labelContains: z.string().trim().min(1).max(100).nullable(),
      category: productCategorySchema.nullable(),
      nature: productNatureSchema.nullable(),
    }),
    having: z
      .strictObject({
        metric: z.enum(["sales", "margin", "waste"]),
        value: z.enum(["CURRENT", "REFERENCE", "CHANGE", "CHANGE_PERCENT"]),
        operator: z.enum(["GT", "GTE", "LT", "LTE"]),
        threshold: z
          .string()
          .max(100)
          .regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/)
          .refine((v) => !/^-0(?:\.0+)?$/.test(v)),
      })
      .nullable(),
    sort: z.strictObject({
      metric: z.enum(["sales", "margin", "waste"]),
      value: z.enum([
        "CURRENT",
        "REFERENCE",
        "CHANGE",
        "CHANGE_PERCENT",
        "GROUP",
      ]),
      direction: z.enum(["ASC", "DESC"]),
    }),
    offset: z.number().int().min(0).max(10000),
    limit: z.number().int().min(1).max(20),
  })
  .superRefine((v, c) => {
    if (
      v.includeSalesMeasures &&
      (v.groupBy !== "PRODUCT" || v.limit > 10 || !v.metrics.includes("sales"))
    )
      c.addIssue({
        code: "custom",
        message:
          "Sales quantities and realized prices require PRODUCT groups, sales and pages of at most ten products",
      });
    if (
      new Set(v.metrics).size !== v.metrics.length ||
      !v.metrics.includes(v.sort.metric) ||
      (v.having !== null && !v.metrics.includes(v.having.metric))
    )
      c.addIssue({
        code: "custom",
        message: "Sort metric must be selected; metrics must be unique",
      });
    if (
      (v.sort.value !== "CURRENT" &&
        v.sort.value !== "GROUP" &&
        !v.referencePeriod) ||
      (v.groupBy === "DAY" && v.referencePeriod) ||
      (v.having && v.having.value !== "CURRENT" && !v.referencePeriod)
    )
      c.addIssue({
        code: "custom",
        message:
          "A comparison requires reference periods; DAY groups use one period",
      });
    if (
      v.filters.productIds &&
      new Set(v.filters.productIds).size !== v.filters.productIds.length
    )
      c.addIssue({ code: "custom", message: "Duplicate product IDs" });
  });
export type CopilotAnalyticsQuery = z.infer<typeof copilotAnalyticsQuerySchema>;
