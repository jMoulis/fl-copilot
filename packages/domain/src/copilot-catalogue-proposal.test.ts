import { it, expect } from "vitest";
let sequence = 1;
const randomUUID = () =>
  `00000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`;
import {
  copilotCatalogueInputSchema,
  prepareCatalogueRequest,
  readCopilotCatalogueProposal,
  catalogueSnapshotIdentity,
} from "./copilot-catalogue-proposal";
import { chatFixture } from "../../../scripts/test-chat-fixtures";
it("requires explicit target/action and cannot manufacture authority, child IDs or a writable inspection", () => {
  expect(
    copilotCatalogueInputSchema.safeParse({
      action: "UPDATE",
      productId: null,
      patch: { label: "Banane" },
    }).success,
  ).toBe(false);
  expect(
    copilotCatalogueInputSchema.safeParse({
      action: "RETIRE",
      productId: randomUUID(),
      patch: { label: "Banane" },
    }).success,
  ).toBe(false);
  expect(
    copilotCatalogueInputSchema.safeParse({
      action: "CREATE",
      productId: null,
      patch: { label: "Banane" },
      storeId: randomUUID(),
    }).success,
  ).toBe(false);
  expect(() =>
    prepareCatalogueRequest(
      { action: "INSPECT", productId: randomUUID(), patch: {} },
      null,
      randomUUID(),
    ),
  ).toThrow("READ_ONLY");
  expect(() =>
    prepareCatalogueRequest(
      {
        action: "CREATE",
        productId: null,
        patch: {
          label: "Banane",
          identifiers: [{ id: randomUUID(), type: "EAN", value: "00123" }],
        },
      },
      null,
      randomUUID(),
    ),
  ).toThrow();
  const r = prepareCatalogueRequest(
    {
      action: "CREATE",
      productId: null,
      patch: {
        label: "Banane",
        identifiers: [{ type: "PLU", value: "00042" }],
      },
    },
    null,
    randomUUID(),
  );
  expect(r.tool === "product.save" && r.input.draft.identifiers[0]?.value).toBe(
    "00042",
  );
  expect(r.tool === "product.save" && r.input.draft.category).toBe("UNKNOWN");
  const f = chatFixture(randomUUID);
  expect(() =>
    readCopilotCatalogueProposal({
      ...f.message,
      id: randomUUID(),
      attachments: [],
      role: "TOOL",
      replyToMessageId: f.message.id,
      text: JSON.stringify({
        kind: "PRODUCT_CATALOGUE_PROPOSAL",
        schemaVersion: 1,
        assistantMessageId: randomUUID(),
        input: {
          action: "CREATE",
          productId: null,
          patch: { label: "Banane" },
        },
        before: null,
      }),
    }),
  ).not.toThrow();
  expect(catalogueSnapshotIdentity(null)).toBe("null");
});
