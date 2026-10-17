import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type Document } from "mongodb";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sourceOffersFixture } from "../../../scripts/test-source-offers-fixtures";
import { readSourceOffers } from "../src/copilot/source-offers-tool";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)(
  "exact source offer discovery on disposable Mongo",
  () => {
    let client: MongoClient, db: Db;
    beforeAll(async () => {
      client = await MongoClient.connect(uri!);
      db = client.db(
        `fl_sources_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
      );
    });
    afterAll(async () => {
      try {
        await db?.dropDatabase();
      } finally {
        await client?.close();
      }
    });
    async function seed() {
      const data = await sourceOffersFixture(),
        f = data.f;
      await db
        .collection<Document & { _id: string }>("sourceDocuments")
        .insertOne({
          _id: f.sourceDocumentId,
          storeId: f.storeId,
          checksum: f.reading.checksum,
          sourceType: "WEEKLY_COMMERCIAL_PDF",
          remoteUploadStatus: "CONFIRMED",
          deletedAt: null,
        });
      await db
        .collection<Document & { _id: string }>("commercialVisualReadings")
        .insertOne({ ...f.reading, _id: f.readingId, updatedAt: new Date() });
      return data;
    }
    it("preserves raw source indices after filtering, paginates complete offers and uses canonical proposal parsing without writes", async () => {
      const { f, input } = await seed(),
        op = f.reading.reading!.operations[0]!,
        item = op.items[0]!;
      const outside = {
        ...op,
        fields: op.fields.map((field) =>
          field.name === "saleStart"
            ? { ...field, rawValue: "2026-09-01" }
            : field.name === "saleEnd"
              ? { ...field, rawValue: "2026-09-03" }
              : field.name === "weekLabel"
                ? { ...field, rawValue: "S36" }
                : field,
        ),
        items: [{ ...item, fields: [] }],
      };
      const instruction = {
          ...item,
          kind: "INSTRUCTION",
          label: "Ne pas retenir une instruction",
        },
        unknown = { ...op, fields: [], items: [{ ...item, fields: [] }] };
      await db
        .collection<Document & { _id: string }>("commercialVisualReadings")
        .updateOne(
          { _id: f.readingId },
          {
            $set: {
              "reading.operations": [
                outside,
                {
                  ...op,
                  items: [instruction, item, { ...item, label: "Autre offre" }],
                },
                unknown,
              ],
            },
          },
        );
      const first = await readSourceOffers(db, f.storeId, {
        ...input,
        limit: 1,
      });
      expect(first.status).toBe("READY");
      expect(first.totalOffers).toBe(2);
      expect(first.excludedOffers).toBe(1);
      expect(first.unknownOffers).toBe(1);
      expect(first.nextOffset).toBe(1);
      expect(first.offers[0]).toMatchObject({
        source: { ...f.choice.source, operationIndex: 1, itemIndex: 1 },
        proposal: {
          saleStart: f.choice.saleStart,
          saleEnd: f.choice.saleEnd,
          mechanism: f.choice.mechanism,
        },
        validationStatus: "TO_VALIDATE",
      });
      expect(first.offers[0]!.itemFields[0]).toHaveProperty(
        "validationStatus",
        "TO_VALIDATE",
      );
      const second = await readSourceOffers(db, f.storeId, {
        ...input,
        offset: 1,
        limit: 1,
      });
      expect(second.offers[0]!.source.itemIndex).toBe(2);
      expect(second.nextOffset).toBeNull();
      expect(
        (await readSourceOffers(db, f.storeId, { ...input, offset: 5 })).offers,
      ).toEqual([]);
      expect(
        await db.collection("commercialOfferChoices").countDocuments(),
      ).toBe(0);
      expect(await db.collection("syncChanges").countDocuments()).toBe(0);
    });
    it("qualifies foreign/missing/unconfirmed sources, missing extraction, checksum changes and periods outside the request", async () => {
      const { f, input } = await seed();
      expect((await readSourceOffers(db, randomUUID(), input)).status).toBe(
        "UNAVAILABLE",
      );
      expect(
        (
          await readSourceOffers(db, f.storeId, {
            ...input,
            sourceDocumentId: randomUUID(),
          })
        ).status,
      ).toBe("UNAVAILABLE");
      expect(
        (await readSourceOffers(db, f.storeId, { ...input, pageNumber: 2 }))
          .status,
      ).toBe("NOT_READY");
      const outside = await readSourceOffers(db, f.storeId, {
        ...input,
        businessDate: "2026-11-01",
      });
      expect(outside.offers).toEqual([]);
      expect(outside.excludedOffers).toBe(1);
      await db
        .collection<Document & { _id: string }>("sourceDocuments")
        .updateOne(
          { _id: f.sourceDocumentId },
          { $set: { checksum: "changed" } },
        );
      expect((await readSourceOffers(db, f.storeId, input)).status).toBe(
        "NOT_READY",
      );
      await db
        .collection<Document & { _id: string }>("sourceDocuments")
        .updateOne(
          { _id: f.sourceDocumentId },
          { $set: { remoteUploadStatus: "PENDING" } },
        );
      expect((await readSourceOffers(db, f.storeId, input)).status).toBe(
        "UNAVAILABLE",
      );
    });
    it("never skips or truncates an oversized first offer, and explicitly qualifies omitted warning details", async () => {
      const { f, input } = await seed(),
        op = f.reading.reading!.operations[0]!,
        item = op.items[0]!,
        field = item.fields[0]!;
      await db
        .collection<Document & { _id: string }>("commercialVisualReadings")
        .updateOne(
          { _id: f.readingId },
          {
            $set: {
              "reading.operations": [
                {
                  ...op,
                  items: [
                    {
                      ...item,
                      fields: Array.from({ length: 30 }, () => ({
                        ...field,
                        rawValue: "é".repeat(2000),
                      })),
                    },
                    { ...item, label: "Offre suivante" },
                  ],
                },
              ],
            },
          },
        );
      const r = await readSourceOffers(db, f.storeId, input);
      expect(r.status).toBe("LIMIT_EXCEEDED");
      expect(r.offers).toEqual([]);
      expect(r.nextOffset).toBe(0);
      expect(r.totalOffers).toBe(2);
      expect(Buffer.byteLength(JSON.stringify(r))).toBeLessThanOrEqual(14000);
      await db
        .collection<Document & { _id: string }>("commercialVisualReadings")
        .updateOne(
          { _id: f.readingId },
          {
            $set: {
              "reading.operations": [op],
              "reading.warnings": Array.from({ length: 30 }, () =>
                "é".repeat(400),
              ),
            },
          },
        );
      const warnings = await readSourceOffers(db, f.storeId, input);
      expect(warnings.status).toBe("LIMIT_EXCEEDED");
      expect(warnings.warningCount).toBe(30);
      expect(warnings.warningsComplete).toBe(false);
      expect(warnings.warnings).toEqual([]);
      expect(Buffer.byteLength(JSON.stringify(warnings))).toBeLessThanOrEqual(
        14000,
      );
    });
  },
);
