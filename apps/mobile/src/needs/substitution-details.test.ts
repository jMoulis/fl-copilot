import { it, expect } from "vitest";
import { substitutionFixture } from "../../../../scripts/test-substitution-fixtures";
import {
  validateSubstitutionForm,
  substitutionFormValues,
  substitutionPercent,
  substitutionState,
  selectSubstitutions,
} from "./substitution-details";
it("keeps optional unknown compatibilities distinct from declared zero, accepts French decimals", () => {
  const r = validateSubstitutionForm({
    need: "80,5",
    usage: "0",
    price: "",
    packaging: "0",
  });
  expect(r.errors).toEqual({});
  expect(r.values).toEqual({
    need: 0.805,
    usage: 0,
    price: null,
    packaging: 0,
  });
  expect(substitutionPercent(null)).toBe("Indisponible");
  expect(substitutionPercent(0)).toBe("0 %");
});
it("identifies each missing/invalid field instead of silently assigning a score", () => {
  const r = validateSubstitutionForm({
    need: "",
    usage: "-2",
    price: "101",
    packaging: "Infinity",
  });
  expect(Object.keys(r.errors)).toEqual([
    "need",
    "usage",
    "price",
    "packaging",
  ]);
  for (const v of ["NaN", "2e1", "80%", "1,2,3"]) {
    expect(
      validateSubstitutionForm({
        need: v,
        usage: "50",
        price: "",
        packaging: "",
      }).errors.need,
    ).toBeDefined();
  }
});
it("prefills declared fields for correction without exposing learned values as editable inputs", async () => {
  const { substitution: e } = await substitutionFixture();
  expect(
    substitutionFormValues({
      ...e,
      confidence: 0.3,
      relationshipScore: 0.7,
      evidenceCount: 4,
    }),
  ).toEqual({ need: "80", usage: "70", price: "", packaging: "" });
  expect(substitutionState({ ...e, status: "REJECTED" })).toBe("Rejetée");
});

it("separates outgoing/incoming inspection, filters foreign stores and only shows rejected relations explicitly", async () => {
  const { substitution: e } = await substitutionFixture(),
    rows = [
      { entity: e },
      {
        entity: {
          ...e,
          id: "reverse",
          sourceProductId: e.substituteProductId,
          substituteProductId: e.sourceProductId,
        },
      },
      { entity: { ...e, id: "rejected", status: "REJECTED" as const } },
      { entity: { ...e, id: "foreign", storeId: "other" } },
    ];
  expect(
    selectSubstitutions(rows, e.storeId, e.sourceProductId, false, false).map(
      (r) => r.entity.id,
    ),
  ).toEqual([e.id]);
  expect(
    selectSubstitutions(rows, e.storeId, e.sourceProductId, true, false).map(
      (r) => r.entity.id,
    ),
  ).toEqual(["reverse"]);
  expect(
    selectSubstitutions(rows, e.storeId, e.sourceProductId, false, true).map(
      (r) => r.entity.id,
    ),
  ).toEqual([e.id, "rejected"]);
  expect(
    selectSubstitutions(
      rows,
      e.storeId,
      e.substituteProductId,
      false,
      false,
    ).map((r) => r.entity.id),
  ).toEqual(["reverse"]);
});

it("prefills exact canonical percentages without floating-point artifacts or exponent-only fields", async () => {
  const { substitution: e } = await substitutionFixture();
  const values = substitutionFormValues({
    ...e,
    needCompatibility: 0.29,
    usageCompatibility: 1e-8,
    priceCompatibility: 1,
    packagingCompatibility: 0,
  });
  expect(values).toEqual({
    need: "29",
    usage: "0.000001",
    price: "100",
    packaging: "0",
  });
  expect(validateSubstitutionForm(values).errors).toEqual({});
});
