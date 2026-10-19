import { z } from "zod";
import { contextWeekQuerySchema } from "./weekly-context";
import { copilotMessageSchema } from "./copilot-conversation";
import { copilotEvidenceSchema } from "./copilot-candidate";
import {
  productSchema,
  productNatureSchema,
  salesUnitSchema,
} from "./products";
import {
  commercialOfferChoiceSchema,
  commercialOfferSourceSchema,
} from "./commercial-offer-choice";
import { storeLayoutReadSnapshotSchema } from "./copilot-store-layout";
export const layoutAllocationRefSchema = z.strictObject({
  kind: z.enum(["PRODUCT", "OFFER"]),
  id: z.uuid(),
});
const assignment = z.strictObject({
  furnitureId: z.uuid(),
  surfaceId: z.uuid().nullable(),
  items: z.array(layoutAllocationRefSchema).min(1).max(4),
  reason: z.string().trim().max(240),
});
export const layoutScenarioInputSchema = z
  .strictObject({
    expectedRevisionId: z.uuid(),
    weekStart: contextWeekQuerySchema.shape.weekStart,
    title: z.string().trim().min(1).max(120),
    assignments: z.array(assignment).min(1).max(8),
    assumptions: z.array(z.string().trim().min(1).max(240)).max(4),
  })
  .superRefine((v, c) => {
    const keys = v.assignments.map((a) =>
      JSON.stringify([a.furnitureId, a.surfaceId]),
    );
    if (
      new Set(keys).size !== keys.length ||
      v.assignments.some(
        (a) =>
          new Set(a.items.map((r) => `${r.kind}:${r.id}`)).size !==
          a.items.length,
      )
    )
      c.addIssue({
        code: "custom",
        message:
          "Chaque cible et chaque référence dans sa cible doivent être distinctes.",
      });
    if (
      new Set(
        v.assignments.flatMap((a) => a.items.map((r) => `${r.kind}:${r.id}`)),
      ).size > 16
    )
      c.addIssue({
        code: "custom",
        message: "Au plus seize produits/offres distincts par proposition.",
      });
    if (
      v.assignments.some(
        (a) =>
          a.surfaceId === null &&
          v.assignments.some(
            (b) => b.furnitureId === a.furnitureId && b.surfaceId !== null,
          ),
      )
    )
      c.addIssue({
        code: "custom",
        message:
          "N’affectez pas simultanément un meuble entier et une de ses surfaces.",
      });
  });
/** Private read envelope, never serialized into model context or the conversational artifact. */
export const layoutScenarioSourcesSchema = z.strictObject({
  layout: storeLayoutReadSnapshotSchema,
  products: z.array(productSchema).max(16),
  choices: z.array(commercialOfferChoiceSchema).max(16),
});
const snapshotItem = z
  .strictObject({
    kind: z.enum(["PRODUCT", "OFFER"]),
    id: z.uuid(),
    version: z.number().int().nonnegative(),
    productId: z.uuid(),
    productVersion: z.number().int().nonnegative(),
    label: z.string().min(1).max(280),
    nature: productNatureSchema,
    salesUnit: salesUnitSchema,
    source: commercialOfferSourceSchema
      .extend({ checksum: z.string().min(1).max(200) })
      .nullable(),
    saleStart: z.string().date().nullable(),
    saleEnd: z.string().date().nullable(),
  })
  .superRefine((v, c) => {
    if (
      v.kind === "PRODUCT"
        ? v.id !== v.productId ||
          v.version !== v.productVersion ||
          v.source !== null ||
          v.saleStart !== null ||
          v.saleEnd !== null
        : !v.source ||
          !v.saleStart ||
          !v.saleEnd ||
          v.saleStart > v.saleEnd ||
          v.version < 1
    )
      c.addIssue({
        code: "custom",
        message: "Référence de produit/offre incohérente.",
      });
  });
export const storeLayoutScenarioSchema = z
  .strictObject({
    status: z.literal("PROPOSED"),
    storeId: z.uuid(),
    physicalRevisionId: z.uuid(),
    physicalVersion: z.number().int().positive(),
    weekStart: contextWeekQuerySchema.shape.weekStart,
    title: layoutScenarioInputSchema.shape.title,
    assumptions: layoutScenarioInputSchema.shape.assumptions,
    assignments: z
      .array(assignment.extend({ targetLabel: z.string().min(1).max(500) }))
      .min(1)
      .max(8),
    items: z.array(snapshotItem).min(1).max(16),
    geometry: z.strictObject({
      status: z.enum(["CHECKED", "INCOMPLETE", "BLOCKED"]),
      blocking: z.number().int().nonnegative(),
      missing: z.number().int().nonnegative(),
    }),
  })
  .superRefine((s, c) => {
    const keys = s.items.map((i) => `${i.kind}:${i.id}`),
      wanted = s.assignments.flatMap((a) =>
        a.items.map((r) => `${r.kind}:${r.id}`),
      );
    if (
      new Set(keys).size !== keys.length ||
      wanted.some((k) => !keys.includes(k)) ||
      keys.some((k) => !wanted.includes(k))
    )
      c.addIssue({
        code: "custom",
        message: "Références incomplètes ou étrangères à la proposition.",
      });
    const parsed = layoutScenarioInputSchema.safeParse({
      expectedRevisionId: s.physicalRevisionId,
      weekStart: s.weekStart,
      title: s.title,
      assignments: s.assignments.map(({ targetLabel, ...a }) => {
        void targetLabel;
        return a;
      }),
      assumptions: s.assumptions,
    });
    if (!parsed.success)
      c.addIssue({
        code: "custom",
        message: "Affectations dupliquées ou incompatibles.",
      });
  });
export type StoreLayoutScenario = z.infer<typeof storeLayoutScenarioSchema>;
export const layoutScenarioPreviewSchema = z
  .strictObject({
    input: layoutScenarioInputSchema,
    status: z.enum([
      "READY",
      "ABSENT",
      "NO_REFERENCE",
      "STALE",
      "BLOCKED",
      "LIMIT_EXCEEDED",
    ]),
    scenario: storeLayoutScenarioSchema.nullable(),
    message: z.string().min(1).max(1000),
    evidence: z.array(copilotEvidenceSchema).length(1),
  })
  .refine((v) => (v.status === "READY") === (v.scenario !== null));
export const layoutScenarioCardSchema = z.strictObject({
  kind: z.literal("STORE_LAYOUT_SCENARIO"),
  schemaVersion: z.literal(1),
  assistantMessageId: z.uuid(),
  scenario: storeLayoutScenarioSchema,
});
export function readStoreLayoutScenarioCard(raw: unknown) {
  const message = copilotMessageSchema.parse(raw);
  if (
    message.role !== "TOOL" ||
    !message.replyToMessageId ||
    message.attachments.length
  )
    throw Error("LAYOUT_SCENARIO_CARD_INVALID");
  const content = layoutScenarioCardSchema.parse(JSON.parse(message.text));
  if (content.scenario.storeId !== message.storeId)
    throw Error("LAYOUT_SCENARIO_SCOPE_INVALID");
  return { message, content };
}
export function layoutScenarioInput(s: StoreLayoutScenario) {
  return layoutScenarioInputSchema.parse({
    expectedRevisionId: s.physicalRevisionId,
    weekStart: s.weekStart,
    title: s.title,
    assumptions: s.assumptions,
    assignments: s.assignments.map(({ targetLabel, ...a }) => {
      void targetLabel;
      return a;
    }),
  });
}
