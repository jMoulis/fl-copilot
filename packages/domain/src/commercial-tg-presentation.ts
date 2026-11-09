import { z } from "zod";

/** A qualitative surface proposal, never measured geometry or a sales forecast. */
export const commercialTgPresentationSchema = z
  .strictObject({
    zones: z
      .array(
        z.strictObject({
          label: z.string().trim().min(1).max(80),
          sharePct: z.number().int().min(1).max(100),
          role: z.enum(["ACCROCHE", "RELAIS", "GAMME"]),
        }),
      )
      .min(1)
      .max(6),
    reason: z.string().trim().max(240),
    counterPromotion: z
      .strictObject({
        label: z.string().trim().min(1).max(80),
        reason: z.string().trim().max(160),
      })
      .nullable(),
  })
  .superRefine((v, c) => {
    if (v.zones.reduce((s, z) => s + z.sharePct, 0) !== 100)
      c.addIssue({
        code: "custom",
        path: ["zones"],
        message: "La surface proposée doit totaliser 100 %.",
      });
    if (
      new Set(
        v.zones.map((z) =>
          z.label.normalize("NFKC").toLocaleLowerCase("fr-FR"),
        ),
      ).size !== v.zones.length
    )
      c.addIssue({
        code: "custom",
        path: ["zones"],
        message: "Chaque produit doit apparaître dans une seule zone de la TG.",
      });
  });
export type CommercialTgPresentation = z.infer<
  typeof commercialTgPresentationSchema
>;

/** Redistribute the remaining surface proportionally; integer totals and every zone survive. */
export function resizeTgPresentationZone(
  raw: unknown,
  index: number,
  sharePct: number,
) {
  const value = commercialTgPresentationSchema.parse(raw);
  z.number()
    .int()
    .min(0)
    .max(value.zones.length - 1)
    .parse(index);
  if (value.zones.length === 1) {
    if (sharePct !== 100) throw Error("TG_SURFACE_TOTAL");
    return value;
  }
  z.number()
    .int()
    .min(1)
    .max(101 - value.zones.length)
    .parse(sharePct);
  const others = value.zones
    .map((z, i) => ({ i, weight: z.sharePct }))
    .filter((z) => z.i !== index);
  const remaining = 100 - sharePct - others.length;
  const weight = others.reduce((s, z) => s + z.weight, 0);
  const allocation = others.map((z) => ({
    ...z,
    exact: (remaining * z.weight) / weight,
    assigned: 1 + Math.floor((remaining * z.weight) / weight),
  }));
  let leftover =
    100 - sharePct - allocation.reduce((s, z) => s + z.assigned, 0);
  const ranked = [...allocation].sort(
    (a, b) =>
      b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)) ||
      a.i - b.i,
  );
  for (const z of ranked) {
    if (!leftover) break;
    z.assigned++;
    leftover--;
  }
  value.zones[index]!.sharePct = sharePct;
  for (const z of allocation) value.zones[z.i]!.sharePct = z.assigned;
  return commercialTgPresentationSchema.parse(value);
}

/** Absence preserves older plans; null is an explicit removal. */
export function hasCommercialTgPresentations(
  placements: readonly { presentation?: unknown }[],
) {
  return placements.some((p) => p.presentation !== undefined);
}
export function dropsCommercialTgPresentation(
  before: readonly { id: string; presentation?: unknown }[],
  after: readonly { id: string; presentation?: unknown }[],
) {
  return before.some(
    (p) =>
      p.presentation != null &&
      after.some((a) => a.id === p.id && a.presentation === undefined),
  );
}
