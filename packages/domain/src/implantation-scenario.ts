import { z } from "zod";

// Integer millimetres avoid rounding-dependent edge/collision decisions.
const length = z.number().int().min(1).max(100_000).nullable();
const coordinate = z.number().int().min(0).max(100_000).nullable();
const key = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);
const rectangle = z.strictObject({
  id: key,
  label: z.string().trim().min(1).max(80),
  xMm: coordinate,
  yMm: coordinate,
  widthMm: length,
  depthMm: length,
});
/** Hypothetical geometry, not confirmed store measurements or a business write. */
export const implantationScenarioInputSchema = z
  .strictObject({
    space: z.strictObject({
      widthMm: length,
      depthMm: length,
      maxHeightMm: length,
    }),
    expectedCounts: z.strictObject({
      TG: z.number().int().min(0).max(8).nullable(),
      ISLAND: z.number().int().min(0).max(8).nullable(),
    }),
    fixtures: z
      .array(
        rectangle.extend({
          kind: z.enum(["TG", "ISLAND"]),
          rotation: z.union([z.literal(0), z.literal(90)]),
          heightMm: length,
          maxLoadKg: z.number().finite().min(0).max(100_000).nullable(),
          loadKg: z.number().finite().min(0).max(100_000).nullable(),
        }),
      )
      .min(1)
      .max(8),
    obstacles: z.array(rectangle).max(6).nullable(),
    reservedAreas: z
      .array(
        rectangle.extend({
          kind: z.enum(["PASSAGE", "ENTRANCE"]),
          minimumWidthMm: length,
        }),
      )
      .max(4)
      .nullable(),
  })
  .superRefine((s, ctx) => {
    const ids = [
      ...s.fixtures,
      ...(s.obstacles ?? []),
      ...(s.reservedAreas ?? []),
    ].map((v) => v.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: "custom",
        message: "Chaque élément doit avoir un identifiant distinct.",
      });
  });
export type ImplantationScenarioInput = z.infer<
  typeof implantationScenarioInputSchema
>;
export const implantationIssueSchema = z.strictObject({
  code: z.enum([
    "MISSING_MEASUREMENT",
    "COUNTS_UNKNOWN",
    "INVENTORY_UNKNOWN",
    "COUNT_MISMATCH",
    "OUT_OF_BOUNDS",
    "COLLISION",
    "RESERVED_AREA_BLOCKED",
    "PASSAGE_TOO_NARROW",
    "HEIGHT_EXCEEDED",
    "LOAD_EXCEEDED",
  ]),
  severity: z.enum(["MISSING", "BLOCKING"]),
  targets: z.array(z.string().min(1).max(120)).min(1).max(2),
  message: z.string().min(1).max(500),
});
export const implantationScenarioResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  authority: z.literal("PROVISIONAL"),
  status: z.enum(["CHECKED", "INCOMPLETE", "BLOCKED"]),
  input: implantationScenarioInputSchema,
  counts: z.strictObject({
    TG: z.number().int().min(0).max(8),
    ISLAND: z.number().int().min(0).max(8),
  }),
  footprints: z
    .array(
      z.strictObject({
        id: key,
        xMm: z.number().int().min(0),
        yMm: z.number().int().min(0),
        widthMm: z.number().int().positive(),
        depthMm: z.number().int().positive(),
      }),
    )
    .max(18),
  issues: z.array(implantationIssueSchema).max(200),
});
export type ImplantationScenarioResult = z.infer<
  typeof implantationScenarioResultSchema
>;
