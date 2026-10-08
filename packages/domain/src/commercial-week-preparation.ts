import { z } from "zod";
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const d = new Date(`${value}T00:00:00Z`);
    return (
      Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value
    );
  });
export const commercialWeekPreparationSchema = z
  .object({
    id: z.string().uuid(),
    storeId: z.string().uuid(),
    weekStart: date,
    weekEnd: date,
    status: z.literal("DRAFT"),
    tgCapacity: z.number().int().min(0).max(30).nullable(),
    offerRefs: z
      .array(
        z
          .object({
            choiceId: z.string().uuid(),
            choiceVersion: z.number().int().positive(),
          })
          .strict(),
      )
      .max(100),
    placements: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            label: z.string().trim().min(1).max(80),
            theme: z.string().trim().max(240),
            offerIds: z.array(z.string().uuid()).max(20),
            sourceIdea: z
              .object({
                readingId: z.string().uuid(),
                checksum: z.string().min(1),
                tgIndex: z.number().int().min(0).max(19),
              })
              .strict()
              .nullable(),
          })
          .strict(),
      )
      .max(30),
    note: z.string().trim().max(1200),
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((plan, ctx) => {
    const start = new Date(`${plan.weekStart}T00:00:00Z`);
    if (
      !Number.isFinite(start.getTime()) ||
      start.getUTCDay() !== 1 ||
      new Date(start.getTime() + 6 * 86400000).toISOString().slice(0, 10) !==
        plan.weekEnd
    )
      ctx.addIssue({
        code: "custom",
        path: ["weekStart"],
        message:
          "La préparation doit couvrir une semaine du lundi au dimanche.",
      });
    if (
      plan.placements.length &&
      (plan.tgCapacity === null || plan.placements.length > plan.tgCapacity)
    )
      ctx.addIssue({
        code: "custom",
        path: ["tgCapacity"],
        message:
          "Précisez assez de TG disponibles pour les emplacements préparés.",
      });
    const included = new Set(plan.offerRefs.map((r) => r.choiceId));
    if (included.size !== plan.offerRefs.length)
      ctx.addIssue({
        code: "custom",
        path: ["offerRefs"],
        message: "Une offre apparaît plusieurs fois dans la sélection.",
      });
    if (
      new Set(plan.placements.map((p) => p.id)).size !==
        plan.placements.length ||
      new Set(
        plan.placements.map((p) =>
          p.label.normalize("NFKC").toLocaleLowerCase("fr-FR"),
        ),
      ).size !== plan.placements.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["placements"],
        message: "Chaque TG doit avoir un nom distinct.",
      });
    plan.placements.forEach((p, index) => {
      if (
        new Set(p.offerIds).size !== p.offerIds.length ||
        p.offerIds.some((id) => !included.has(id))
      )
        ctx.addIssue({
          code: "custom",
          path: ["placements", index],
          message:
            "Affectez uniquement des offres sélectionnées, sans doublon dans la TG.",
        });
    });
  });
export type CommercialWeekPreparation = z.infer<
  typeof commercialWeekPreparationSchema
>;
