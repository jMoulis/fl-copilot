import { z } from "zod";
import { commercialOfferSourceSchema } from "./commercial-offer-choice";
import {
  commercialVisualEvidenceSchema,
  commercialVisualFieldSchema,
} from "./commercial-visual-reading";
import { commercialMechanismSchema } from "./commercial-mechanisms";
import { copilotPdfResultSchema } from "./copilot-commercial-documents";
import { copilotBusinessDateSchema } from "./copilot-context-tools";
import { copilotEvidenceSchema } from "./copilot-candidate";
export const copilotSourceOffersInputSchema = z.strictObject({
  sourceDocumentId: z.uuid(),
  businessDate: copilotBusinessDateSchema,
  pageNumber: z.number().int().min(1).max(100),
  offset: z.number().int().min(0).max(1800),
  limit: z.number().int().min(1).max(5),
});
const reference = commercialVisualEvidenceSchema.extend({
  verification: z.enum(["TEXT_SUPPORTED", "VISUAL_TO_VERIFY"]),
});
export const copilotSourceOfferFieldSchema = commercialVisualFieldSchema.extend(
  {
    evidence: z.array(reference).max(8),
    validationStatus: z.literal("TO_VALIDATE"),
  },
);
export const copilotSourceOfferSchema = z.strictObject({
  source: commercialOfferSourceSchema,
  pageNumber: z.number().int().min(1).max(100),
  operationKind: z.enum(["DRAMAT", "PROSPECTUS", "BASIC", "OTHER"]),
  operationLabel: z.string().min(1).max(240),
  rawProductLabel: z.string().min(1).max(240),
  operationFields: z.array(copilotSourceOfferFieldSchema).max(30),
  itemFields: z.array(copilotSourceOfferFieldSchema).max(30),
  operationEvidence: z.array(reference).min(1).max(8),
  itemEvidence: z.array(reference).min(1).max(8),
  proposal: z.strictObject({
    saleStart: copilotBusinessDateSchema.nullable(),
    saleEnd: copilotBusinessDateSchema.nullable(),
    mechanism: commercialMechanismSchema.nullable(),
  }),
  validationStatus: z.literal("TO_VALIDATE"),
});
export const copilotSourceOffersResultSchema = z.strictObject({
  storeId: z.uuid(),
  input: copilotSourceOffersInputSchema,
  status: z.enum(["READY", "UNAVAILABLE", "NOT_READY", "LIMIT_EXCEEDED"]),
  week: copilotPdfResultSchema.shape.week,
  readingId: z.uuid().nullable(),
  checksum: z.string().min(1).nullable(),
  pageCount: z.number().int().min(1).max(100).nullable(),
  totalOffers: z.number().int().min(0).max(1800),
  excludedOffers: z.number().int().min(0).max(1800),
  unknownOffers: z.number().int().min(0).max(1800),
  warnings: z.array(z.string().max(400)).max(30),
  warningCount: z.number().int().min(0).max(30),
  warningsComplete: z.boolean(),
  offers: z.array(copilotSourceOfferSchema).max(5),
  nextOffset: z.number().int().min(0).max(1800).nullable(),
  evidence: z.array(copilotEvidenceSchema).min(1).max(6),
});
export function validateSourceOffersResult(
  storeId: string,
  rawInput: unknown,
  raw: unknown,
) {
  const input = copilotSourceOffersInputSchema.parse(rawInput),
    r = copilotSourceOffersResultSchema.parse(raw);
  if (
    r.storeId !== storeId ||
    r.evidence.some(
      (e) =>
        e.sourceId !== input.sourceDocumentId ||
        !["SOURCE_DOCUMENT", "DATA_QUALITY"].includes(e.sourceType),
    ) ||
    JSON.stringify(r.input) !== JSON.stringify(input) ||
    r.week.date !== input.businessDate ||
    input.businessDate < r.week.start ||
    input.businessDate > r.week.end ||
    r.offers.length > input.limit ||
    r.offers.some(
      (o) =>
        o.source.sourceDocumentId !== input.sourceDocumentId ||
        o.source.readingId !== r.readingId ||
        o.source.checksum !== r.checksum ||
        o.pageNumber !== input.pageNumber,
    ) ||
    new Set(r.offers.map((o) => JSON.stringify(o.source))).size !==
      r.offers.length
  )
    throw Error("SOURCE_OFFERS_SCOPE_INVALID");
  if (
    r.warningCount < r.warnings.length ||
    (r.warningsComplete && r.warningCount !== r.warnings.length) ||
    (!r.warningsComplete && r.status !== "LIMIT_EXCEEDED")
  )
    throw Error("SOURCE_OFFERS_WARNINGS_INVALID");
  if (["UNAVAILABLE", "NOT_READY"].includes(r.status)) {
    if (
      r.offers.length ||
      r.nextOffset !== null ||
      r.totalOffers ||
      r.readingId !== null ||
      r.checksum !== null
    )
      throw Error("SOURCE_OFFERS_STATE_INVALID");
  } else {
    if (
      !r.readingId ||
      !r.checksum ||
      !r.pageCount ||
      input.pageNumber > r.pageCount ||
      (r.offers.length > 0 && input.offset + r.offers.length > r.totalOffers) ||
      (r.nextOffset !== null &&
        (r.nextOffset !== input.offset + r.offers.length ||
          r.nextOffset >= r.totalOffers)) ||
      (r.status === "READY" && r.nextOffset === input.offset)
    )
      throw Error("SOURCE_OFFERS_PAGE_INVALID");
    if (r.nextOffset === null && input.offset + r.offers.length < r.totalOffers)
      throw Error("SOURCE_OFFERS_PAGE_INVALID");
  }
  return r;
}
