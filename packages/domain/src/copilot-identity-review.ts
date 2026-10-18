import { z } from "zod";
import {
  productAliasSchema,
  productIdentifierSchema,
  productSchema,
  normalizeProductLabel,
} from "./products";
import { copilotMessageSchema } from "./copilot-conversation";
import { copilotEvidenceSchema } from "./copilot-candidate";
import { productClassificationAuthoritySchema } from "./copilot-product-mutations";
/** Model input selects one existing identity; versions and reversal authority are app-owned. */
export const identityReviewInputSchema = z
  .strictObject({
    kind: z.enum(["ALIAS", "IDENTIFIER"]),
    productId: z.uuid(),
    entryId: z.uuid(),
    decision: z.enum(["VALIDATE", "REJECT"]),
  })
  .superRefine((v, c) => {
    if (v.kind === "IDENTIFIER" && v.decision !== "VALIDATE")
      c.addIssue({
        code: "custom",
        message: "Identifiers support validation only",
      });
  });
export type IdentityReviewInput = z.infer<typeof identityReviewInputSchema>;
export const identityReviewBasisSchema = z.strictObject({
  product: productSchema,
  entry: z.union([productAliasSchema, productIdentifierSchema]),
});
export type IdentityReviewBasis = z.infer<typeof identityReviewBasisSchema>;
export function identityReviewBasisMatches(
  input: IdentityReviewInput,
  basis: IdentityReviewBasis,
) {
  return (
    basis.product.id === input.productId &&
    basis.product.status === "ACTIVE" &&
    !basis.product.deletedAt &&
    basis.entry.id === input.entryId &&
    basis.entry.productId === input.productId &&
    basis.entry.storeId === basis.product.storeId &&
    !basis.entry.deletedAt &&
    (input.kind === "ALIAS" ? "alias" in basis.entry : "value" in basis.entry)
  );
}
export function identityReviewDesiredStatus(input: IdentityReviewInput) {
  return input.decision === "VALIDATE"
    ? ("VALIDATED" as const)
    : ("REJECTED" as const);
}
export function identityReviewAfter(
  input: IdentityReviewInput,
  basis: IdentityReviewBasis,
  at: string,
) {
  const entry = {
    ...basis.entry,
    status: identityReviewDesiredStatus(input),
    version: basis.entry.version + 1,
    updatedAt: at,
  };
  return input.kind === "ALIAS"
    ? productAliasSchema.parse(entry)
    : productIdentifierSchema.parse(entry);
}
export const identityReviewPreviewSchema = z.strictObject({
  input: identityReviewInputSchema,
  status: z.enum([
    "READY",
    "UNCHANGED",
    "UNAVAILABLE",
    "AMBIGUOUS",
    "LIMIT_EXCEEDED",
  ]),
  before: identityReviewBasisSchema.nullable(),
  evidence: z.array(copilotEvidenceSchema).length(1),
});
export const identityReviewProposalSchema = z.strictObject({
  kind: z.literal("PRODUCT_IDENTITY_REVIEW"),
  schemaVersion: z.literal(1),
  assistantMessageId: z.uuid(),
  input: identityReviewInputSchema,
  before: identityReviewBasisSchema,
});
export function readIdentityReviewProposal(raw: unknown) {
  const message = copilotMessageSchema.parse(raw);
  if (
    message.role !== "TOOL" ||
    !message.replyToMessageId ||
    message.attachments.length
  )
    throw Error("IDENTITY_REVIEW_INVALID");
  const content = identityReviewProposalSchema.parse(JSON.parse(message.text));
  if (
    content.before.product.storeId !== message.storeId ||
    !identityReviewBasisMatches(content.input, content.before)
  )
    throw Error("IDENTITY_REVIEW_SCOPE");
  if (
    content.before.entry.status === identityReviewDesiredStatus(content.input)
  )
    throw Error("IDENTITY_REVIEW_UNCHANGED");
  return {
    message,
    content,
    request: {
      operationId: message.id,
      input: content.input,
      before: content.before,
    },
  };
}
export const identityReviewRequestSchema = z
  .strictObject({
    operationId: z.uuid(),
    input: identityReviewInputSchema,
    before: identityReviewBasisSchema,
  })
  .refine((v) => identityReviewBasisMatches(v.input, v.before));
export const identityReviewAuthoritySchema =
  productClassificationAuthoritySchema.extend({
    reactivateRejectedAlias: z.boolean(),
  });
export type IdentityReviewAuthority = z.infer<
  typeof identityReviewAuthoritySchema
>;
export const identityReviewResultSchema = z.strictObject({
  operationId: z.uuid(),
  userMessageId: z.uuid(),
  appliedAt: z.iso.datetime(),
  commandId: z.uuid(),
  before: identityReviewBasisSchema,
  after: z.union([productAliasSchema, productIdentifierSchema]),
});

/** One shared policy for the bounded alias-ambiguity reads on server and device. */
export const IDENTITY_REVIEW_PRODUCT_LIMIT = 2000;
export function identityReviewAliasReadiness(
  productId: string,
  normalizedAlias: string,
  conflictingValidatedAlias: boolean,
  products: ReadonlyArray<{ id: string; label: string }>,
): "READY" | "AMBIGUOUS" | "LIMIT_EXCEEDED" {
  if (products.length > IDENTITY_REVIEW_PRODUCT_LIMIT) return "LIMIT_EXCEEDED";
  return conflictingValidatedAlias ||
    products.some(
      (p) =>
        p.id !== productId &&
        normalizeProductLabel(p.label) === normalizedAlias,
    )
    ? "AMBIGUOUS"
    : "READY";
}
