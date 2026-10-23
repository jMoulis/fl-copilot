import { z } from "zod";
import { copilotMessageSchema } from "./copilot-conversation";
import { copilotEvidenceSchema } from "./copilot-candidate";
import { inspectProductResultSchema } from "./copilot-tools";
import {
  productEditorDraftSchema,
  productCatalogueRequestSchema,
} from "./copilot-product-catalogue";
export const catalogueSnapshotSchema =
  inspectProductResultSchema.shape.snapshot.unwrap();
export type CatalogueSnapshot = z.infer<typeof catalogueSnapshotSchema>;
export function catalogueSnapshotDraft(s: CatalogueSnapshot) {
  const p = s.product.entity;
  return productEditorDraftSchema.parse({
    label: p.label,
    category: p.category,
    nature: p.nature,
    salesUnit: p.salesUnit,
    packagingQuantity: p.packaging?.quantity ?? "",
    packagingUnit: p.packaging?.unit ?? "KG",
    packagingSourceLabel: p.packaging?.sourceLabel ?? "",
    identifiers: s.identifiers.map(({ entity: e }) => ({
      id: e.id,
      type: e.type,
      value: e.value,
    })),
    aliases: s.aliases.map(({ entity: e }) => ({ id: e.id, alias: e.alias })),
  });
}
export const copilotCatalogueInputSchema = z
  .strictObject({
    action: z.enum(["INSPECT", "CREATE", "UPDATE", "RETIRE"]),
    productId: z.uuid().nullable(),
    patch: z.strictObject(productEditorDraftSchema.shape).partial(),
  })
  .superRefine((v, c) => {
    if (
      (v.action === "CREATE") !== (v.productId === null) ||
      (["RETIRE", "INSPECT"].includes(v.action)
        ? Object.keys(v.patch).length > 0
        : Object.keys(v.patch).length === 0)
    )
      c.addIssue({ code: "custom", message: "Invalid catalogue action" });
  });
export type CatalogueInput = z.infer<typeof copilotCatalogueInputSchema>;
/** Same editor projection and version basis on the server and native device. */
export function prepareCatalogueRequest(
  raw: unknown,
  before: CatalogueSnapshot | null,
  operationId: string,
) {
  const input = copilotCatalogueInputSchema.parse(raw);
  if (input.action === "INSPECT") throw Error("CATALOGUE_READ_ONLY");
  if (
    input.action !== "CREATE" &&
    (!before ||
      before.product.entity.id !== input.productId ||
      before.product.entity.deletedAt ||
      (input.action === "RETIRE" &&
        before.product.entity.status === "INACTIVE"))
  )
    throw Error("CATALOGUE_TARGET_UNAVAILABLE");
  if (input.action === "CREATE" && before)
    throw Error("CATALOGUE_TARGET_INVALID");
  if (input.action === "RETIRE")
    return productCatalogueRequestSchema.parse({
      operationId,
      schemaVersion: 1,
      tool: "product.retire",
      input: {
        productId: input.productId,
        expectedVersion: before!.product.entity.version,
      },
    });
  const base = before
    ? catalogueSnapshotDraft(before)
    : {
        category: "UNKNOWN",
        nature: "UNKNOWN",
        salesUnit: "UNKNOWN",
        packagingQuantity: "",
        packagingUnit: "KG",
        packagingSourceLabel: "",
        identifiers: [],
        aliases: [],
      };
  const draft = productEditorDraftSchema.parse({ ...base, ...input.patch });
  if (before)
    for (const key of ["identifiers", "aliases"] as const) {
      if (
        draft[key].some(
          (e) => e.id && !before[key].some((r) => r.entity.id === e.id),
        )
      )
        throw Error("CATALOGUE_CHILD_INVALID");
    }
  return productCatalogueRequestSchema.parse({
    operationId,
    schemaVersion: 1,
    tool: "product.save",
    input: {
      mode: input.action,
      productId: input.productId,
      expectedVersion: before?.product.entity.version ?? null,
      expectedChildren: {
        identifiers:
          before?.identifiers.map((r) => ({
            id: r.entity.id,
            version: r.entity.version,
          })) ?? [],
        aliases:
          before?.aliases.map((r) => ({
            id: r.entity.id,
            version: r.entity.version,
          })) ?? [],
      },
      draft,
    },
  });
}
/** Ignore transport sync flags; retain every canonical entity field and child version. */
export function catalogueSnapshotIdentity(raw: CatalogueSnapshot | null) {
  if (!raw) return "null";
  const s = catalogueSnapshotSchema.parse(raw);
  return JSON.stringify({
    product: s.product.entity,
    identifiers: s.identifiers
      .map((r) => r.entity)
      .sort((a, b) => a.id.localeCompare(b.id)),
    aliases: s.aliases
      .map((r) => r.entity)
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}
export const copilotCataloguePreviewSchema = z.strictObject({
  input: copilotCatalogueInputSchema,
  status: z.enum([
    "READY",
    "UNCHANGED",
    "UNAVAILABLE",
    "LIMIT_EXCEEDED",
    "INSPECTED",
  ]),
  before: catalogueSnapshotSchema.nullable(),
  evidence: z.array(copilotEvidenceSchema).min(1).max(2),
});
export const copilotCatalogueProposalSchema = z.strictObject({
  kind: z.literal("PRODUCT_CATALOGUE_PROPOSAL"),
  schemaVersion: z.literal(1),
  assistantMessageId: z.uuid(),
  input: copilotCatalogueInputSchema,
  before: catalogueSnapshotSchema.nullable(),
});
export function readCopilotCatalogueProposal(raw: unknown) {
  const message = copilotMessageSchema.parse(raw);
  if (
    message.role !== "TOOL" ||
    !message.replyToMessageId ||
    message.attachments.length
  )
    throw Error("CATALOGUE_PROPOSAL_INVALID");
  const content = copilotCatalogueProposalSchema.parse(
    JSON.parse(message.text),
  );
  if (
    content.before &&
    [
      content.before.product,
      ...content.before.identifiers,
      ...content.before.aliases,
    ].some((r) => r.entity.storeId !== message.storeId)
  )
    throw Error("CATALOGUE_PROPOSAL_SCOPE");
  if (
    content.before &&
    [...content.before.identifiers, ...content.before.aliases].some(
      (r) => r.entity.productId !== content.input.productId,
    )
  )
    throw Error("CATALOGUE_CHILD_SCOPE");
  const request = prepareCatalogueRequest(
    content.input,
    content.before,
    message.id,
  );
  return { message, content, request };
}
