import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type Document } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commercialPlanFixture } from "../../../scripts/test-commercial-plan-fixtures";
import { readCommercialPreparation } from "../src/copilot/commercial-preparation-tool";
import { validatePreparationReadResult } from "@fl-copilot/domain";
import { runMongoMigrations } from "../src/database/migrations";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)("commercial preparation context on Mongo", () => {
  let client: MongoClient, db: Db;
  beforeAll(async () => {
    client = await MongoClient.connect(uri!);
    db = client.db(`fl_prep_${randomUUID().replaceAll("-", "").slice(0, 24)}`);
    await runMongoMigrations(db);
  });
  afterAll(async () => {
    try {
      await db?.dropDatabase();
    } finally {
      await client?.close();
    }
  });
  async function fixture() {
    const f = await commercialPlanFixture();
    await db
      .collection<Document & { _id: string }>("commercialWeekPreparations")
      .insertOne({ _id: f.preparation.id, ...f.preparation });
    await db
      .collection<Document & { _id: string }>("commercialOfferChoices")
      .insertOne({ _id: f.choice.id, duplicateKey: randomUUID(), ...f.choice });
    return f;
  }
  const input = { weekStart: "2026-10-05", offset: 0, limit: 10 };
  it("reads the real draft, selected offer and TG without writing a plan, validation or history", async () => {
    const f = await fixture();
    const before = await db
      .collection("commercialWeekPreparations")
      .findOne({ _id: f.preparation.id } as Document);
    const r = await readCommercialPreparation(db, f.storeId, input);
    expect(validatePreparationReadResult(f.storeId, input, r)).toEqual(r);
    expect(r.status).toBe("DRAFT");
    expect(r.preparation).toEqual(f.preparation);
    expect(r.choices).toEqual([f.choice]);
    expect(r.issues).toEqual([]);
    expect(
      r.evidence.some(
        (e) =>
          e.label === "TG entrée" &&
          String(e.value).includes(f.choice.rawProductLabel),
      ),
    ).toBe(true);
    expect(
      await db
        .collection("commercialWeekPreparations")
        .findOne({ _id: f.preparation.id } as Document),
    ).toEqual(before);
    expect(
      await db
        .collection("commercialWeekPlans")
        .countDocuments({ storeId: f.storeId }),
    ).toBe(0);
    expect(
      await db
        .collection("commercialValidatedOffers")
        .countDocuments({ storeId: f.storeId }),
    ).toBe(0);
    expect(
      await db.collection("syncChanges").countDocuments({ storeId: f.storeId }),
    ).toBe(0);
  });
  it("keeps absent drafts distinct from empty preparations and isolates other stores and weeks", async () => {
    const f = await fixture();
    for (const [storeId, weekStart] of [
      [randomUUID(), input.weekStart],
      [f.storeId, "2026-10-12"],
    ]) {
      const r = await readCommercialPreparation(db, storeId, {
        ...input,
        weekStart,
      });
      expect(r.status).toBe("NO_DRAFT");
      expect(r.preparation).toBeNull();
      expect(r.choices).toEqual([]);
    }
  });
  it("detects changed, withdrawn and out-of-week choices with shared canonical rules", async () => {
    const f = await fixture();
    for (const [patch, code] of [
      [{ version: 2 }, "CHANGED"],
      [{ status: "WITHDRAWN" }, "WITHDRAWN"],
      [{ saleStart: "2026-10-12", saleEnd: "2026-10-13" }, "OUTSIDE_WEEK"],
    ] as const) {
      await db
        .collection("commercialOfferChoices")
        .updateOne({ _id: f.choice.id } as Document, {
          $set: { ...f.choice, ...patch },
        });
      const r = await readCommercialPreparation(db, f.storeId, input);
      expect(r.issues).toEqual([{ choiceId: f.choice.id, code }]);
      expect(r.preparation?.offerRefs[0].choiceVersion).toBe(1);
    }
  });
  it("does not resolve a missing selected offer from a foreign store", async () => {
    const f = await fixture();
    await db
      .collection("commercialOfferChoices")
      .updateOne({ _id: f.choice.id } as Document, {
        $set: { storeId: randomUUID() },
      });
    const r = await readCommercialPreparation(db, f.storeId, input);
    expect(r.missingChoiceIds).toEqual([f.choice.id]);
    expect(r.choices).toEqual([]);
    expect(r.issues).toEqual([{ choiceId: f.choice.id, code: "MISSING" }]);
  });
  it("paginates by draft reference order while checking every selected choice", async () => {
    const f = await fixture(),
      other = {
        ...f.choice,
        id: randomUUID(),
        source: { ...f.choice.source, itemIndex: 1 },
        status: "WITHDRAWN",
      };
    await db
      .collection<Document & { _id: string }>("commercialOfferChoices")
      .insertOne({ _id: other.id, duplicateKey: randomUUID(), ...other });
    await db.collection("commercialWeekPreparations").updateOne(
      { _id: f.preparation.id } as Document,
      {
        $push: { offerRefs: { choiceId: other.id, choiceVersion: 1 } },
      } as Document,
    );
    const r = await readCommercialPreparation(db, f.storeId, {
      ...input,
      limit: 1,
    });
    expect(r.choices.map((c) => c.id)).toEqual([f.choice.id]);
    expect(r.nextOffset).toBe(1);
    expect(r.issues).toEqual([{ choiceId: other.id, code: "WITHDRAWN" }]);
    const last = await readCommercialPreparation(db, f.storeId, {
      ...input,
      offset: 1,
      limit: 1,
    });
    expect(last.choices.map((c) => c.id)).toEqual([other.id]);
    expect(last.nextOffset).toBeNull();
    expect(
      validatePreparationReadResult(
        f.storeId,
        { ...input, offset: 1, limit: 1 },
        last,
      ),
    ).toEqual(last);
  });
  it("preserves unknown capacity and rejects malformed weeks or stored identity", async () => {
    const f = await fixture();
    await db
      .collection("commercialWeekPreparations")
      .updateOne({ _id: f.preparation.id } as Document, {
        $set: { placements: [], tgCapacity: null },
      });
    expect(
      (await readCommercialPreparation(db, f.storeId, input)).preparation
        ?.tgCapacity,
    ).toBeNull();
    await expect(
      readCommercialPreparation(db, f.storeId, {
        ...input,
        weekStart: "2026-10-06",
      }),
    ).rejects.toThrow();
    await db
      .collection("commercialWeekPreparations")
      .updateOne({ _id: f.preparation.id } as Document, {
        $set: { id: randomUUID() },
      });
    await expect(
      readCommercialPreparation(db, f.storeId, input),
    ).rejects.toThrow("SCOPE_INVALID");
  });
});
