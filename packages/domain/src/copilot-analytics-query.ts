import { copilotChartRequestSchema } from "./copilot-chart";
import { z } from "zod";
import { copilotAnalysisPeriodSchema } from "./copilot-context-tools";
import { productCategorySchema, productNatureSchema } from "./products";
/** Analytical plan only. No database operators, tenant/actor, collection or code. */
export const copilotAnalyticsQuerySchema = z
  .strictObject({
    currentPeriod: copilotAnalysisPeriodSchema,
    referenceMode: z.enum(["ISO_YEAR", "CUSTOM"]).optional(),
    chart: copilotChartRequestSchema.optional(),
    referencePeriod: copilotAnalysisPeriodSchema.nullable(),
    groupBy: z.enum(["PRODUCT", "CATEGORY", "NATURE", "DAY", "TOTAL"]),
    metrics: z
      .array(z.enum(["sales", "margin", "waste"]))
      .min(1)
      .max(3),
    aggregation: z.enum(["SUM", "AVERAGE"]),
    includeSalesMeasures: z.boolean().optional(),
    includeSalesConcentration: z.boolean().optional(),
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
      v.chart &&
      (v.metrics.length !== 1 ||
        (v.chart.measure !== "CURRENT" && !v.referencePeriod))
    )
      c.addIssue({
        code: "custom",
        message: "Charts require one metric and a reference for comparison",
      });
    if (
      v.chart &&
      (v.chart.value ?? "AMOUNT") !== "AMOUNT" &&
      (!v.includeSalesMeasures ||
        v.groupBy !== "PRODUCT" ||
        v.metrics[0] !== "sales" ||
        v.chart.measure === "CHANGE")
    )
      c.addIssue({
        code: "custom",
        message:
          "Quantity/realized-price charts require PRODUCT sales with includeSalesMeasures; CURRENT or CURRENT_REFERENCE only",
      });
    if (
      v.chart?.type === "LINE" &&
      (((v.chart.value ?? "AMOUNT") === "AMOUNT"
        ? v.groupBy !== "TOTAL"
        : v.groupBy !== "PRODUCT" || v.filters.productIds?.length !== 1) ||
        v.chart.measure === "CHANGE" ||
        Date.parse(v.currentPeriod.end) - Date.parse(v.currentPeriod.start) >
          30 * 86400000)
    )
      c.addIssue({
        code: "custom",
        message:
          "Trend charts require TOTAL amounts or one PRODUCT quantity/price, CURRENT or CURRENT_REFERENCE and at most 31 days",
      });
    if (
      v.includeSalesConcentration &&
      (v.groupBy !== "PRODUCT" ||
        v.aggregation !== "SUM" ||
        v.metrics.length !== 1 ||
        v.metrics[0] !== "sales" ||
        v.having !== null)
    )
      c.addIssue({
        code: "custom",
        message:
          "Sales concentration requires PRODUCT sales SUM and no having condition",
      });
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
