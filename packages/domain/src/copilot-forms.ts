import { z } from "zod";
import { copilotAttachmentReferenceSchema } from "./copilot-conversation";
const key = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  base = {
    key,
    label: z.string().trim().min(1).max(120),
    required: z.boolean(),
  };
export const copilotFormFieldSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...base, type: z.literal("DATE") }),
  z.strictObject({
    ...base,
    type: z.literal("NUMBER"),
    unit: z.enum(["EUR", "KG", "PIECE", "CM", "PERCENT", "NONE"]),
  }),
  z.strictObject({
    ...base,
    type: z.literal("TEXT"),
    maxLength: z.number().int().min(1).max(1200),
  }),
  z.strictObject({
    ...base,
    type: z.literal("CHOICE"),
    options: z
      .array(
        z.strictObject({
          id: z.string().min(1).max(80),
          label: z.string().trim().min(1).max(120),
        }),
      )
      .min(1)
      .max(12)
      .refine((v) => new Set(v.map((o) => o.id)).size === v.length),
  }),
  z.strictObject({ ...base, type: z.literal("FILE") }),
]);
export const copilotFormValueSchema = z.union([
  z.string().max(1200),
  copilotAttachmentReferenceSchema,
  z.null(),
]);
export const copilotFormAnswersSchema = z
  .record(key, copilotFormValueSchema)
  .refine((v) => Object.keys(v).length <= 8);
export const copilotFormDefinitionSchema = z.strictObject({
  id: z.string().uuid(),
  parentUserMessageId: z.string().uuid(),
  operationId: z.string().uuid(),
  basisToken: z.string().min(1).max(256),
  title: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(1).max(400),
  fields: z
    .array(copilotFormFieldSchema)
    .min(1)
    .max(8)
    .refine((v) => new Set(v.map((f) => f.key)).size === v.length),
  prefill: copilotFormAnswersSchema,
});
export type CopilotFormDefinition = z.infer<typeof copilotFormDefinitionSchema>;
export const copilotFormSchema = z.strictObject({
  definition: copilotFormDefinitionSchema,
  storeId: z.string().uuid(),
  ownerId: z.string().uuid(),
  conversationId: z.string().uuid(),
  answers: copilotFormAnswersSchema,
  status: z.enum(["OPEN", "READY", "POSTPONED", "CANCELLED", "STALE"]),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CopilotForm = z.infer<typeof copilotFormSchema>;
export type CopilotFormAnswers = z.infer<typeof copilotFormAnswersSchema>;
export type CopilotFormIssue = {
  key: string;
  code: "REQUIRED" | "INVALID" | "UNKNOWN_FIELD" | "SOURCE_UNAVAILABLE";
  message: string;
};
/** Partial answers remain drafts; normalized numbers are decimal strings, never financial floats. */
export function evaluateCopilotForm(
  definition: CopilotFormDefinition,
  answers: CopilotFormAnswers,
) {
  const d = copilotFormDefinitionSchema.parse(definition),
    a = copilotFormAnswersSchema.parse(answers),
    issues: CopilotFormIssue[] = [],
    normalized: CopilotFormAnswers = {};
  for (const name of Object.keys(a))
    if (!d.fields.some((f) => f.key === name))
      issues.push({
        key: name,
        code: "UNKNOWN_FIELD",
        message: "Ce champ ne fait pas partie de la question.",
      });
  for (const f of d.fields) {
    const raw = a[f.key],
      v = typeof raw === "string" ? raw.trim() : raw;
    if (v === undefined || v === null || v === "") {
      if (f.required)
        issues.push({
          key: f.key,
          code: "REQUIRED",
          message: `${f.label} : information nécessaire.`,
        });
      continue;
    }
    let valid = false,
      value = v;
    switch (f.type) {
      case "DATE":
        valid =
          typeof v === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(v) &&
          Number.isFinite(Date.parse(v + "T00:00:00Z")) &&
          new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v;
        break;
      case "NUMBER":
        valid =
          typeof v === "string" &&
          v.length <= 40 &&
          /^[+-]?\d+(?:[.,]\d{1,6})?$/.test(v);
        if (valid && typeof v === "string") value = v.replace(",", ".");
        break;
      case "TEXT":
        valid = typeof v === "string" && v.length <= f.maxLength;
        break;
      case "CHOICE":
        valid = typeof v === "string" && f.options.some((o) => o.id === v);
        break;
      case "FILE":
        valid = copilotAttachmentReferenceSchema.safeParse(v).success;
        break;
    }
    if (valid) normalized[f.key] = value;
    else
      issues.push({
        key: f.key,
        code: "INVALID",
        message: `${f.label} : vérifiez la réponse.`,
      });
  }
  return { ready: issues.length === 0, normalized, issues };
}
export const copilotFormEditSchema = z.strictObject({
  id: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  action: z.enum(["SAVE", "POSTPONE", "CANCEL"]),
  answers: copilotFormAnswersSchema,
});
