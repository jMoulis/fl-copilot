import { z } from "zod";
import {
  storeProductEventSchema,
  storeProductEventTypeSchema,
} from "./store-product-event";
import { productSubstitutionSchema } from "./product-substitution";
import { weeklyContextSchema, contextWeekQuerySchema } from "./weekly-context";
const instant = z
  .string()
  .datetime({ offset: true })
  .transform((v) => new Date(v).toISOString());
export const eventsReadInputSchema = z
  .strictObject({
    startAt: instant,
    endAt: instant,
    productId: z.string().uuid().optional(),
    afterId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(25).default(25),
  })
  .refine(
    (v) =>
      v.startAt < v.endAt &&
      Date.parse(v.endAt) - Date.parse(v.startAt) <= 366 * 86400000,
  );
export const substitutesReadInputSchema = z.strictObject({
  productId: z.string().uuid(),
  needUnitId: z.string().uuid().optional(),
  at: instant.optional(),
  offset: z.number().int().min(0).max(10000).default(0),
  limit: z.number().int().min(1).max(25).default(25),
});
export const storeWeekReadInputSchema = contextWeekQuerySchema;
const base = {
  schemaVersion: z.literal(1),
  operationId: z.string().uuid(),
  status: z.literal("COMPLETED"),
  message: z.string(),
  observedAt: z.string().datetime(),
};
export const eventsReadResultSchema = z.strictObject({
  ...base,
  tool: z.literal("store.events"),
  startAt: instant,
  endAt: instant,
  events: z
    .array(
      z.strictObject({
        entity: storeProductEventSchema,
        syncState: z.string(),
      }),
    )
    .max(25),
  hasMore: z.boolean(),
  nextAfterId: z.string().uuid().nullable(),
});
const relation = z.strictObject({
  relation: productSubstitutionSchema,
  syncState: z.string(),
  fit: z.number().min(0).max(1),
  basis: z.enum(["DECLARED", "LEARNED"]),
});
export const substitutesReadResultSchema = z.strictObject({
  ...base,
  tool: z.literal("substitution.lookup"),
  productId: z.string().uuid(),
  evaluatedAt: instant,
  ruleVersion: z.string(),
  lookupStatus: z.enum(["SOURCE_UNAVAILABLE", "READY"]),
  candidates: z
    .array(
      z.strictObject({
        productId: z.string().uuid(),
        label: z.string(),
        availability: z.literal("UNKNOWN"),
        relationships: z.array(relation),
        events: z.array(
          z.strictObject({
            id: z.string().uuid(),
            type: storeProductEventTypeSchema,
            syncState: z.string(),
          }),
        ),
      }),
    )
    .max(25),
  candidateCount: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  nextOffset: z.number().int().nonnegative().nullable(),
  excluded: z
    .array(
      z.strictObject({
        relationId: z.string().uuid(),
        productId: z.string().uuid(),
        needUnitId: z.string().uuid(),
        reason: z.enum([
          "UNCONFIRMED",
          "REJECTED",
          "RELATION_SYNC_UNRESOLVED",
          "PRODUCT_UNAVAILABLE",
          "NEED_UNAVAILABLE",
          "OUT_OF_STOCK",
          "EVENT_UNRESOLVED",
        ]),
      }),
    )
    .max(25),
  excludedCount: z.number().int().nonnegative(),
  excludedHasMore: z.boolean(),
});
export const storeWeekReadResultSchema = z.strictObject({
  ...base,
  tool: z.literal("store.week"),
  weekStart: z.string().date(),
  settings: z
    .strictObject({
      city: z.string(),
      postalCode: z.string(),
      timezone: z.literal("Europe/Paris"),
      schoolZone: z.enum(["A", "B", "C"]).nullable(),
      syncState: z.string(),
    })
    .nullable(),
  context: weeklyContextSchema.nullable(),
});
export const copilotStoreRequestSchemas = [
  z.strictObject({
    operationId: z.string().uuid(),
    schemaVersion: z.literal(1),
    tool: z.literal("store.events"),
    input: eventsReadInputSchema,
  }),
  z.strictObject({
    operationId: z.string().uuid(),
    schemaVersion: z.literal(1),
    tool: z.literal("substitution.lookup"),
    input: substitutesReadInputSchema,
  }),
  z.strictObject({
    operationId: z.string().uuid(),
    schemaVersion: z.literal(1),
    tool: z.literal("store.week"),
    input: storeWeekReadInputSchema,
  }),
] as const;
export const copilotStoreToolRegistry = [
  {
    name: "store.events",
    inputSchema: eventsReadInputSchema,
    outputSchema: eventsReadResultSchema,
    description:
      "Lire les observations de rupture, tension ou qualité qui recouvrent un intervalle, avec leur statut et leur source.",
    progress: "Lecture des observations…",
  },
  {
    name: "substitution.lookup",
    inputSchema: substitutesReadInputSchema,
    outputSchema: substitutesReadResultSchema,
    description:
      "Consulter les substitutions dirigées via les règles partagées. Le stock réel reste inconnu ; distinguer scores déclarés et appris.",
    progress: "Recherche des substitutions…",
  },
  {
    name: "store.week",
    inputSchema: storeWeekReadInputSchema,
    outputSchema: storeWeekReadResultSchema,
    description:
      "Lire la météo et le calendrier déjà disponibles pour le magasin, avec leurs dates de validité. Ne déclenche aucune recherche réseau.",
    progress: "Lecture du contexte magasin…",
  },
].map((t) => ({
  ...t,
  schemaVersion: 1 as const,
  effect: "READ" as const,
  runtime: "LOCAL" as const,
  confirmation: "NONE" as const,
}));
