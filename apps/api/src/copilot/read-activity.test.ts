import { expect, it } from "vitest";
import { readActivityStage } from "./read-activity";
it("maps real tool keys without disclosing private arguments", () => {
  expect(
    readActivityStage(
      JSON.stringify(["period", { referencePeriod: { start: "2026-10-01" } }]),
    ),
  ).toBe("COMPARISON");
  expect(
    readActivityStage(JSON.stringify(["period", { referencePeriod: null }])),
  ).toBe("ANALYTICS");
  expect(
    readActivityStage(JSON.stringify(["analytics-query", { private: true }])),
  ).toBe("ANALYTICS");
  expect(
    readActivityStage(
      JSON.stringify(["product-search", { query: "private label" }]),
    ),
  ).toBe("PRODUCTS");
  for (const key of [
    "documents",
    "pdf",
    "offers",
    "waste-receipt",
    "commercial-preparation",
    "plan-readiness",
  ])
    expect(readActivityStage(JSON.stringify([key, { private: true }]))).toBe(
      "DOCUMENTS",
    );
});
