import { z } from "zod";
import { copilotEvidenceSchema } from "./copilot-candidate";
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

/** Model context is paged independently of the native operational reader. */
export const copilotEventsReadInputSchema = z
  .strictObject({
    startAt: eventsReadInputSchema.shape.startAt,
    endAt: eventsReadInputSchema.shape.endAt,
    productId: z.string().uuid().nullable(),
    afterId: z.string().uuid().nullable(),
    limit: z.number().int().min(1).max(10),
  })
  .refine(
    (v) =>
      eventsReadInputSchema.safeParse({
        ...v,
        productId: v.productId ?? undefined,
        afterId: v.afterId ?? undefined,
      }).success,
    "Période d’observation invalide.",
  );
export const copilotEventsReadResultSchema = z.strictObject({
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  productId: z.string().uuid().nullable(),
  events: z
    .array(
      z.strictObject({
        event: storeProductEventSchema,
        productLabel: z.string().min(1).max(280),
      }),
    )
    .max(10),
  hasMore: z.boolean(),
  nextAfterId: z.string().uuid().nullable(),
  evidence: z.array(copilotEvidenceSchema).max(11),
});

/** Model-facing directed lookup, with explicit nullable scope and bounded pages. */
export const copilotSubstitutesInputSchema = z.strictObject({
  productId: z.string().uuid(),
  needUnitId: z.string().uuid().nullable(),
  at: instant,
  offset: z.number().int().min(0).max(10000),
  limit: z.number().int().min(1).max(5),
});
export const copilotSubstitutesResultSchema = substitutesReadResultSchema
  .omit({
    schemaVersion: true,
    operationId: true,
    status: true,
    message: true,
    observedAt: true,
  })
  .extend({
    candidates: substitutesReadResultSchema.shape.candidates.max(5),
    needUnitId: z.string().uuid().nullable(),
    lookupStatus: z.enum(["SOURCE_UNAVAILABLE", "READY", "LIMIT_EXCEEDED"]),
    candidateCount: z.number().int().nonnegative().nullable(),
    excludedCount: z.number().int().nonnegative().nullable(),
    evidence: z.array(copilotEvidenceSchema).max(6),
  })
  .superRefine((r, ctx) => {
    const valid =
      r.lookupStatus === "LIMIT_EXCEEDED"
        ? r.candidateCount === null &&
          r.excludedCount === null &&
          !r.candidates.length &&
          !r.excluded.length &&
          !r.hasMore &&
          !r.excludedHasMore &&
          r.nextOffset === null
        : r.candidateCount !== null &&
          r.candidateCount >= r.candidates.length &&
          r.excludedCount !== null &&
          r.excludedCount >= r.excluded.length &&
          r.excludedHasMore === r.excludedCount > r.excluded.length &&
          r.hasMore === (r.nextOffset !== null) &&
          (r.lookupStatus !== "SOURCE_UNAVAILABLE" ||
            (r.candidateCount === 0 && r.excludedCount === 0 && !r.hasMore));
    if (!valid)
      ctx.addIssue({
        code: "custom",
        message: "Invalid substitution coverage",
      });
    for (const c of r.candidates)
      if (
        !c.relationships.length ||
        c.relationships.some(
          (v) =>
            v.relation.sourceProductId !== r.productId ||
            v.relation.substituteProductId !== c.productId ||
            (r.needUnitId && v.relation.needUnitId !== r.needUnitId) ||
            !v.relation.humanConfirmed ||
            !["VALIDATED", "LEARNING"].includes(v.relation.status),
        )
      )
        ctx.addIssue({ code: "custom", message: "Invalid directed candidate" });
  });

export const copilotWeekInputSchema = contextWeekQuerySchema;
/** Only the useful provider projection is exposed, never the settings/GPS fingerprint. */
export const copilotWeekResultSchema = z
  .strictObject({
    weekStart: contextWeekQuerySchema.shape.weekStart,
    context: z
      .strictObject({
        storeId: weeklyContextSchema.shape.storeId,
        weekStart: weeklyContextSchema.shape.weekStart,
        weekEnd: weeklyContextSchema.shape.weekEnd,
        locationLabel: weeklyContextSchema.shape.locationLabel,
        retrievedAt: weeklyContextSchema.shape.retrievedAt,
        weather: weeklyContextSchema.shape.weather,
        publicHolidays: weeklyContextSchema.shape.publicHolidays,
        schoolHolidays: weeklyContextSchema.shape.schoolHolidays,
      })
      .nullable(),
    evidence: z.array(copilotEvidenceSchema).min(1).max(4),
  })
  .superRefine((r, ctx) => {
    const c = r.context;
    if (
      c &&
      (c.weekStart !== r.weekStart ||
        !weeklyContextSchema.safeParse({
          ...c,
          settingsFingerprint: "withheld",
        }).success ||
        c.publicHolidays.days.some(
          (d) => d.date < c.weekStart || d.date > c.weekEnd,
        ) ||
        c.schoolHolidays.periods.some(
          (p) => p.startDate > c.weekEnd || p.resumeDate <= c.weekStart,
        ))
    )
      ctx.addIssue({ code: "custom", message: "Invalid weekly context scope" });
  });
