import {
  sourceReferenceRequestSchema,
  sourceReferenceResultSchema,
  sourceReferenceTool,
} from "./copilot-source-tools";
import {
  copilotStoreRequestSchemas,
  eventsReadResultSchema,
  substitutesReadResultSchema,
  storeWeekReadResultSchema,
  copilotStoreToolRegistry,
} from "./copilot-store-tools";
import {
  copilotContextRequestSchemas,
  dailyReadResultSchema,
  wasteReadResultSchema,
  offersReadResultSchema,
  copilotContextToolRegistry,
} from "./copilot-context-tools";
import { z } from "zod";
import {
  productSchema,
  productIdentifierSchema,
  productAliasSchema,
} from "./products";

/** Authority is supplied by authenticated application code, never by model input. */
export const copilotToolScopeSchema = z.strictObject({
  storeId: z.string().uuid(),
  ownerId: z.string().uuid(),
  conversationId: z.string().uuid(),
  canReadStore: z.boolean(),
});
export type CopilotToolScope = z.infer<typeof copilotToolScopeSchema>;
export const inspectProductInputSchema = z.strictObject({
  productId: z.string().uuid(),
});
const productRequestSchema = z.strictObject({
  operationId: z.string().uuid(),
  tool: z.literal("product.inspect"),
  schemaVersion: z.literal(1),
  input: inspectProductInputSchema,
});
export const copilotToolRequestSchema = z.discriminatedUnion("tool", [
  productRequestSchema,
  ...copilotContextRequestSchemas,
  ...copilotStoreRequestSchemas,
  sourceReferenceRequestSchema,
]);
const record = <T extends z.ZodType>(entity: T) =>
  z.strictObject({
    entity,
    syncState: z.enum(["PENDING", "SYNCED", "CONFLICT", "ERROR"]),
    remoteVersion: z.number().int().nonnegative().nullable(),
    dirty: z.boolean(),
  });
export const inspectProductResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  operationId: z.string().uuid(),
  tool: z.literal("product.inspect"),
  status: z.literal("COMPLETED"),
  message: z.string(),
  observedAt: z.string().datetime(),
  snapshot: z
    .strictObject({
      product: record(productSchema),
      identifiers: z.array(record(productIdentifierSchema)),
      aliases: z.array(record(productAliasSchema)),
    })
    .nullable(),
});
export const copilotToolResultSchema = z.discriminatedUnion("tool", [
  inspectProductResultSchema,
  dailyReadResultSchema,
  wasteReadResultSchema,
  offersReadResultSchema,
  eventsReadResultSchema,
  substitutesReadResultSchema,
  storeWeekReadResultSchema,
  sourceReferenceResultSchema,
]);
export type CopilotToolResult = z.infer<typeof copilotToolResultSchema>;
export type InspectProductResult = z.infer<typeof inspectProductResultSchema>;
export const copilotToolErrors = {
  INVALID_INPUT: "La demande contient des informations invalides.",
  FORBIDDEN: "Cette conversation ne peut pas accéder à ces données.",
  OPERATION_CONFLICT:
    "Cette action a déjà été utilisée pour une autre demande. Relancez avec une nouvelle action.",
  CANCELLED: "L’action a été annulée.",
  UNAVAILABLE: "La lecture n’a pas pu être terminée. Vous pouvez réessayer.",
} as const;
export class CopilotToolError extends Error {
  constructor(readonly code: keyof typeof copilotToolErrors) {
    super(copilotToolErrors[code]);
  }
}
export const copilotToolRegistry = [
  ...copilotContextToolRegistry,
  ...copilotStoreToolRegistry,
  sourceReferenceTool,
  {
    name: "product.inspect",
    schemaVersion: 1,
    description:
      "Consulter une fiche produit, ses identifiants et ses alias, avec leur état local de synchronisation.",
    progress: "Lecture de la fiche produit…",
    effect: "READ",
    runtime: "LOCAL",
    confirmation: "NONE",
    inputSchema: inspectProductInputSchema,
    outputSchema: inspectProductResultSchema,
  },
] as const;
