import { expect, it } from "vitest";
import {
  compareProductClassification,
  copilotProductPreviewInputSchema,
} from "./copilot-product-preview";
const product = {
  id: "00000000-0000-4000-8000-000000000001",
  storeId: "00000000-0000-4000-8000-000000000002",
  label: "Tomate vrac",
  category: "UNKNOWN",
  nature: "BULK",
  salesUnit: "UNKNOWN",
  status: "ACTIVE",
  version: 4,
  createdAt: "2026-10-14T08:00:00Z",
  updatedAt: "2026-10-14T08:00:00Z",
};
it("separates missing-field completion from replacement and does not invent a committed version", () => {
  const result = compareProductClassification(product, {
    category: "VEGETABLE",
    nature: "PACKAGED",
  });
  expect(result.changedFields).toEqual(["category", "nature"]);
  expect(result.reviewFields).toEqual(["nature"]);
  expect(result.proposed.version).toBe(4);
  expect(result.proposed.updatedAt).toBe(product.updatedAt);
  expect(product.nature).toBe("BULK");
  expect(result.proposed.salesUnit).toBe("UNKNOWN");
});
it("preserves no-op and treats clearing confirmed information as review", () => {
  expect(
    compareProductClassification(product, { nature: "BULK" }).changedFields,
  ).toEqual([]);
  expect(
    compareProductClassification(product, { nature: "UNKNOWN" }).reviewFields,
  ).toEqual(["nature"]);
});
it("rejects empty patches, price fields and injected authority", () => {
  for (const patch of [{}, { price: 2 }, { salesUnit: "LITRE" }])
    expect(() => compareProductClassification(product, patch)).toThrow();
  expect(() =>
    copilotProductPreviewInputSchema.parse({
      productId: product.id,
      patch: { nature: "BULK" },
      confirmed: true,
    }),
  ).toThrow();
});
