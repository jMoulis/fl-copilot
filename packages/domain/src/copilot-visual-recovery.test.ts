let nextId = 1;
const randomUUID = () =>
  `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;
import { expect, it } from "vitest";
import {
  legacyVisualActionInputSchema,
  sourceVisualActionInputSchema,
  visualActionInputSchema,
  prepareVisualActionBasis,
  visualActionStatus,
  validateVisualActionBasis,
} from "./copilot-visual-actions";
const hash = async (_value: string) => {
  void _value;
  return "a".repeat(64);
};
it("keeps capabilities 1 and 2 frozen while capability 3 prepares only a local review intent", async () => {
  const input = {
    action: "REVIEW_RECOVERY",
    productId: randomUUID(),
    visualIdentityId: null,
  };
  expect(legacyVisualActionInputSchema.safeParse(input).success).toBe(false);
  expect(sourceVisualActionInputSchema.safeParse(input).success).toBe(false);
  expect(visualActionInputSchema.parse(input)).toEqual(input);
  const basis = await prepareVisualActionBasis(
    randomUUID(),
    input,
    {
      product: null,
      currentLink: null,
      currentIdentity: null,
      currentAsset: null,
      selectedIdentity: null,
      selectedAsset: null,
    },
    hash,
  );
  expect(basis.currentDisplay).toBe("UNAVAILABLE");
  expect(visualActionStatus(visualActionInputSchema.parse(input), basis)).toBe(
    "REVIEW_LOCAL",
  );
  expect(basis.product).toBeNull();
  expect(basis.currentAsset).toBeNull();
  expect(() =>
    validateVisualActionBasis(basis.storeId, input, {
      ...basis,
      currentDisplay: "PLACEHOLDER",
    }),
  ).toThrow("VISUAL_RECOVERY_BASIS_INVALID");
});
it.each([
  { recoveryAction: "RETRY_LOCAL" },
  { canWrite: true },
  { entityId: randomUUID() },
  { sourceDocumentId: randomUUID() },
  { visualIdentityId: randomUUID() },
])(
  "does not let a model decide local recovery or provide authority: %j",
  (extra) => {
    expect(
      visualActionInputSchema.safeParse({
        action: "REVIEW_RECOVERY",
        productId: randomUUID(),
        visualIdentityId: null,
        ...extra,
      }).success,
    ).toBe(false);
  },
);
