import { it, expect } from "vitest";
import {
  copilotOperationsInputSchema,
  copilotNeedProposalInputSchema,
} from "@fl-copilot/domain";
import { objectUnionToolSchema } from "./object-union-tool-schema";
const id = "00000000-0000-4000-8000-000000000001";
it.each([copilotOperationsInputSchema, copilotNeedProposalInputSchema])(
  "sends a root object while retaining common required keys and runtime branch validation",
  async (validator) => {
    const schema = objectUnionToolSchema<unknown>(validator);
    const json = await schema.jsonSchema;
    expect(json.type).toBe("object");
    expect(json.oneOf).toBeUndefined();
    expect(json.anyOf).toBeUndefined();
    expect(json.additionalProperties).toBe(false);
    expect(json.required).toEqual(
      expect.arrayContaining(["kind", "action", "patch"]),
    );
    expect(
      (
        await schema.validate!({
          kind: "SETTINGS",
          action: "PREPARE",
          patch: { position: { latitude: 48, longitude: 2 } },
        })
      ).success,
    ).toBe(false);
    expect(
      (
        await schema.validate!({
          kind: "NEED",
          action: "PREPARE",
          needUnitId: null,
          patch: { name: "Repas", allowReactivateRejected: true },
        })
      ).success,
    ).toBe(false);
  },
);
it("validates and normalizes through the original schema rather than trusting the provider projection", async () => {
  const settings = objectUnionToolSchema(copilotOperationsInputSchema),
    needs = objectUnionToolSchema(copilotNeedProposalInputSchema);
  expect(
    await settings.validate!({
      kind: "SETTINGS",
      action: "PREPARE",
      patch: { city: " Lyon ", postalCode: "69001" },
    }),
  ).toMatchObject({ success: true, value: { patch: { city: "Lyon" } } });
  expect(
    (
      await settings.validate!({
        kind: "FIELD_CLOSE",
        action: "PREPARE",
        eventId: id,
        patch: { city: "Lyon" },
      })
    ).success,
  ).toBe(false);
  expect(
    (
      await needs.validate!({
        kind: "MEMBERSHIP",
        action: "PREPARE",
        needUnitId: id,
        productId: id,
        patch: { decision: "VALIDATED" },
      })
    ).success,
  ).toBe(true);
  expect(
    (
      await needs.validate!({
        kind: "SUBSTITUTION",
        action: "PREPARE",
        needUnitId: id,
        productId: id,
        substituteProductId: id,
        patch: { decision: "VALIDATED" },
      })
    ).success,
  ).toBe(false);
});
