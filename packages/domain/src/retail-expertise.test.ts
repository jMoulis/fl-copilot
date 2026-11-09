import { expect, it } from "vitest";
import {
  retailExpertiseInputSchema,
  retailExpertiseTopicSchema,
  retailExpertiseCitationSchema,
  retailExpertiseFreshness,
} from "./retail-expertise";
import { readRetailExpertiseReference } from "./retail-expertise-reference";
const now = "2026-11-09T17:00:00.000Z";
it("covers every agreed topic with dated primary provenance, separate local hypotheses and discriminating checks", () => {
  for (const topic of retailExpertiseTopicSchema.options) {
    const result = readRetailExpertiseReference({ topics: [topic] }, now);
    expect(result.status).toBe("CURRENT");
    expect(result.cards).toHaveLength(1);
    const card = result.cards[0]!;
    expect(card.topic).toBe(topic);
    expect(card.sourceFinding).not.toBe(card.applicationHypothesis);
    expect(card.limits.length).toBeGreaterThan(0);
    expect(card.discriminatingQuestions.length).toBeGreaterThan(0);
    expect(card.citation.sources[0]!.scope.length).toBeGreaterThan(30);
    expect(card.citation.reviewedOn).toBe(
      ["DISPLAY_DESIGN", "FRESH_DISPLAY"].includes(topic)
        ? "2026-11-09"
        : "2026-10-18",
    );
  }
});
it("keeps selective ordered lookups independent and cannot mutate the shared corpus", () => {
  const query = { topics: ["SEASONALITY", "VISIBILITY"] };
  const a = readRetailExpertiseReference(query, now),
    expected = JSON.stringify(a);
  a.cards[0]!.limits.push("tampered");
  a.cards[0]!.citation.sources[0]!.url = "https://evil.example/";
  expect(JSON.stringify(readRetailExpertiseReference(query, now))).toBe(
    expected,
  );
});
it.each([
  {},
  { topics: [] },
  { topics: ["VISIBILITY", "VISIBILITY"] },
  { topics: ["VISIBILITY", "SEASONALITY", "SUBSTITUTION"] },
  { topics: ["CUSTOMER_PROFILING"] },
  { topics: ["VISIBILITY"], storeId: "private" },
  { topics: ["VISIBILITY"], query: "private figures" },
  { topics: ["VISIBILITY"], asOf: now },
])(
  "accepts no free-form private context, date or unknown scope (%j)",
  (input) => {
    expect(retailExpertiseInputSchema.safeParse(input).success).toBe(false);
  },
);
it.each([
  ["2026-10-17T23:59:59.000Z", "NOT_YET_REVIEWED"],
  ["2026-10-18T00:00:00.000Z", "CURRENT"],
  ["2027-04-17T23:59:59.000Z", "CURRENT"],
  ["2027-04-18T00:00:00.000Z", "REVALIDATION_REQUIRED"],
])("never silently exposes expired or future curation (%s)", (asOf, status) => {
  const result = readRetailExpertiseReference({ topics: ["VISIBILITY"] }, asOf);
  expect(result.status).toBe(status);
  expect(result.cards).toHaveLength(status === "CURRENT" ? 1 : 0);
});
it("validates publication precision, review dates and public source destinations", () => {
  const citation = readRetailExpertiseReference(
    { topics: ["SHOPPER_CHOICE"] },
    now,
  ).cards[0]!.citation;
  expect(citation.sources[0]!.publishedOn).toBe("2026-02");
  for (const publishedOn of ["2026-13", "2026-02-30", "2027-01-01"])
    expect(
      retailExpertiseCitationSchema.safeParse({
        ...citation,
        sources: [{ ...citation.sources[0], publishedOn }],
      }).success,
    ).toBe(false);
  for (const url of [
    "file:///private/data",
    "http://localhost/",
    "https://user:secret@example.com/",
    "https://bucket.blob.vercel-storage.com/private",
    "https://example.org/?token=secret",
  ])
    expect(
      retailExpertiseCitationSchema.safeParse({
        ...citation,
        sources: [{ ...citation.sources[0], url }],
      }).success,
    ).toBe(false);
  expect(() => retailExpertiseFreshness(citation, "invalid")).toThrow();
});

it("uses the requested cards’ review dates without changing the older reference snapshots", () => {
  const earlier = "2026-11-08T23:59:59.000Z";
  expect(
    readRetailExpertiseReference({ topics: ["VISIBILITY"] }, earlier).status,
  ).toBe("CURRENT");
  expect(
    readRetailExpertiseReference({ topics: ["DISPLAY_DESIGN"] }, earlier),
  ).toMatchObject({ status: "NOT_YET_REVIEWED", cards: [] });
  const current = readRetailExpertiseReference(
    { topics: ["DISPLAY_DESIGN", "FRESH_DISPLAY"] },
    now,
  );
  expect(current.cards.map((c) => c.citation.reviewedOn)).toEqual([
    "2026-11-09",
    "2026-11-09",
  ]);
  expect(
    current.cards.every(
      (c) =>
        c.citation.version === 1 && c.citation.sources[0]!.publishedOn === null,
    ),
  ).toBe(true);
  const afterOldExpiry = "2027-04-18T00:00:00.000Z";
  expect(
    readRetailExpertiseReference({ topics: ["FRESH_DISPLAY"] }, afterOldExpiry)
      .status,
  ).toBe("CURRENT");
  expect(
    readRetailExpertiseReference(
      { topics: ["VISIBILITY", "FRESH_DISPLAY"] },
      afterOldExpiry,
    ),
  ).toMatchObject({ status: "REVALIDATION_REQUIRED", cards: [] });
  expect(
    readRetailExpertiseReference(
      { topics: ["DISPLAY_DESIGN", "FRESH_DISPLAY"] },
      "2027-05-09T00:00:00.000Z",
    ),
  ).toMatchObject({ status: "REVALIDATION_REQUIRED", cards: [] });
});
