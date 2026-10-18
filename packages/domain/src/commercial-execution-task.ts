import { z } from "zod";
/** User declarations, never inferred from a planned offer or a completion timestamp. */
export const commercialExecutionActualsSchema = z
  .strictObject({
    start: z.iso.date().nullable(),
    end: z.iso.date().nullable(),
    price: z
      .string()
      .regex(/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/)
      .nullable(),
    priceUnit: z.enum(["KG", "PIECE", "PACK"]).nullable(),
    location: z.string().trim().min(1).max(160).nullable(),
  })
  .superRefine((v, c) => {
    if (v.end && (!v.start || v.end < v.start))
      c.addIssue({
        code: "custom",
        path: ["end"],
        message: "La fin réelle doit suivre le début réel.",
      });
    if ((v.price === null) !== (v.priceUnit === null))
      c.addIssue({
        code: "custom",
        path: ["price"],
        message: "Renseignez ensemble le prix et son unité.",
      });
    if (Object.values(v).every((x) => x === null))
      c.addIssue({
        code: "custom",
        message:
          "Renseignez au moins une information réelle, ou effacez les détails.",
      });
  });
/** Only requested fields are edited; omitted subfields retain recorded values. */
export const commercialExecutionActualsPatchSchema = z
  .strictObject({
    start: commercialExecutionActualsSchema.shape.start.optional(),
    end: commercialExecutionActualsSchema.shape.end.optional(),
    price: commercialExecutionActualsSchema.shape.price.optional(),
    priceUnit: commercialExecutionActualsSchema.shape.priceUnit.optional(),
    location: commercialExecutionActualsSchema.shape.location.optional(),
  })
  .refine(
    (v) => Object.values(v).some((x) => x !== undefined),
    "Précisez les champs à modifier.",
  );
export type CommercialExecutionActuals = z.infer<
  typeof commercialExecutionActualsSchema
>;
export function commercialExecutionActualsNotFuture(
  actuals: Partial<CommercialExecutionActuals> | null | undefined,
  now: string,
) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
  return (
    !actuals || [actuals.start, actuals.end].every((d) => !d || d <= today)
  );
}
/** Omission preserves known data; null is an explicit reviewed removal. */
export function executionActualsUpdate(
  before: CommercialExecutionTask | null | undefined,
  input: { actuals?: Partial<CommercialExecutionActuals> | null },
): { actuals?: CommercialExecutionActuals | null } {
  if (input.actuals === undefined)
    return before?.actuals === undefined ? {} : { actuals: before.actuals };
  if (input.actuals === null) return { actuals: null };
  const next = {
    start: null,
    end: null,
    price: null,
    priceUnit: null,
    location: null,
    ...before?.actuals,
    ...input.actuals,
  };
  return {
    actuals: Object.values(next).every((v) => v === null)
      ? null
      : commercialExecutionActualsSchema.parse(next),
  };
}
export function legacyCommercialExecution(
  task: CommercialExecutionTask,
): Omit<CommercialExecutionTask, "actuals"> {
  const { actuals, ...legacy } = commercialExecutionTaskSchema.parse(task);
  void actuals;
  return legacy;
}
export const commercialExecutionTaskSchema = z
  .object({
    id: z.string().uuid(),
    storeId: z.string().uuid(),
    planId: z.string().uuid(),
    planRevisionId: z.string().uuid(),
    planVersion: z.number().int().positive(),
    planChecksum: z.string().regex(/^[a-f0-9]{64}$/),
    kind: z.enum(["PRINT_SIGNAGE", "INSTALL_TG"]),
    targetId: z.string().uuid(),
    label: z.string().trim().min(1).max(400),
    status: z.enum(["TODO", "DONE", "SKIPPED", "NOT_APPLICABLE"]),
    note: z.string().trim().max(1200),
    completedAt: z.string().datetime().nullable(),
    actuals: commercialExecutionActualsSchema.nullable().optional(),
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((t, c) => {
    if ((t.status === "DONE") !== (t.completedAt !== null))
      c.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "La date de déclaration doit correspondre au statut Fait.",
      });
    if (["SKIPPED", "NOT_APPLICABLE"].includes(t.status) && !t.note)
      c.addIssue({
        code: "custom",
        path: ["note"],
        message: "Précisez pourquoi la tâche est ignorée ou non applicable.",
      });
  });
export type CommercialExecutionTask = z.infer<
  typeof commercialExecutionTaskSchema
>;

/** Structural task target identity shared by validators and the execution engine. */
export function commercialExecutionTargetMatches(
  left: CommercialExecutionTask,
  right: Pick<
    CommercialExecutionTask,
    | "id"
    | "storeId"
    | "planId"
    | "planRevisionId"
    | "planVersion"
    | "planChecksum"
    | "kind"
    | "targetId"
    | "label"
  >,
) {
  return (
    [
      "id",
      "storeId",
      "planId",
      "planRevisionId",
      "planVersion",
      "planChecksum",
      "kind",
      "targetId",
      "label",
    ] as const
  ).every((key) => left[key] === right[key]);
}

export function commercialExecutionActualsSummary(
  actuals: CommercialExecutionActuals | null | undefined,
) {
  if (!actuals) return "Dates, prix et emplacement réels non renseignés.";
  const date = (s: string) => s.split("-").reverse().join("/");
  const unit = { KG: "kg", PIECE: "pièce", PACK: "unité conditionnée" };
  return [
    actuals.start
      ? `Début réel déclaré : ${date(actuals.start)}.`
      : "Début réel non renseigné.",
    actuals.end
      ? `Fin réelle déclarée : ${date(actuals.end)}.`
      : "Fin réelle non renseignée.",
    actuals.price !== null
      ? `Prix déclaré : ${actuals.price.replace(".", ",")} € / ${unit[actuals.priceUnit!]}.`
      : "Prix réel non renseigné.",
    actuals.location
      ? `Emplacement déclaré : ${actuals.location}.`
      : "Emplacement réel non renseigné.",
  ].join(" ");
}
