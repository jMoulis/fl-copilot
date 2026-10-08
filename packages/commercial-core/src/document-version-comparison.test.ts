import { describe, it, expect } from "vitest";
import {
  compareCommercialDocumentVersions,
  type CommercialComparisonPage,
} from "./document-version-comparison";
import { makeCommercialChoiceFixture } from "../../../scripts/commercial-choice-fixture-data";
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
let ordinal = 0;
const uuid = () =>
  `00000000-0000-4000-8000-${String(++ordinal).padStart(12, "0")}`;
async function sample() {
  const f = await makeCommercialChoiceFixture(
    {},
    async () => "a".repeat(64),
    uuid,
  );
  const raw = clone(f.raw);
  raw.operations[0]!.items[0]!.fields.push({
    name: "productLabel",
    rawValue: "RAISIN BLANC VRAC",
    confidence: 1,
    evidence: [{ pageNumber: 1, quote: "RAISIN BLANC VRAC", region: null }],
  });
  const before: CommercialComparisonPage = {
    id: uuid(),
    storeId: f.storeId,
    sourceDocumentId: uuid(),
    checksum: "sha256:old",
    pageNumber: 1,
    pageCount: 1,
    status: "READY",
    model: "test",
    schemaVersion: "v1",
    reading: raw,
  };
  const after = {
    ...clone(before),
    id: uuid(),
    sourceDocumentId: uuid(),
    checksum: "sha256:new",
  };
  return { f, before, after };
}
function compare(x: Awaited<ReturnType<typeof sample>>) {
  return compareCommercialDocumentVersions({
    storeId: x.f.storeId,
    beforeDocumentId: x.before.sourceDocumentId,
    afterDocumentId: x.after.sourceDocumentId,
    before: [x.before],
    after: [x.after],
  });
}
describe("corrected commercial PDF source comparison", () => {
  it("proposes a price change with references and does not mutate either original reading", async () => {
    const x = await sample();
    x.after.reading!.operations[0]!.items[0]!.fields.find(
      (f) => f.name === "sellingPrice",
    )!.rawValue = "2,40€";
    const original = JSON.stringify(x);
    const r = compare(x);
    expect(r.differences[0]).toMatchObject({
      status: "CHANGED",
      changedFields: ["PRICE"],
    });
    expect(r.differences[0]?.before[0]?.readingId).toBe(x.before.id);
    expect(JSON.stringify(x)).toBe(original);
  });
  it("distinguishes strict and inclusive ceilings and keeps a card's separate base-price change", async () => {
    const x = await sample();
    x.after.reading!.operations[0]!.items[0]!.fields.find(
      (f) => f.name === "priceOperator",
    )!.rawValue = "<=";
    expect(compare(x).differences[0]?.changedFields).toContain("PRICE");
    for (const p of [x.before, x.after])
      p.reading!.operations[0]!.items[0]!.fields.push({
        name: "customerMechanism",
        rawValue: "20% avantage carte",
        confidence: 1,
        evidence: [],
      });
    x.after.reading!.operations[0]!.items[0]!.fields.find(
      (f) => f.name === "sellingPrice",
    )!.rawValue = "2,40€";
    expect(compare(x).differences[0]?.changedFields).toContain("BASE_PRICE");
  });
  it("detects changed dates, applicability, supplier terms and deadlines", async () => {
    const x = await sample();
    x.after.reading!.operations[0]!.fields.find(
      (f) => f.name === "saleEnd",
    )!.rawValue = "dimanche 11 octobre";
    x.after.reading!.operations[0]!.fields.push(
      {
        name: "applicabilityCondition",
        rawValue: "uniquement V4",
        confidence: 1,
        evidence: [],
      },
      {
        name: "preorderDeadline",
        rawValue: "lundi 5 octobre",
        confidence: 1,
        evidence: [],
      },
    );
    const fields = compare(x).differences[0]?.changedFields;
    expect(fields).toEqual(
      expect.arrayContaining(["DATES", "CONDITIONS", "DEADLINES"]),
    );
  });
  it("retains identical recap occurrences without promoting a match to official product identity", async () => {
    const x = await sample();
    x.before.reading!.operations[0]!.items.push(
      clone(x.before.reading!.operations[0]!.items[0]!),
    );
    const r = compare(x);
    expect(r.differences[0]?.status).toBe("UNCHANGED");
    expect(r.differences[0]?.before).toHaveLength(2);
    expect(r.differences[0]?.before[0]?.identityBasis).toBe("EXACT_LABEL");
  });
  it("reports ambiguity for multiple price variants or missing literal identity", async () => {
    const x = await sample();
    const item = clone(x.before.reading!.operations[0]!.items[0]!);
    item.fields.find((f) => f.name === "sellingPrice")!.rawValue = "1,90€";
    x.before.reading!.operations[0]!.items.push(item);
    expect(compare(x).differences[0]?.status).toBe("AMBIGUOUS");
    for (const p of [x.before, x.after])
      p.reading!.operations[0]!.items.forEach(
        (i) => (i.fields = i.fields.filter((f) => f.name !== "productLabel")),
      );
    expect(compare(x).differences.every((d) => d.status === "AMBIGUOUS")).toBe(
      true,
    );
  });
  it("calls missing/new occurrences reading differences, never source deletion", async () => {
    const x = await sample();
    x.after.reading!.operations[0]!.items = [];
    expect(compare(x).differences[0]?.status).toBe("NOT_FOUND_IN_NEW");
    x.after.pageCount = 2;
    expect(compare(x).afterCoverage.complete).toBe(false);
    expect(compare(x).afterCoverage.ready).toBe(1);
  });
  it("does not borrow a display title as product identity or match different identifiers", async () => {
    const x = await sample();
    for (const [p, code] of [
      [x.before, "00004274"],
      [x.after, "00005274"],
    ] as const)
      p.reading!.operations[0]!.items[0]!.fields.push({
        name: "productIdentifier",
        rawValue: code,
        confidence: 1,
        evidence: [],
      });
    expect(
      compare(x)
        .differences.map((d) => d.status)
        .sort(),
    ).toEqual(["NEW_IN_READING", "NOT_FOUND_IN_NEW"].sort());
  });
  it("checks store/document boundaries and identifies identical binary originals", async () => {
    const x = await sample();
    x.after.checksum = x.before.checksum;
    expect(compare(x).sameBinary).toBe(true);
    x.after.storeId = uuid();
    expect(() => compare(x)).toThrow("STORE_SOURCE_INVALID");
  });
});
