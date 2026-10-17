import { z } from "zod";
import { commercialVersionDecisionSchema } from "./commercial-version-decision";
import { copilotEvidenceSchema } from "./copilot-candidate";
export const copilotReferenceInspectionInputSchema = z
  .strictObject({ firstDocumentId: z.uuid(), secondDocumentId: z.uuid() })
  .refine((v) => v.firstDocumentId !== v.secondDocumentId);
const original = z.strictObject({
  documentId: z.uuid(),
  filename: z.string().min(1).max(240),
  checksum: z.string().min(1),
});
export const copilotReferenceInspectionResultSchema = z.strictObject({
  storeId: z.uuid(),
  input: copilotReferenceInspectionInputSchema,
  status: z.enum(["RECORDED", "NO_DECISION", "UNAVAILABLE", "LIMIT_EXCEEDED"]),
  first: original.nullable(),
  second: original.nullable(),
  decision: commercialVersionDecisionSchema.nullable(),
  reviewStatus: z
    .enum(["MATCHING_SNAPSHOTS", "REVIEW_REQUIRED", "LIMIT_EXCEEDED"])
    .nullable(),
  evidence: z.array(copilotEvidenceSchema).min(1).max(3),
});
/** A synchronized historical choice is not a fresh source-review attestation. */
export function validateReferenceInspectionResult(
  storeId: string,
  rawInput: unknown,
  raw: unknown,
) {
  const input = copilotReferenceInspectionInputSchema.parse(rawInput);
  const r = copilotReferenceInspectionResultSchema.parse(raw);
  const ids = [input.firstDocumentId, input.secondDocumentId];
  if (
    r.storeId !== storeId ||
    JSON.stringify(r.input) !== JSON.stringify(input) ||
    (r.first && r.first.documentId !== input.firstDocumentId) ||
    (r.second && r.second.documentId !== input.secondDocumentId) ||
    r.evidence.some((e) => !ids.includes(e.sourceId)) ||
    (r.decision &&
      (r.decision.storeId !== storeId ||
        !ids.includes(r.decision.before.documentId) ||
        !ids.includes(r.decision.after.documentId)))
  )
    throw Error("REFERENCE_INSPECTION_SCOPE");
  if (
    (r.status === "RECORDED") !== !!r.decision ||
    (r.status === "RECORDED") !== (r.reviewStatus !== null) ||
    (r.status !== "LIMIT_EXCEEDED" &&
      (r.status === "UNAVAILABLE") !== (!r.first || !r.second)) ||
    (r.status === "LIMIT_EXCEEDED" &&
      (r.decision !== null || r.reviewStatus !== null))
  )
    throw Error("REFERENCE_INSPECTION_STATE");
  if (r.reviewStatus === "MATCHING_SNAPSHOTS" && r.decision) {
    const byId = new Map([r.first!, r.second!].map((s) => [s.documentId, s]));
    if (
      [r.decision.before, r.decision.after].some(
        (s) => byId.get(s.documentId)?.checksum !== s.checksum,
      )
    )
      throw Error("REFERENCE_INSPECTION_CHECKSUM");
  }
  return r;
}
