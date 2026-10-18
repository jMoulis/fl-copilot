import { z } from "zod";
import { cashierNumberSchema, wasteLineSchema } from "./waste-receipts";
import { copilotMessageSchema } from "./copilot-conversation";
import { copilotEvidenceSchema } from "./copilot-candidate";
import {
  receiptPublicationSourceSchema,
  receiptPublicationRequestSchema,
} from "./copilot-receipt-publication";
import { productClassificationAuthoritySchema } from "./copilot-product-mutations";
export const receiptCorrectionValuesSchema = z
  .strictObject({
    rawLabel: z.string().trim().min(1).max(240).optional(),
    quantity: wasteLineSchema.shape.quantity,
    quantityUnit: wasteLineSchema.shape.quantityUnit,
    weight: wasteLineSchema.shape.weight,
    unitPrice: wasteLineSchema.shape.unitPrice,
    totalPrice: wasteLineSchema.shape.totalPrice,
  })
  .refine((v) => Object.keys(v).length > 0);
const linePatchSchema = z
  .strictObject({
    lineId: z.uuid(),
    values: receiptCorrectionValuesSchema.optional(),
    excluded: z.boolean().optional(),
    productId: z.uuid().optional(),
  })
  .refine((v) => Object.keys(v).length > 1);
export const receiptCorrectionInputSchema = z.strictObject({
  sourceDocumentId: z.uuid(),
  patch: z
    .strictObject({
      wasteDate: z.iso.date().optional(),
      cashierNumber: cashierNumberSchema.nullable().optional(),
      lines: z.array(linePatchSchema).min(1).max(10).optional(),
    })
    .refine((v) => Object.keys(v).length > 0)
    .refine(
      (v) =>
        !v.lines ||
        new Set(v.lines.map((l) => l.lineId)).size === v.lines.length,
    ),
});
export type ReceiptCorrectionInput = z.infer<
  typeof receiptCorrectionInputSchema
>;
export const receiptCorrectionPreviewSchema = z.strictObject({
  /** Trusted capability marker; never part of model input. Absent means candidate-only v1. */
  schemaVersion: z.literal(2).optional(),
  input: receiptCorrectionInputSchema,
  source: receiptPublicationSourceSchema,
  status: z.enum(["REVIEW_LOCAL", "READ_ONLY", "NOT_READY", "LIMIT_EXCEEDED"]),
  evidence: z.array(copilotEvidenceSchema).length(1),
});
export const receiptCorrectionProposalSchema = z.strictObject({
  kind: z.literal("WASTE_CORRECTION_PROPOSAL"),
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  assistantMessageId: z.uuid(),
  input: receiptCorrectionInputSchema,
  source: receiptPublicationSourceSchema,
});
export function readReceiptCorrectionProposal(raw: unknown) {
  const message = copilotMessageSchema.parse(raw);
  if (
    message.role !== "TOOL" ||
    !message.replyToMessageId ||
    message.attachments.length
  )
    throw Error("RECEIPT_CORRECTION_INVALID");
  const content = receiptCorrectionProposalSchema.parse(
    JSON.parse(message.text),
  );
  if (
    content.source.storeId !== message.storeId ||
    content.source.sourceDocumentId !== content.input.sourceDocumentId
  )
    throw Error("RECEIPT_CORRECTION_SCOPE");
  return { message, content };
}
export const receiptCorrectionRequestSchema = receiptPublicationRequestSchema;
export const receiptCorrectionAuthoritySchema =
  productClassificationAuthoritySchema
    .omit({ canManageProducts: true })
    .extend({ canCorrectWaste: z.boolean(), correctionReviewed: z.boolean() });
export type ReceiptCorrectionAuthority = z.infer<
  typeof receiptCorrectionAuthoritySchema
>;
export const receiptCorrectionChangeSchema = z.strictObject({
  lineId: z.uuid().nullable(),
  lineIndex: z.number().int().nonnegative().nullable(),
  field: z.enum([
    "wasteDate",
    "cashierNumber",
    "rawLabel",
    "quantity",
    "quantityUnit",
    "weight",
    "unitPrice",
    "totalPrice",
    "excluded",
    "product",
  ]),
  before: z.string().nullable(),
  after: z.string().nullable(),
});
export type ReceiptCorrectionChange = z.infer<
  typeof receiptCorrectionChangeSchema
>;
export const receiptCorrectionResultSchema =
  receiptCorrectionRequestSchema.extend({
    userMessageId: z.uuid(),
    appliedAt: z.iso.datetime(),
    afterHash: z.string().regex(/^[a-f0-9]{64}$/),
    changes: z.array(receiptCorrectionChangeSchema).min(1).max(102),
  });
