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
    "document-comparison",
    "reference-inspection",
    "plan-readiness",
  ])
    expect(readActivityStage(JSON.stringify([key, { private: true }]))).toBe(
      "DOCUMENTS",
    );
});

it("shows plan validation preparation without exposing its arguments", () =>
  expect(
    readActivityStage(JSON.stringify(["plan-validation", { private: true }])),
  ).toBe("PROPOSAL"));

it("shows reference review preparation without exposing source arguments", () =>
  expect(
    readActivityStage(JSON.stringify(["reference-preview", { private: true }])),
  ).toBe("PROPOSAL"));
it("shows scenario calculation progress without exposing hypotheses", () =>
  expect(
    readActivityStage(JSON.stringify(["price-scenario", { private: true }])),
  ).toBe("ANALYTICS"));

it("shows a declared action review as comparison without private arguments", () =>
  expect(
    readActivityStage(
      JSON.stringify(["declared-action-review", { private: true }]),
    ),
  ).toBe("COMPARISON"));

it("shows context revalidation without exposing private source arguments", () =>
  expect(
    readActivityStage(
      JSON.stringify(["recommendation-context", { private: true }]),
    ),
  ).toBe("CONTEXT"));
