import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type Document } from "mongodb";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { sourceOffersFixture } from "../../../scripts/test-source-offers-fixtures";
import { readCommercialDocumentComparison } from "../src/copilot/document-comparison-tool";
import { validateDocumentComparisonResult } from "@fl-copilot/domain";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)("commercial PDF comparison on disposable Mongo", () => {
  let client: MongoClient, db: Db;
  beforeAll(async () => {
    client = await MongoClient.connect(uri!);
    db = client.db(`fl_diff_${randomUUID().replaceAll("-", "").slice(0, 24)}`);
  });
  afterAll(async () => {
    try {
      await db?.dropDatabase();
    } finally {
      await client?.close();
    }
  });
  const collection = (name: string) =>
    db.collection<Document & { _id: string }>(name);
  async function fixture() {
    const { f } = await sourceOffersFixture();
    const before = structuredClone(f.reading),
      after = {
        ...structuredClone(f.reading),
        id: randomUUID(),
        sourceDocumentId: randomUUID(),
        checksum: "sha256:corrected",
      };
    for (const p of [before, after]) {
      const item = p.reading!.operations[0]!.items[0]!;
      item.fields.push({
        ...item.fields[0]!,
        name: "productLabel",
        rawValue: "RAISIN BLANC VRAC",
      });
    }
    after.reading!.operations[0]!.items[0]!.fields.find(
      (v) => v.name === "sellingPrice",
    )!.rawValue = "2,50€";
    for (const p of [before, after]) {
      await collection("sourceDocuments").insertOne({
        _id: p.sourceDocumentId,
        storeId: f.storeId,
        checksum: p.checksum,
        sourceType: "WEEKLY_COMMERCIAL_PDF",
        remoteUploadStatus: "CONFIRMED",
        deletedAt: null,
        originalFilename: p === before ? "S41-original.pdf" : "S41-corrige.pdf",
      });
      await collection("commercialVisualReadings").insertOne({
        ...p,
        _id: p.id,
        updatedAt: new Date(),
      });
    }
    return {
      f,
      before,
      after,
      input: {
        beforeDocumentId: before.sourceDocumentId,
        afterDocumentId: after.sourceDocumentId,
        businessDate: "2026-10-08",
        offset: 0,
        limit: 5,
      },
    };
  }
  it("uses canonical prices and exact source coordinates without changing choices or plans", async () => {
    const f = await fixture(),
      r = await readCommercialDocumentComparison(db, f.f.storeId, f.input);
    expect(validateDocumentComparisonResult(f.f.storeId, f.input, r)).toEqual(
      r,
    );
    expect(r.status).toBe("COMPARED");
    expect(r.counts?.CHANGED).toBe(1);
    expect(r.differences[0]?.changedFields).toContain("PRICE");
    expect(r.differences[0]?.before[0]).toMatchObject({
      readingId: f.before.id,
      sourceDocumentId: f.before.sourceDocumentId,
      pageNumber: 1,
      operationIndex: 0,
      itemIndex: 0,
      identityBasis: "EXACT_LABEL",
    });
    expect(
      r.evidence
        .filter((e) => e.id.startsWith("commercial-pdf-source/"))
        .map((e) => e.value),
    ).toEqual(["S41-original.pdf", "S41-corrige.pdf"]);
    for (const name of [
      "commercialOfferChoices",
      "commercialWeekPlans",
      "commercialVersionDecisions",
      "syncChanges",
    ])
      expect(
        await db.collection(name).countDocuments({ storeId: f.f.storeId }),
      ).toBe(0);
  });
  it("keeps out-of-week and unknown offers out of the comparison while preserving original indices", async () => {
    const f = await fixture();
    for (const p of [f.before, f.after]) {
      const op = structuredClone(p.reading!.operations[0]!),
        outside = {
          ...structuredClone(op),
          fields: op.fields.map((v) =>
            v.name === "saleStart"
              ? { ...v, rawValue: "2026-09-01" }
              : v.name === "saleEnd"
                ? { ...v, rawValue: "2026-09-03" }
                : v,
          ),
        },
        unknown = {
          ...structuredClone(op),
          fields: [],
          items: op.items.map((i) => ({ ...i, fields: [] })),
        };
      const current = {
        ...op,
        items: [{ ...op.items[0]!, kind: "INSTRUCTION" }, op.items[0]!],
      };
      await collection("commercialVisualReadings").updateOne(
        { _id: p.id },
        { $set: { "reading.operations": [outside, current, unknown] } },
      );
    }
    const r = await readCommercialDocumentComparison(db, f.f.storeId, f.input);
    expect(r.before?.period).toEqual({ included: 1, excluded: 1, unknown: 1 });
    expect(r.after?.period).toEqual({ included: 1, excluded: 1, unknown: 1 });
    expect(r.counts?.CHANGED).toBe(1);
    expect(r.differences[0]?.before[0]).toMatchObject({
      operationIndex: 1,
      itemIndex: 1,
    });
  });
  it("retains incomplete page coverage, warnings and unresolved identities instead of claiming removal", async () => {
    const f = await fixture();
    await collection("commercialVisualReadings").updateOne(
      { _id: f.after.id },
      {
        $set: {
          pageCount: 2,
          "reading.warnings": ["Prix visuel à vérifier"],
          "reading.operations.0.items.0.fields":
            f.after.reading!.operations[0]!.items[0]!.fields.filter(
              (v) => v.name !== "productLabel",
            ),
        },
      },
    );
    const r = await readCommercialDocumentComparison(db, f.f.storeId, f.input);
    expect(r.status).toBe("INCOMPLETE");
    expect(r.after?.coverage).toEqual({ complete: false, ready: 1, total: 2 });
    expect(r.after?.warningCount).toBe(1);
    expect(r.counts?.AMBIGUOUS).toBe(1);
    expect(
      r.evidence.some((e) => String(e.value).includes("Lecture partielle")),
    ).toBe(true);
  });
  it("isolates store and confirmed/current checksum sources and distinguishes no reading from no offers", async () => {
    const f = await fixture();
    expect(
      (await readCommercialDocumentComparison(db, randomUUID(), f.input))
        .status,
    ).toBe("UNAVAILABLE");
    await collection("sourceDocuments").updateOne(
      { _id: f.after.sourceDocumentId },
      { $set: { checksum: "sha256:another" } },
    );
    const r = await readCommercialDocumentComparison(db, f.f.storeId, f.input);
    expect(r.status).toBe("NOT_READY");
    expect(r.counts).toBeNull();
    await collection("sourceDocuments").updateOne(
      { _id: f.after.sourceDocumentId },
      { $set: { remoteUploadStatus: "PENDING" } },
    );
    expect(
      (await readCommercialDocumentComparison(db, f.f.storeId, f.input)).status,
    ).toBe("UNAVAILABLE");
  });
  it("does not call identical binary content a corrected version", async () => {
    const f = await fixture();
    await collection("sourceDocuments").updateOne(
      { _id: f.after.sourceDocumentId },
      { $set: { checksum: f.before.checksum } },
    );
    const r = await readCommercialDocumentComparison(db, f.f.storeId, f.input);
    expect(r.status).toBe("SAME_BINARY");
    expect(r.differences).toEqual([]);
    expect(r.counts).toBeNull();
  });
  it("paginates complete group counts and uses the newest reading per page", async () => {
    const f = await fixture();
    for (const p of [f.before, f.after]) {
      const op = p.reading!.operations[0]!,
        other = structuredClone(op.items[0]!);
      other.fields.find((v) => v.name === "productLabel")!.rawValue =
        "AUTRE PRODUIT";
      await collection("commercialVisualReadings").updateOne(
        { _id: p.id },
        {
          $set: {
            "reading.operations.0.items": [op.items[0]!, other],
            updatedAt: new Date("2026-10-11T12:00:00Z"),
          },
        },
      );
      await collection("commercialVisualReadings").insertOne({
        ...p,
        _id: randomUUID(),
        id: randomUUID(),
        updatedAt: new Date("2026-10-01T12:00:00Z"),
      });
    }
    const first = await readCommercialDocumentComparison(db, f.f.storeId, {
      ...f.input,
      limit: 1,
    });
    expect(first.differenceCount).toBe(2);
    expect(first.nextOffset).toBe(1);
    expect(first.differences).toHaveLength(1);
    const second = await readCommercialDocumentComparison(db, f.f.storeId, {
      ...f.input,
      limit: 1,
      offset: 1,
    });
    expect(second.nextOffset).toBeNull();
    expect(second.differences[0]?.key).not.toBe(first.differences[0]?.key);
  });
  it("fails closed on oversized pages or a whole oversized difference", async () => {
    const f = await fixture();
    const p = f.before;
    await collection("commercialVisualReadings").updateOne(
      { _id: p.id },
      {
        $set: {
          "reading.operations.0.items.0.fields": Array.from(
            { length: 30 },
            () => ({
              ...p.reading!.operations[0]!.items[0]!.fields[0]!,
              name: "supplierCondition",
              rawValue: "x".repeat(2000),
            }),
          ),
        },
      },
    );
    const r = await readCommercialDocumentComparison(db, f.f.storeId, f.input);
    expect(r.status).toBe("LIMIT_EXCEEDED");
    expect(r.differences).toEqual([]);
    expect(r.counts).toBeNull();
    await collection("commercialVisualReadings").deleteMany({
      sourceDocumentId: p.sourceDocumentId,
    });
    await collection("commercialVisualReadings").insertMany(
      Array.from({ length: 17 }, (_, i) => {
        const id = randomUUID();
        return {
          ...p,
          _id: id,
          id,
          pageNumber: i + 1,
          pageCount: 17,
          updatedAt: new Date(),
        };
      }),
    );
    expect(
      (await readCommercialDocumentComparison(db, f.f.storeId, f.input)).status,
    ).toBe("LIMIT_EXCEEDED");
  });
  it("keeps a failed newest page incomplete rather than silently reviving an older successful reading", async () => {
    const f = await fixture(),
      id = randomUUID();
    await collection("commercialVisualReadings").updateOne(
      { _id: f.after.id },
      { $set: { updatedAt: new Date("2026-10-01T12:00:00Z") } },
    );
    await collection("commercialVisualReadings").insertOne({
      ...f.after,
      id,
      _id: id,
      status: "FAILED",
      errorCode: "VISION_FAILED",
      reading: null,
      updatedAt: new Date("2026-10-11T12:00:00Z"),
    });
    const r = await readCommercialDocumentComparison(db, f.f.storeId, f.input);
    expect(r.status).toBe("INCOMPLETE");
    expect(r.after?.coverage).toEqual({ complete: false, ready: 0, total: 1 });
  });
});
