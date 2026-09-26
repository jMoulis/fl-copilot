import { describe, expect, it } from "vitest";
import {
  normalizeProductLabel,
  productAliasSchema,
  productIdentifierSchema,
} from "./products";

const timestamp = "2026-09-26T08:00:00.000Z";

describe("product contracts", () => {
  it("preserves leading zeroes in identifiers", () => {
    const identifier = productIdentifierSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      storeId: "22222222-2222-4222-8222-222222222222",
      productId: "33333333-3333-4333-8333-333333333333",
      type: "EAN",
      value: "0000087003017",
      source: "MERCALYS",
      status: "VALIDATED",
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    });

    expect(identifier.value).toBe("0000087003017");
    expect(() =>
      productIdentifierSchema.parse({ ...identifier, value: 87003017 }),
    ).toThrow();
  });

  it("uses one deterministic normalized alias", () => {
    expect(normalizeProductLabel("  Poire conférence — Vrac  ")).toBe(
      "POIRE CONFERENCE VRAC",
    );
    expect(() =>
      productAliasSchema.parse({
        id: "11111111-1111-4111-8111-111111111111",
        storeId: "22222222-2222-4222-8222-222222222222",
        productId: "33333333-3333-4333-8333-333333333333",
        alias: "Poire conférence — Vrac",
        normalizedAlias: "POIRE CONF",
        source: "USER",
        status: "VALIDATED",
        confidence: null,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      }),
    ).toThrow();
  });
});
