import { createHash } from "node:crypto";
import {
  copilotMessageSchema,
  copilotProductProposalContentSchema,
  productSchema,
  compareProductClassification,
  copilotProductPreviewInputSchema,
  copilotProductPreviewResultSchema,
  type CopilotMessage,
} from "@fl-copilot/domain";
import type { CopilotAiProvider } from "./ai-provider.js";
export function buildProductProposalMessages(
  assistant: CopilotMessage,
  previews: NonNullable<
    Awaited<ReturnType<CopilotAiProvider["generate"]>>["productPreviews"]
  >,
) {
  const latest = new Map<string, (typeof previews)[number]>();
  for (const raw of previews) {
    const entry = {
      group: raw.group,
      input: copilotProductPreviewInputSchema.parse(raw.input),
      result: copilotProductPreviewResultSchema.parse(raw.result),
    };
    if (
      entry.result.preview &&
      JSON.stringify(entry.result.preview) !==
        JSON.stringify(
          compareProductClassification(
            entry.result.preview.before,
            entry.input.patch,
          ),
        )
    )
      throw Error("COPILOT_PROPOSAL_PREVIEW_INVALID");
    const before = entry.result.preview?.before;
    if (
      !before ||
      before.version < 1 ||
      before.storeId !== assistant.storeId ||
      before.id !== entry.input.productId ||
      !compareProductClassification(before, entry.input.patch).changedFields
        .length
    )
      continue;
    latest.set(before.id, entry);
  }
  const groups = new Map<string, Array<(typeof previews)[number]>>();
  for (const entry of latest.values()) {
    const key = entry.group ?? entry.input.productId;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  if (groups.size > 3) throw Error("COPILOT_PROPOSAL_LIMIT");
  return [...groups.values()].map((group) => {
    const items = group.map((entry) => ({
      before: productSchema
        .omit({ packaging: true, familyId: true, subfamilyId: true })
        .parse(entry.result.preview!.before),
      patch: entry.input.patch,
    }));
    const proposal = copilotProductProposalContentSchema.parse(
      items.length === 1
        ? {
            kind: "PRODUCT_CLASSIFICATION_PROPOSAL",
            schemaVersion: 1,
            assistantMessageId: assistant.id,
            ...items[0],
          }
        : {
            kind: "PRODUCT_CLASSIFICATION_BATCH_PROPOSAL",
            schemaVersion: 1,
            assistantMessageId: assistant.id,
            items,
          },
    );
    const hex = createHash("sha256")
      .update(assistant.id + JSON.stringify(proposal))
      .digest("hex");
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    return copilotMessageSchema.parse({
      ...assistant,
      id,
      role: "TOOL",
      createdAt: new Date(Date.parse(assistant.createdAt) + 1).toISOString(),
      text: JSON.stringify(proposal),
      attachments: [],
    });
  });
}
