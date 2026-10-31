import { copilotMongoReadInputSchema } from "./copilot-mongo-read";
import { copilotProductSearchInputSchema } from "./copilot-product-search";
import { copilotEventsReadInputSchema } from "./copilot-store-tools";
import { z } from "zod";
import {
  dailyReadInputSchema,
  productChangesReadInputSchema,
  periodAnalysisInputSchema,
} from "./copilot-context-tools";
import { copilotPlanReadInputSchema } from "./copilot-commercial-plan-read";
import { recommendationTrackingInputSchema } from "./copilot-recommendation-decision";
import { copilotEvidenceSchema } from "./copilot-candidate";
export const factReadSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("LATEST"), input: z.null() }),
  z.strictObject({
    kind: z.literal("MONGO"),
    input: copilotMongoReadInputSchema,
  }),
  z.strictObject({ kind: z.literal("DAILY"), input: dailyReadInputSchema }),
  z.strictObject({
    kind: z.literal("PERIOD"),
    input: periodAnalysisInputSchema,
  }),
  z.strictObject({
    kind: z.literal("PRODUCT_CHANGES"),
    input: productChangesReadInputSchema,
  }),
  z.strictObject({
    kind: z.literal("PRODUCT_SEARCH"),
    input: copilotProductSearchInputSchema,
  }),
  z.strictObject({
    kind: z.literal("EVENTS"),
    input: copilotEventsReadInputSchema,
  }),
  z.strictObject({
    kind: z.literal("PLAN"),
    input: copilotPlanReadInputSchema,
  }),
]);
export const factReadSnapshotSchema = z.strictObject({
  read: factReadSchema,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});
export const copilotFactTraceSchema = z.strictObject({
  reads: z.array(factReadSnapshotSchema).max(4),
  complete: z.boolean(),
});
export const recommendationContextInputSchema =
  recommendationTrackingInputSchema;
export const recommendationContextResultSchema = z
  .strictObject({
    input: recommendationContextInputSchema,
    status: z.enum([
      "UNCHANGED",
      "STALE",
      "UNVERIFIABLE",
      "SOURCE_UNAVAILABLE",
    ]),
    checkedAt: z.string().datetime(),
    reads: z
      .array(
        z.strictObject({
          read: factReadSchema,
          status: z.enum(["UNCHANGED", "CHANGED", "UNAVAILABLE"]),
        }),
      )
      .max(5),
    changed: z
      .array(
        z.enum([
          "LATEST",
          "MONGO",
          "DAILY",
          "PERIOD",
          "PRODUCT_CHANGES",
          "PRODUCT_SEARCH",
          "EVENTS",
          "PLAN",
        ]),
      )
      .max(5),
    checkedCount: z.number().int().min(0).max(5),
    unavailableCount: z.number().int().min(0).max(5),
    evidence: z.array(copilotEvidenceSchema).min(1).max(1),
  })
  .superRefine((v, c) => {
    if (
      new Set(v.changed).size !== v.changed.length ||
      v.checkedCount !==
        v.reads.filter((r) => r.status !== "UNAVAILABLE").length ||
      v.unavailableCount !==
        v.reads.filter((r) => r.status === "UNAVAILABLE").length ||
      JSON.stringify(v.changed) !==
        JSON.stringify([
          ...new Set(
            v.reads
              .filter((r) => r.status === "CHANGED")
              .map((r) => r.read.kind),
          ),
        ]) ||
      v.changed.length > v.checkedCount ||
      v.evidence[0]?.sourceId !== v.input.sourceMessageId ||
      v.evidence[0]?.sourceType !== "DATA_QUALITY" ||
      v.evidence[0]?.factKind !== "QUALITY" ||
      !v.evidence[0]?.id.startsWith("recommendation-context/") ||
      (v.status === "STALE") !== v.changed.length > 0 ||
      (v.status === "UNCHANGED" && (!v.checkedCount || v.unavailableCount)) ||
      (v.status === "SOURCE_UNAVAILABLE" &&
        (v.checkedCount || v.unavailableCount)) ||
      v.checkedCount + v.unavailableCount > 5
    )
      c.addIssue({ code: "custom", message: "Invalid fact-context coverage" });
  });
