import { z } from "zod";
import {
  productAliasSchema,
  productIdentifierSchema,
  productSchema,
} from "@fl-copilot/domain";
import { apiErrorSchema } from "./api-error";

export const SYNC_PROTOCOL_VERSION = 1;
export const MAX_SYNC_PUSH_COMMANDS = 100;
export const MAX_SYNC_PULL_CHANGES = 500;
export const DEFAULT_BOOTSTRAP_RAW_OBSERVATION_DAYS = 90;
export const MAX_BOOTSTRAP_RAW_OBSERVATION_DAYS = 365;

const idSchema = z.string().uuid();
const nonEmptyStringSchema = z.string().trim().min(1);
const versionSchema = z.number().int().nonnegative();
const timestampSchema = z.string().datetime({ offset: true });
const jsonObjectSchema = z.record(z.string(), z.json());

export const syncCommandSchema = z.object({
  commandId: idSchema,
  localSequence: z.number().int().positive(),
  type: nonEmptyStringSchema,
  entityType: nonEmptyStringSchema,
  entityId: idSchema,
  expectedRemoteVersion: versionSchema.nullable().optional(),
  createdAt: timestampSchema,
  payload: z.json(),
});
export type SyncCommand = z.infer<typeof syncCommandSchema>;

export const syncPushRequestSchema = z.object({
  syncProtocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
  appVersion: nonEmptyStringSchema,
  deviceId: idSchema,
  storeId: idSchema,
  commands: z.array(syncCommandSchema).max(MAX_SYNC_PUSH_COMMANDS),
});
export type SyncPushRequest = z.infer<typeof syncPushRequestSchema>;

export const syncCommandStatusSchema = z.enum([
  "APPLIED",
  "ALREADY_APPLIED",
  "CONFLICT",
  "REJECTED",
  "RETRYABLE_ERROR",
]);
export type SyncCommandStatus = z.infer<typeof syncCommandStatusSchema>;

export const syncCommandResultSchema = z.object({
  commandId: idSchema,
  status: syncCommandStatusSchema,
  entityType: nonEmptyStringSchema,
  entityId: idSchema,
  remoteVersion: versionSchema.nullable().optional(),
  remoteEntity: z.json().optional(),
  error: apiErrorSchema.nullable().optional(),
});
export type SyncCommandResult = z.infer<typeof syncCommandResultSchema>;

export const syncPushResponseSchema = z.object({
  results: z.array(syncCommandResultSchema),
  serverTime: timestampSchema,
});
export type SyncPushResponse = z.infer<typeof syncPushResponseSchema>;

export const syncChangeOperationSchema = z.enum(["UPSERT", "DELETE"]);

export const syncChangeEnvelopeSchema = z.object({
  sequence: nonEmptyStringSchema,
  entityType: nonEmptyStringSchema,
  entityId: idSchema,
  operation: syncChangeOperationSchema,
  entityVersion: versionSchema,
  entity: z.json().optional(),
  changedAt: timestampSchema,
});
export type SyncChangeEnvelope = z.infer<typeof syncChangeEnvelopeSchema>;

export const syncPullQuerySchema = z.object({
  cursor: nonEmptyStringSchema.optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_SYNC_PULL_CHANGES)
    .default(MAX_SYNC_PULL_CHANGES),
});
export type SyncPullQuery = z.infer<typeof syncPullQuerySchema>;

export const syncPullResponseSchema = z.object({
  changes: z.array(syncChangeEnvelopeSchema),
  nextCursor: nonEmptyStringSchema,
  hasMore: z.boolean(),
  serverTime: timestampSchema,
});
export type SyncPullResponse = z.infer<typeof syncPullResponseSchema>;

export const bootstrapQuerySchema = z.object({
  rawObservationDays: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_BOOTSTRAP_RAW_OBSERVATION_DAYS)
    .default(DEFAULT_BOOTSTRAP_RAW_OBSERVATION_DAYS),
});
export type BootstrapQuery = z.infer<typeof bootstrapQuerySchema>;

export const bootstrapEntitiesSchema = z.object({
  syncTestEntities: z.array(jsonObjectSchema),
  products: z.array(productSchema),
  productIdentifiers: z.array(productIdentifierSchema),
  productAliases: z.array(productAliasSchema),
  needUnits: z.array(jsonObjectSchema),
  needMemberships: z.array(jsonObjectSchema),
  productSubstitutions: z.array(jsonObjectSchema),
  salesObservations: z.array(jsonObjectSchema),
  wasteObservations: z.array(jsonObjectSchema),
  commercialOperations: z.array(jsonObjectSchema),
  offers: z.array(jsonObjectSchema),
  marketSignals: z.array(jsonObjectSchema),
  executionInstructions: z.array(jsonObjectSchema),
  storeEvents: z.array(jsonObjectSchema),
  productDailyPerformance: z.array(jsonObjectSchema),
  departmentDailyPerformance: z.array(jsonObjectSchema),
  recommendations: z.array(jsonObjectSchema),
  decisions: z.array(jsonObjectSchema),
  actionExecutions: z.array(jsonObjectSchema),
});

export const bootstrapResponseSchema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
  store: jsonObjectSchema,
  snapshotRevision: nonEmptyStringSchema,
  cursor: nonEmptyStringSchema,
  historyPolicy: z.object({
    rawObservationDays: z.number().int().positive(),
  }),
  entities: bootstrapEntitiesSchema,
  serverTime: timestampSchema,
});
export type BootstrapResponse = z.infer<typeof bootstrapResponseSchema>;
