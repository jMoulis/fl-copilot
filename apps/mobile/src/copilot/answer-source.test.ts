import { expect, it } from "vitest";
import { readRetailExpertiseReference } from "@fl-copilot/domain";
import { readAnswerSource, formatSourcePublication } from "./answer-source";
const citation = readRetailExpertiseReference(
  { topics: ["SHOPPER_CHOICE"] },
  "2026-10-18T12:00:00.000Z",
).cards[0]!.citation;
const base = {
  label: "Repère métier",
  value: "Donnée externe, pas un fait magasin",
  sourceType: "SOURCE_DOCUMENT",
  sourceId: citation.referenceId,
  retailExpertise: citation,
};
const parse = (value: unknown) =>
  readAnswerSource(encodeURIComponent(JSON.stringify(value)));
it("opens both canonical legacy sources and curated citations without a remote call", () => {
  expect(parse(base).retailExpertise).toEqual(citation);
  expect(parse({ label: "CA", value: 10, sourceId: "canonical" })).toEqual({
    label: "CA",
    value: 10,
    sourceId: "canonical",
  });
});
it.each([
  "PRIVATE_URL",
  "WRONG_SOURCE",
  "WRONG_TYPE",
  "BOTH_KINDS",
  "BAD_DATE",
  "OVERLONG",
])("rejects malformed citation payloads before navigation (%s)", (mode) => {
  const value = structuredClone(base);
  if (mode === "PRIVATE_URL")
    value.retailExpertise.sources[0]!.url = "https://localhost/private";
  if (mode === "WRONG_SOURCE") value.sourceId = "another";
  if (mode === "WRONG_TYPE") value.sourceType = "KPI";
  if (mode === "BAD_DATE") value.retailExpertise.reviewAfterOn = "2025-01-01";
  if (mode === "BOTH_KINDS")
    Object.assign(value, {
      externalResearch: {
        kind: "EXTERNAL_RESEARCH",
        accessedAt: "2026-10-18T12:00:00.000Z",
        citations: [
          { url: "https://example.org/", title: "External", publishedAt: null },
        ],
      },
    });
  if (mode === "OVERLONG") value.value = "a".repeat(10001);
  expect(() => parse(value)).toThrow();
});

it("presents precise publication dates in French without inventing a day for a month-only source", () => {
  expect(formatSourcePublication("2026-02")).toBe("février 2026");
  expect(formatSourcePublication("2026-03-31")).toBe("31 mars 2026");
  expect(formatSourcePublication(null)).toBe(
    "date de publication non précisée",
  );
});

it("keeps source facts readable before enrichment and resolves compact targets locally, without accepting mixed or missing indices", async () => {
  const { largeAnalyticalContext } =
    await import("../../../../scripts/test-analytics-destination-fixtures");
  const { packAnalyticsDestinations } = await import("@fl-copilot/domain");
  const source = {
    label: "CA",
    value: "12.30",
    sourceId: "canonical",
    sourceType: "KPI",
    analyticsIndex: 0,
  };
  const encoded = encodeURIComponent(JSON.stringify(source));
  expect(readAnswerSource(encoded)).toEqual(source);
  const table = packAnalyticsDestinations([largeAnalyticalContext()]);
  expect(readAnswerSource(encoded, table).analyticsContext).toEqual(
    largeAnalyticalContext(),
  );
  for (const altered of [
    { analyticsIndex: 1 },
    { analyticsIndex: -1 },
    { analyticsIndex: 0.5 },
    { analyticsContext: largeAnalyticalContext() },
    { sourceType: "SOURCE_DOCUMENT" },
    { externalResearch: {} },
  ])
    expect(() =>
      readAnswerSource(
        encodeURIComponent(JSON.stringify({ ...source, ...altered })),
        table,
      ),
    ).toThrow();
});

it("opens message-local compact citations and rejects invalid or absent table references", async () => {
  const sources = [
    {
      label: "Ventes",
      value: "Qualification intégrale",
      sourceId: "published-period",
      sourceType: "KPI",
    },
  ];
  expect(readAnswerSource("ref:0", undefined, sources)).toEqual(sources[0]);
  for (const link of [
    "ref:-1",
    "ref:0.5",
    "ref:01",
    "ref:1",
    "ref:96",
    "ref:0/../1",
  ])
    expect(() => readAnswerSource(link, undefined, sources)).toThrow();
  expect(() => readAnswerSource("ref:0")).toThrow();
});
