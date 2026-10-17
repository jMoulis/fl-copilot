import { z } from "zod";
import { copilotBusinessDateSchema } from "./copilot-context-tools";
import { copilotEvidenceSchema } from "./copilot-candidate";
import { copilotPdfResultSchema } from "./copilot-commercial-documents";
export const copilotDocumentComparisonInputSchema = z
  .strictObject({
    beforeDocumentId: z.uuid(),
    afterDocumentId: z.uuid(),
    businessDate: copilotBusinessDateSchema,
    offset: z.number().int().min(0).max(2000),
    limit: z.number().int().min(1).max(5),
  })
  .refine((v) => v.beforeDocumentId !== v.afterDocumentId);
const status = z.enum([
  "CHANGED",
  "UNCHANGED",
  "NOT_FOUND_IN_NEW",
  "NEW_IN_READING",
  "AMBIGUOUS",
]);
const offer = z.strictObject({
  readingId: z.uuid(),
  sourceDocumentId: z.uuid(),
  pageNumber: z.number().int().min(1).max(100),
  operationIndex: z.number().int().nonnegative(),
  itemIndex: z.number().int().nonnegative(),
  operationLabel: z.string().max(240),
  label: z.string().max(240),
  identityKey: z.string().nullable(),
  identityBasis: z.enum(["IDENTIFIERS", "EXACT_LABEL", "UNKNOWN"]),
  terms: z.record(z.string(), z.unknown()),
  rawFields: z.array(
    z.strictObject({ name: z.string(), rawValue: z.string().nullable() }),
  ),
  quotes: z.array(z.string()),
});
const side = z.strictObject({
  documentId: z.uuid(),
  filename: z.string().min(1).max(240),
  checksum: z.string().min(1),
  coverage: z
    .strictObject({
      complete: z.boolean(),
      ready: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    })
    .nullable(),
  period: z
    .strictObject({
      included: z.number().int().nonnegative(),
      excluded: z.number().int().nonnegative(),
      unknown: z.number().int().nonnegative(),
    })
    .nullable(),
  warningCount: z.number().int().nonnegative().nullable(),
});
export const copilotDocumentComparisonResultSchema = z.strictObject({
  storeId: z.uuid(),
  input: copilotDocumentComparisonInputSchema,
  week: copilotPdfResultSchema.shape.week,
  status: z.enum([
    "COMPARED",
    "INCOMPLETE",
    "UNAVAILABLE",
    "NOT_READY",
    "SAME_BINARY",
    "LIMIT_EXCEEDED",
  ]),
  before: side.nullable(),
  after: side.nullable(),
  counts: z.record(status, z.number().int().nonnegative()).nullable(),
  differenceCount: z.number().int().nonnegative().nullable(),
  differences: z
    .array(
      z.strictObject({
        key: z.string(),
        status,
        before: z.array(offer),
        after: z.array(offer),
        changedFields: z.array(z.string()),
      }),
    )
    .max(5),
  nextOffset: z.number().int().nonnegative().nullable(),
  evidence: z.array(copilotEvidenceSchema).min(1).max(13),
});
export function validateDocumentComparisonResult(
  storeId: string,
  rawInput: unknown,
  raw: unknown,
) {
  const input = copilotDocumentComparisonInputSchema.parse(rawInput),
    r = copilotDocumentComparisonResultSchema.parse(raw),
    available = ["COMPARED", "INCOMPLETE"].includes(r.status);
  if (
    r.storeId !== storeId ||
    JSON.stringify(r.input) !== JSON.stringify(input) ||
    r.week.date !== input.businessDate ||
    input.businessDate < r.week.start ||
    input.businessDate > r.week.end ||
    (r.before && r.before.documentId !== input.beforeDocumentId) ||
    (r.after && r.after.documentId !== input.afterDocumentId) ||
    r.differences.length > input.limit ||
    r.evidence.some(
      (e) =>
        ![input.beforeDocumentId, input.afterDocumentId].includes(e.sourceId),
    ) ||
    r.differences.some(
      (d) =>
        d.before.some((o) => o.sourceDocumentId !== input.beforeDocumentId) ||
        d.after.some((o) => o.sourceDocumentId !== input.afterDocumentId),
    )
  )
    throw Error("DOCUMENT_COMPARISON_SCOPE");
  if (
    (r.status === "UNAVAILABLE") !== (!r.before || !r.after) ||
    (r.status === "SAME_BINARY" && r.before?.checksum !== r.after?.checksum) ||
    (available && r.before?.checksum === r.after?.checksum)
  )
    throw Error("DOCUMENT_COMPARISON_COVERAGE");
  if (
    r.differences.some((d) => {
      const both = d.before.length > 0 && d.after.length > 0;
      if (!d.before.length && !d.after.length) return true;
      if (d.status === "CHANGED" || d.status === "UNCHANGED")
        return (
          !both ||
          d.before
            .concat(d.after)
            .some((o) => o.identityBasis === "UNKNOWN" || !o.identityKey) ||
          (d.status === "CHANGED") !== d.changedFields.length > 0
        );
      if (d.changedFields.length) return true;
      if (d.status === "NEW_IN_READING")
        return d.before.length > 0 || !d.after.length;
      if (d.status === "NOT_FOUND_IN_NEW")
        return d.after.length > 0 || !d.before.length;
      return false;
    })
  )
    throw Error("DOCUMENT_COMPARISON_COVERAGE");
  if (!available) {
    if (
      r.counts !== null ||
      r.differenceCount !== null ||
      r.differences.length ||
      r.nextOffset !== null
    )
      throw Error("DOCUMENT_COMPARISON_COVERAGE");
    return r;
  }
  if (
    !r.before?.coverage ||
    !r.after?.coverage ||
    !r.before.period ||
    !r.after.period ||
    !r.counts ||
    r.differenceCount === null ||
    Object.values(r.counts).reduce((a, b) => a + b, 0) !== r.differenceCount ||
    new Set(r.differences.map((d) => d.key)).size !== r.differences.length ||
    r.differences.some((d) => r.counts![d.status] === 0) ||
    r.status !==
      (r.before.coverage.complete && r.after.coverage.complete
        ? "COMPARED"
        : "INCOMPLETE") ||
    r.nextOffset !==
      (input.offset + r.differences.length < r.differenceCount
        ? input.offset + r.differences.length
        : null) ||
    r.differences.length !==
      Math.min(input.limit, Math.max(0, r.differenceCount - input.offset))
  )
    throw Error("DOCUMENT_COMPARISON_COVERAGE");
  return r;
}
