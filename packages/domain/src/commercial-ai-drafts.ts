import { z } from "zod";
export const COMMERCIAL_AI_SCHEMA_VERSION = "commercial-draft.v1";
export const commercialEvidenceSchema = z
  .object({
    pageNumber: z.number().int().min(1).max(100),
    spanIndices: z.array(z.number().int().nonnegative()).min(1).max(40),
    quote: z.string().trim().min(1).max(1200),
  })
  .strict();
export const commercialFieldNameSchema = z.enum([
  "operationName",
  "operationNature",
  "theme",
  "productLabel",
  "productIdentifier",
  "sellingPrice",
  "priceOperator",
  "salesUnit",
  "customerMechanism",
  "purchasePrice",
  "supplierCondition",
  "documentDate",
  "saleStart",
  "saleEnd",
  "preorderStart",
  "preorderDeadline",
  "deliveryStart",
  "deliveryEnd",
  "executionDeadline",
  "communicationStart",
  "communicationEnd",
  "instruction",
  "channel",
  "tg",
  "marketSignal",
  "applicabilityCondition",
  "weekLabel",
]);
export const commercialAiFieldSchema = z
  .object({
    name: commercialFieldNameSchema,
    rawValue: z.string().trim().min(1).max(2000).nullable(),
    confidence: z.number().min(0).max(1),
    evidence: z.array(commercialEvidenceSchema).max(8),
  })
  .strict();
export const commercialAiBlockSchema = z
  .object({
    kind: z.enum([
      "OPERATION",
      "OFFER",
      "EXECUTION_INSTRUCTION",
      "MERCHANDISING",
      "COMMUNICATION",
      "MARKET_SIGNAL",
      "PREORDER_WINDOW",
      "DELIVERY_WINDOW",
      "APPLICABILITY_CONDITION",
    ]),
    label: z.string().trim().min(1).max(240),
    evidence: z.array(commercialEvidenceSchema).min(1).max(8),
    fields: z.array(commercialAiFieldSchema).max(30),
  })
  .strict();
export const commercialAiPageOutputSchema = z
  .object({
    blocks: z.array(commercialAiBlockSchema).max(100),
    warnings: z
      .array(
        z.enum([
          "UNCERTAIN_DATE",
          "UNCERTAIN_PRICE",
          "UNCERTAIN_MECHANISM",
          "UNCERTAIN_PRODUCT",
          "UNCERTAIN_APPLICABILITY",
          "NO_EXTRACTABLE_TEXT",
          "OTHER",
        ]),
      )
      .max(20),
  })
  .strict();
export type CommercialAiPageOutput = z.infer<
  typeof commercialAiPageOutputSchema
>;
export type CommercialEvidence = z.infer<typeof commercialEvidenceSchema>;
export type CommercialAiField = z.infer<typeof commercialAiFieldSchema>;
