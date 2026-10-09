import { it, expect } from "vitest";
import { needUnitSchema, normalizeNeedUnitCode } from "./need-unit";

it("keeps needs separate from units/order quantities and requires explicit valid identity/status", () => {
  expect(normalizeNeedUnitCode("Fruit à emporter")).toBe("FRUIT_A_EMPORTER");
  expect(normalizeNeedUnitCode("000 apéritif")).toBe("000_APERITIF");
  const n = {
    id: "11111111-1111-4111-8111-111111111111",
    storeId: "22222222-2222-4222-8222-222222222222",
    code: "APERITIF",
    name: "Apéritif",
    description: null,
    status: "ACTIVE" as const,
    createdBy: "USER" as const,
    version: 1,
    createdAt: "2026-10-09T08:00:00Z",
    updatedAt: "2026-10-09T08:00:00Z",
  };
  expect(n.id).not.toBe(n.storeId);
  expect(needUnitSchema.safeParse({ ...n, quantity: 20 }).success).toBe(false);
  expect(needUnitSchema.safeParse({ ...n, code: "apéritif" }).success).toBe(
    false,
  );
  expect(needUnitSchema.parse({ ...n, status: "INACTIVE" }).id).toBe(n.id);
});
