import { z } from "zod";
import {
  commercialExecutionTaskSchema,
  commercialExecutionActualsPatchSchema,
} from "./commercial-execution-task";
import { preparationReadInputSchema } from "./copilot-commercial-preparation";
import { productClassificationAuthoritySchema } from "./copilot-product-mutations";
const {
  id,
  storeId,
  planId,
  planRevisionId,
  planVersion,
  planChecksum,
  kind,
  targetId,
  label,
  status,
  note,
} = commercialExecutionTaskSchema.shape;
export const executionProposalSchema = z.strictObject({
  id,
  storeId,
  planId,
  planRevisionId,
  planVersion,
  planChecksum,
  kind,
  targetId,
  label,
});
export const executionReadRequestSchema = z.strictObject({
  operationId: z.string().uuid(),
  schemaVersion: z.literal(1),
  tool: z.literal("commercial.execution.inspect"),
  input: preparationReadInputSchema,
});
export const executionReadResultSchema = z.strictObject({
  operationId: z.string().uuid(),
  schemaVersion: z.literal(1),
  tool: z.literal("commercial.execution.inspect"),
  status: z.literal("COMPLETED"),
  observedAt: z.string().datetime(),
  message: z.string(),
  plan: z
    .strictObject({
      id,
      revisionId: planRevisionId,
      version: planVersion,
      checksum: planChecksum,
      weekStart: preparationReadInputSchema.shape.weekStart,
      weekEnd: preparationReadInputSchema.shape.weekStart,
      syncState: z.string(),
    })
    .nullable(),
  tasks: z
    .array(
      z.strictObject({
        proposal: executionProposalSchema,
        record: z
          .strictObject({
            entity: commercialExecutionTaskSchema,
            syncState: z.string(),
            remoteVersion: z.number().int().positive().nullable(),
          })
          .nullable(),
      }),
    )
    .max(130),
  progress: z.strictObject({
    total: z.number().int().nonnegative(),
    TODO: z.number().int().nonnegative(),
    DONE: z.number().int().nonnegative(),
    SKIPPED: z.number().int().nonnegative(),
    NOT_APPLICABLE: z.number().int().nonnegative(),
  }),
});
export const executionReadTool = {
  name: "commercial.execution.inspect",
  schemaVersion: 1,
  effect: "READ",
  runtime: "LOCAL",
  confirmation: "NONE",
  description:
    "Consulter les tâches d’affichage et TG de la révision courante du plan, avec les seules déclarations d’exécution enregistrées.",
  progress: "Lecture de la mise en place commerciale…",
  inputSchema: preparationReadInputSchema,
  outputSchema: executionReadResultSchema,
} as const;
export const executionSaveInputSchema = z
  .strictObject({
    weekStart: preparationReadInputSchema.shape.weekStart,
    planVersion,
    taskId: id,
    expectedVersion: z.number().int().positive().nullable(),
    actuals: commercialExecutionActualsPatchSchema.nullable().optional(),
    status,
    note,
  })
  .refine((v) => new Date(v.weekStart + "T00:00:00Z").getUTCDay() === 1)
  .refine((v) => !["SKIPPED", "NOT_APPLICABLE"].includes(v.status) || !!v.note);
export const executionSaveRequestSchema = z.strictObject({
  operationId: z.string().uuid(),
  schemaVersion: z.literal(1),
  tool: z.literal("commercial.execution.save"),
  input: executionSaveInputSchema,
});
export const executionSaveAuthoritySchema = productClassificationAuthoritySchema
  .omit({ canManageProducts: true })
  .extend({ canDeclareCommercialExecution: z.boolean() });
export type ExecutionSaveAuthority = z.infer<
  typeof executionSaveAuthoritySchema
>;
export function executionSaveIntent(raw: unknown) {
  return JSON.stringify(executionSaveRequestSchema.parse(raw));
}
export const executionSaveResultSchema = z.strictObject({
  operationId: z.string().uuid(),
  schemaVersion: z.literal(1),
  tool: z.literal("commercial.execution.save"),
  status: z.literal("COMPLETED"),
  userMessageId: z.string().uuid(),
  appliedAt: z.string().datetime(),
  before: commercialExecutionTaskSchema.nullable(),
  after: commercialExecutionTaskSchema,
  commandId: z.string().uuid().nullable(),
  syncState: z.string(),
  message: z.string(),
});
export const copilotExecutionMutationRegistry = [
  {
    name: "commercial.execution.save",
    schemaVersion: 1,
    effect: "WRITE",
    runtime: "LOCAL",
    confirmation: "REVIEWED_USER_INTENT",
    description:
      "Enregistrer une déclaration utilisateur d’exécution de la tâche courante : statut et note. N’imprime pas d’affiche et ne déduit pas une réalisation du seul plan.",
    progress: "Enregistrement de la mise en place…",
    inputSchema: executionSaveInputSchema,
    outputSchema: executionSaveResultSchema,
  },
] as const;
