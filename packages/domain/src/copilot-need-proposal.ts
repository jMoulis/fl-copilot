import { z } from "zod";
import { needUnitSchema, normalizeNeedUnitCode } from "./need-unit";
import { needMembershipSchema } from "./need-membership";
import { productSubstitutionSchema } from "./product-substitution";
import { productSchema } from "./products";
import {
  needToolRequestSchema,
  membershipSaveInputSchema,
  substitutionSaveInputSchema,
} from "./copilot-need-tools";
import { copilotMessageSchema } from "./copilot-conversation";
import { copilotEvidenceSchema } from "./copilot-candidate";
const common = {
  action: z.enum(["INSPECT", "PREPARE"]),
  needUnitId: z.uuid().nullable(),
};
const decision = z.enum(["VALIDATED", "REJECTED"]);
export const copilotNeedProposalInputSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      ...common,
      kind: z.literal("NEED"),
      patch: z.strictObject({
        code: needUnitSchema.shape.code.optional(),
        name: needUnitSchema.shape.name.optional(),
        description: needUnitSchema.shape.description.optional(),
        status: needUnitSchema.shape.status.optional(),
      }),
    }),
    z.strictObject({
      ...common,
      kind: z.literal("MEMBERSHIP"),
      productId: z.uuid(),
      patch: z.strictObject({
        decision: decision.optional(),
        strength: membershipSaveInputSchema.shape.strength.optional(),
        primary: z.boolean().optional(),
        declaredConfidence:
          membershipSaveInputSchema.shape.declaredConfidence.optional(),
      }),
    }),
    z.strictObject({
      ...common,
      kind: z.literal("SUBSTITUTION"),
      productId: z.uuid(),
      substituteProductId: z.uuid(),
      patch: z.strictObject({
        decision: decision.optional(),
        needCompatibility:
          substitutionSaveInputSchema.shape.needCompatibility.optional(),
        usageCompatibility:
          substitutionSaveInputSchema.shape.usageCompatibility.optional(),
        priceCompatibility:
          substitutionSaveInputSchema.shape.priceCompatibility.optional(),
        packagingCompatibility:
          substitutionSaveInputSchema.shape.packagingCompatibility.optional(),
      }),
    }),
  ])
  .superRefine((v, c) => {
    if (
      (v.action === "INSPECT" && Object.keys(v.patch).length) ||
      (v.action === "PREPARE" && !Object.keys(v.patch).length) ||
      (v.kind !== "NEED" && !v.needUnitId) ||
      (v.action === "INSPECT" && !v.needUnitId) ||
      (v.kind === "SUBSTITUTION" && v.productId === v.substituteProductId)
    )
      c.addIssue({ code: "custom", message: "Invalid need action" });
  });
export type NeedProposalInput = z.infer<typeof copilotNeedProposalInputSchema>;
export const needProposalBasisSchema = z.strictObject({
  need: needUnitSchema.nullable(),
  product: productSchema.nullable(),
  substitute: productSchema.nullable(),
  membership: needMembershipSchema.nullable(),
  substitution: productSubstitutionSchema.nullable(),
});
export type NeedProposalBasis = z.infer<typeof needProposalBasisSchema>;
export function validateNeedProposalBasis(
  storeId: string,
  input: NeedProposalInput,
  raw: unknown,
) {
  const b = needProposalBasisSchema.parse(raw);
  if (
    [b.need, b.product, b.substitute, b.membership, b.substitution].some(
      (e) => e && e.storeId !== storeId,
    ) ||
    b.need?.id !== (input.needUnitId ?? undefined) ||
    (input.kind === "NEED" &&
      (b.product || b.substitute || b.membership || b.substitution)) ||
    (input.kind !== "NEED" &&
      (!b.need || !b.product || b.product.id !== input.productId)) ||
    (input.kind === "MEMBERSHIP" && (b.substitute || b.substitution)) ||
    (input.kind === "SUBSTITUTION" &&
      (!b.substitute ||
        b.substitute.id !== input.substituteProductId ||
        b.membership))
  )
    throw Error("NEED_PROPOSAL_SCOPE");
  if (
    b.membership &&
    (input.kind !== "MEMBERSHIP" ||
      b.membership.needUnitId !== input.needUnitId ||
      b.membership.productId !== input.productId)
  )
    throw Error("NEED_PROPOSAL_SCOPE");
  if (
    b.substitution &&
    (input.kind !== "SUBSTITUTION" ||
      b.substitution.needUnitId !== input.needUnitId ||
      b.substitution.sourceProductId !== input.productId ||
      b.substitution.substituteProductId !== input.substituteProductId)
  )
    throw Error("NEED_PROPOSAL_SCOPE");
  return b;
}
/** App supplied operation and review, never model supplied authority or learned values. */
export function prepareNeedProposalRequest(
  input: NeedProposalInput,
  b: NeedProposalBasis,
  operationId: string,
  reactivateRejected = false,
) {
  if (input.action !== "PREPARE") throw Error("NEED_PROPOSAL_READ_ONLY");
  const base = { operationId, schemaVersion: 1 };
  if (input.kind === "NEED") {
    if (b.need && input.patch.code && input.patch.code !== b.need.code)
      throw Error("NEED_CODE_IMMUTABLE");
    return needToolRequestSchema.parse({
      ...base,
      tool: "need.save",
      input: {
        mode: b.need ? "UPDATE" : "CREATE",
        needUnitId: input.needUnitId,
        expectedVersion: b.need?.version ?? null,
        code: b.need?.code ?? normalizeNeedUnitCode(input.patch.name ?? ""),
        name: b.need?.name,
        description: b.need?.description ?? null,
        status: b.need?.status ?? "ACTIVE",
        ...input.patch,
      },
    });
  }
  const r = input.kind === "MEMBERSHIP" ? b.membership : b.substitution;
  const p = input.patch;
  const association = {
    productId: input.productId,
    productVersion: b.product?.version,
    needUnitId: input.needUnitId,
    needVersion: b.need?.version,
    expectedVersion: r?.version ?? null,
    decision:
      p.decision ??
      (r?.status === "REJECTED"
        ? "REJECTED"
        : r?.humanConfirmed
          ? "VALIDATED"
          : undefined),
    allowReactivateRejected: reactivateRejected,
  };
  if (input.kind === "MEMBERSHIP")
    return needToolRequestSchema.parse({
      ...base,
      tool: "need.membership",
      input: {
        ...association,
        strength: b.membership?.strength,
        primary: b.membership?.primary ?? false,
        declaredConfidence: b.membership ? null : undefined,
        ...input.patch,
      },
    });
  return needToolRequestSchema.parse({
    ...base,
    tool: "substitution.save",
    input: {
      ...association,
      substituteProductId: input.substituteProductId,
      substituteProductVersion: b.substitute?.version,
      needCompatibility: b.substitution?.needCompatibility,
      usageCompatibility: b.substitution?.usageCompatibility,
      priceCompatibility: b.substitution?.priceCompatibility ?? null,
      packagingCompatibility: b.substitution?.packagingCompatibility ?? null,
      ...input.patch,
    },
  });
}
export function needProposalRefused(
  input: NeedProposalInput,
  b: NeedProposalBasis,
) {
  return (
    input.kind !== "NEED" &&
    (input.kind === "MEMBERSHIP" ? b.membership : b.substitution)?.status ===
      "REJECTED" &&
    input.patch.decision === "VALIDATED"
  );
}
export function needProposalUnchanged(
  input: NeedProposalInput,
  b: NeedProposalBasis,
) {
  if (input.kind === "NEED")
    return (
      !!b.need &&
      Object.entries(input.patch).every(([k, v]) => b.need![k as "name"] === v)
    );
  const r = input.kind === "MEMBERSHIP" ? b.membership : b.substitution;
  if (!r || !r.humanConfirmed) return false;
  return Object.entries(input.patch).every(([k, v]) =>
    k === "decision"
      ? v === "VALIDATED"
        ? ["VALIDATED", "LEARNING"].includes(r.status)
        : r.status === v
      : k === "declaredConfidence"
        ? v === null || r.confidence === v
        : r[k as "id"] === v,
  );
}
export const copilotNeedPreviewSchema = z.strictObject({
  input: copilotNeedProposalInputSchema,
  status: z.enum([
    "READY",
    "INSPECTED",
    "UNCHANGED",
    "UNAVAILABLE",
    "NEEDS_INFORMATION",
    "BLOCKED",
  ]),
  basis: needProposalBasisSchema,
  missingFields: z.array(z.string().max(80)).max(12),
  evidence: z.array(copilotEvidenceSchema).min(1).max(2),
});
export const copilotNeedProposalSchema = z.strictObject({
  kind: z.literal("NEED_MUTATION_PROPOSAL"),
  schemaVersion: z.literal(1),
  assistantMessageId: z.uuid(),
  input: copilotNeedProposalInputSchema,
  basis: needProposalBasisSchema,
});
export function readCopilotNeedProposal(raw: unknown) {
  const message = copilotMessageSchema.parse(raw);
  if (
    message.role !== "TOOL" ||
    !message.replyToMessageId ||
    message.attachments.length
  )
    throw Error("NEED_PROPOSAL_INVALID");
  const content = copilotNeedProposalSchema.parse(JSON.parse(message.text));
  validateNeedProposalBasis(message.storeId, content.input, content.basis);
  const request = prepareNeedProposalRequest(
    content.input,
    content.basis,
    message.id,
  );
  return { message, content, request };
}
