import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type Document } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commercialChoiceFixture } from "../../../scripts/test-commercial-choice-fixtures";
import { readCommercialChoice } from "../src/copilot/commercial-choice-tool";
import { runMongoMigrations } from "../src/database/migrations";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)("exact owned commercial choice inspection", () => {
  let client: MongoClient, db: Db;
  beforeAll(async () => {
    client = await MongoClient.connect(uri!);
    db = client.db(
      `fl_choice_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
    );
    await runMongoMigrations(db);
  });
  afterAll(async () => {
    try {
      await db?.dropDatabase();
    } finally {
      await client?.close();
    }
  });
  it("reads current retained and withdrawn terms outside a requested week without business writes", async () => {
    const f = await commercialChoiceFixture();
    await db
      .collection<Document & { _id: string }>("commercialOfferChoices")
      .insertOne({ _id: f.choice.id, duplicateKey: randomUUID(), ...f.choice });
    const input = { choiceId: f.choice.id };
    const first = await readCommercialChoice(db, f.choice.storeId, input);
    expect(first.choice).toEqual(f.choice);
    expect(first.evidence[0].value).toContain("ne prouve ni une validation");
    await db
      .collection("commercialOfferChoices")
      .updateOne({ _id: f.choice.id } as Document, {
        $set: { status: "WITHDRAWN", version: 2 },
      });
    const before = await db
      .collection("commercialOfferChoices")
      .findOne({ _id: f.choice.id } as Document);
    const withdrawn = await readCommercialChoice(db, f.choice.storeId, input);
    expect(withdrawn.choice).toMatchObject({
      status: "WITHDRAWN",
      version: 2,
      source: f.choice.source,
      mechanism: f.choice.mechanism,
    });
    expect(withdrawn.evidence[0].factKind).toBe("QUALITY");
    expect(withdrawn.evidence[0].id).not.toBe(first.evidence[0].id);
    expect(
      await db
        .collection("commercialOfferChoices")
        .findOne({ _id: f.choice.id } as Document),
    ).toEqual(before);
    for (const c of [
      "commercialChoiceHistory",
      "commercialWeekPreparations",
      "commercialWeekPlans",
      "commercialValidatedOffers",
      "syncChanges",
    ])
      expect(await db.collection(c).countDocuments({})).toBe(0);
  });
  it("does not disclose another store's choice and distinguishes unavailable synchronized data", async () => {
    const f = await commercialChoiceFixture();
    await db
      .collection<Document & { _id: string }>("commercialOfferChoices")
      .insertOne({ _id: f.choice.id, duplicateKey: randomUUID(), ...f.choice });
    for (const [storeId, choiceId] of [
      [randomUUID(), f.choice.id],
      [f.choice.storeId, randomUUID()],
    ]) {
      const r = await readCommercialChoice(db, storeId, { choiceId });
      expect(r.choice).toBeNull();
      expect(r.evidence[0].sourceId).toBe(storeId);
      expect(JSON.stringify(r.evidence)).not.toContain(
        f.choice.rawProductLabel,
      );
    }
    await expect(
      readCommercialChoice(db, f.choice.storeId, {
        choiceId: f.choice.id,
        storeId: randomUUID(),
      }),
    ).rejects.toThrow();
  });
});
