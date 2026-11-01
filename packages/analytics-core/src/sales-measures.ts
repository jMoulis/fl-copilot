import { z } from "zod";
import {
  computeAverageRealizedPrice,
  sumAvailableCurrency,
  sumCompatibleQuantities,
} from "./formulas";

const metric = z.object({
  value: z.string().nullable(),
  status: z.enum(["AVAILABLE", "PARTIAL", "UNAVAILABLE"]),
});
const unit = z.enum(["KG", "PIECE", "PACK", "UNKNOWN"]).nullable();
const reason = z
  .enum([
    "MISSING_INPUT",
    "INCOMPATIBLE_UNITS",
    "UNKNOWN_UNIT",
    "NON_POSITIVE_DENOMINATOR",
  ])
  .nullable();
export const salesMeasuresSchema = z.object({
  period: z.object({ start: z.string().date(), end: z.string().date() }),
  // Legacy snapshots remain readable; fresh Mercalys calculations always emit INCLUDING_VAT.
  taxBasis: z.enum(["INCLUDING_VAT", "UNCONFIRMED"]),
  refreshPendingDays: z.number().int().nonnegative().optional(),
  quantity: metric.extend({
    reason,
    unit,
    expectedDays: z.number().int().positive(),
    availableDays: z.number().int().nonnegative(),
    partialDays: z.number().int().nonnegative(),
    missingDays: z.number().int().nonnegative(),
  }),
  averageRealizedPrice: metric.extend({
    reason,
    unit,
    pairedDays: z.number().int().nonnegative(),
    pairedSalesValue: z.string().nullable(),
    pairedQuantity: z.string().nullable(),
  }),
});

/** Same product, same period and matching complete daily inputs. Never a mean of daily prices. */
export function calculateSalesMeasures(
  period: { start: string; end: string },
  points: readonly {
    businessDate: string;
    sales: z.infer<typeof metric>;
    soldQuantity?: z.infer<typeof metric> & {
      reason?: "MISSING_INPUT" | "UNKNOWN_UNIT" | "INCOMPATIBLE_UNITS";
    };
    quantityUnit?: z.infer<typeof unit>;
    quantityRefreshPending?: boolean;
  }[],
) {
  const rows = points
    .filter(
      (p) => p.businessDate >= period.start && p.businessDate <= period.end,
    )
    .map((p) =>
      p.quantityRefreshPending
        ? {
            ...p,
            soldQuantity: {
              value: null,
              status: "UNAVAILABLE" as const,
              reason: "MISSING_INPUT" as const,
            },
          }
        : p,
    );
  const expectedDays =
    (Date.parse(period.end) - Date.parse(period.start)) / 86400000 + 1;
  const quantity = sumCompatibleQuantities(
    rows.map((p) => ({
      value:
        p.soldQuantity?.status === "UNAVAILABLE" ? null : p.soldQuantity?.value,
      unit: p.quantityUnit ?? "UNKNOWN",
    })),
  );
  const quantityReason =
    quantity.reason === "MISSING_INPUT"
      ? (rows.find(
          (p) =>
            p.soldQuantity?.reason === "UNKNOWN_UNIT" ||
            p.soldQuantity?.reason === "INCOMPATIBLE_UNITS",
        )?.soldQuantity?.reason ?? quantity.reason)
      : quantity.reason;
  const availableDays = rows.filter(
    (p) =>
      p.soldQuantity?.value != null && p.soldQuantity.status === "AVAILABLE",
  ).length;
  const partialDays = rows.filter(
    (p) => p.soldQuantity?.value != null && p.soldQuantity.status === "PARTIAL",
  ).length;
  const missingDays = expectedDays - availableDays - partialDays;
  const paired =
    quantity.unit === null
      ? []
      : rows.filter(
          (p) =>
            p.sales.value !== null &&
            p.sales.status === "AVAILABLE" &&
            p.soldQuantity?.value != null &&
            p.soldQuantity.status === "AVAILABLE" &&
            p.quantityUnit != null &&
            p.quantityUnit !== "UNKNOWN",
        );
  const pairedQuantities = paired.map((p) => ({
    value: p.soldQuantity!.value,
    unit: p.quantityUnit! as "KG" | "PIECE" | "PACK",
  }));
  const average = computeAverageRealizedPrice(
    paired.map((p) => p.sales.value),
    pairedQuantities,
  );
  return salesMeasuresSchema.parse({
    period,
    taxBasis: "INCLUDING_VAT",
    ...(rows.some((p) => p.quantityRefreshPending)
      ? {
          refreshPendingDays: rows.filter((p) => p.quantityRefreshPending)
            .length,
        }
      : {}),
    quantity: {
      reason:
        quantityReason ??
        (rows.some((p) => p.quantityRefreshPending) ? "MISSING_INPUT" : null),
      value: quantity.value,
      unit: quantity.unit,
      status:
        quantity.status === "UNAVAILABLE"
          ? "UNAVAILABLE"
          : missingDays || partialDays
            ? "PARTIAL"
            : "AVAILABLE",
      expectedDays,
      availableDays,
      partialDays,
      missingDays,
    },
    averageRealizedPrice: {
      reason:
        quantity.unit === null
          ? (quantityReason ?? "MISSING_INPUT")
          : (average.reason ?? null),
      value: average.value,
      unit: average.unit,
      status:
        average.status === "UNAVAILABLE"
          ? "UNAVAILABLE"
          : paired.length < expectedDays
            ? "PARTIAL"
            : "AVAILABLE",
      pairedDays: paired.length,
      pairedSalesValue: sumAvailableCurrency(paired.map((p) => p.sales.value))
        .value,
      pairedQuantity: sumCompatibleQuantities(pairedQuantities).value,
    },
  });
}
