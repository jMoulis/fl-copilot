import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it, expect } from "vitest";
import {
  commercialChoiceFixture,
  testChoiceDigest,
} from "../../../../scripts/test-commercial-choice-fixtures";
import { commercialOfferValidationCurrent } from "@fl-copilot/commercial-core";
import { runLocalMigrations } from "../db/migrations";
import { ProductMasterRepository } from "../products/product-master-repository";
import { applyCommercialChoice } from "./offer-choice-repository";
import { applyCommercialVisualReading } from "./visual-repository";
import {
  ValidatedOfferRepository,
  readValidatedOffers,
  applyValidatedOffer,
} from "./validated-offer-repository";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import { applyPullPage } from "../sync/apply-pull-page";
class Adapter implements OutboxDatabase {
  fail = false;
  constructor(readonly db: DatabaseSync) {}
  async execAsync(s: string) {
    this.db.exec(s);
  }
  async runAsync(s: string, ...p: Array<string | number | null>) {
    return this.db.prepare(s).run(...p);
  }
  async getFirstAsync<T>(s: string, ...p: Array<string | number | null>) {
    return (this.db.prepare(s).get(...p) as T) ?? null;
  }
  async getAllAsync<T>(s: string, ...p: Array<string | number | null>) {
    return this.db.prepare(s).all(...p) as T[];
  }
  async withExclusiveTransactionAsync(
    task: (tx: OutboxDatabase) => Promise<void>,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      await task(this);
      if (this.fail) throw Error("COMMIT_FAILED");
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
const dirs: string[] = [],
  dbs: DatabaseSync[] = [];
afterEach(() => {
  for (const d of dbs.splice(0))
    try {
      d.close();
    } catch {
      /* restart test already closed this connection */
    }
  for (const p of dirs.splice(0)) rmSync(p, { recursive: true, force: true });
});

async function setup() {
  const f = await commercialChoiceFixture(),
    dir = mkdtempSync(join(tmpdir(), "fl-validated-offer-"));
  dirs.push(dir);
  const path = join(dir, "local.db"),
    db = new DatabaseSync(path);
  dbs.push(db);
  const tx = new Adapter(db);
  await runLocalMigrations(tx);
  await applyCommercialVisualReading(tx, f.storeId, f.reading);
  await new ProductMasterRepository(tx).upsertProduct(f.product, {
    commandId: randomUUID(),
    deviceId: randomUUID(),
  });
  db.exec("UPDATE sync_outbox SET status='ACKNOWLEDGED'");
  await applyCommercialChoice(tx, f.storeId, f.choice);
  return {
    ...f,
    db,
    tx,
    path,
    repo: new ValidatedOfferRepository(tx, testChoiceDigest),
    ctx: {
      deviceId: randomUUID(),
      commandIds: [randomUUID()],
      createdAt: f.choice.createdAt,
    },
    selection: [{ choiceId: f.choice.id, choiceVersion: 1 }],
  };
}
it("validates the selected offer offline once with audit/outbox and preserves source, choices and KPIs through restart", async () => {
  const x = await setup();
  const snapshot = () =>
    JSON.stringify(
      [
        "commercial_visual_readings",
        "commercial_offer_choices",
        "commercial_week_preparations",
        "sales_observations",
        "waste_observations",
      ].map((t) => x.db.prepare(`SELECT * FROM ${t}`).all()),
    );
  const before = snapshot();
  await x.repo.validate(x.storeId, x.selection, x.ctx);
  await x.repo.validate(x.storeId, x.selection, {
    ...x.ctx,
    commandIds: [randomUUID()],
  });
  expect(await new OutboxRepository(x.tx).listPending(x.storeId)).toHaveLength(
    1,
  );
  expect(
    x.db
      .prepare("SELECT COUNT(*) n FROM commercial_offer_validation_history")
      .get()?.n,
  ).toBe(1);
  expect(snapshot()).toBe(before);
  x.db.close();
  const db = new DatabaseSync(x.path);
  dbs.push(db);
  expect(
    (await readValidatedOffers(new Adapter(db), x.storeId))[0],
  ).toMatchObject({
    syncState: "PENDING",
    entity: { choice: { version: 1 }, status: "VALIDATED" },
  });
});
it("rolls back the whole selected batch when one offer or commit is invalid", async () => {
  const x = await setup();
  await expect(
    x.repo.validate(
      x.storeId,
      [...x.selection, { choiceId: randomUUID(), choiceVersion: 1 }],
      { ...x.ctx, commandIds: [randomUUID(), randomUUID()] },
    ),
  ).rejects.toThrow("CHOICE_CHANGED");
  expect(await readValidatedOffers(x.tx, x.storeId)).toEqual([]);
  x.tx.fail = true;
  await expect(x.repo.validate(x.storeId, x.selection, x.ctx)).rejects.toThrow(
    "COMMIT_FAILED",
  );
  expect(await readValidatedOffers(x.tx, x.storeId)).toEqual([]);
  expect(
    x.db
      .prepare("SELECT COUNT(*) n FROM commercial_offer_validation_history")
      .get()?.n,
  ).toBe(0);
});
it("preserves historic validation after an offer changes/withdraws and requires a new revision to validate again", async () => {
  const x = await setup();
  await x.repo.validate(x.storeId, x.selection, x.ctx);
  const old = (await readValidatedOffers(x.tx, x.storeId))[0]!.entity;
  await applyValidatedOffer(x.tx, x.storeId, old);
  const next = {
    ...x.choice,
    version: 2,
    mechanism: {
      type: "PRICE_CEILING" as const,
      currency: "EUR" as const,
      unit: "KG" as const,
      operator: "LESS_THAN" as const,
      amount: 2,
    },
  };
  await applyCommercialChoice(x.tx, x.storeId, next);
  expect(commercialOfferValidationCurrent(old, next)).toBe(false);
  await expect(
    x.repo.validate(x.storeId, x.selection, {
      ...x.ctx,
      commandIds: [randomUUID()],
    }),
  ).rejects.toThrow("CHOICE_CHANGED");
  await x.repo.validate(
    x.storeId,
    [{ choiceId: x.choice.id, choiceVersion: 2 }],
    { ...x.ctx, commandIds: [randomUUID()] },
  );
  expect(await readValidatedOffers(x.tx, x.storeId)).toHaveLength(2);
  await applyCommercialChoice(x.tx, x.storeId, {
    ...next,
    version: 3,
    status: "WITHDRAWN",
  });
  expect(
    (await readValidatedOffers(x.tx, x.storeId)).some((v) =>
      commercialOfferValidationCurrent(v.entity, {
        ...next,
        version: 3,
        status: "WITHDRAWN",
      }),
    ),
  ).toBe(false);
});
it("rejects inactive products and tenant/source tampering without publishing", async () => {
  const x = await setup();
  await expect(
    x.repo.validate(randomUUID(), x.selection, x.ctx),
  ).rejects.toThrow("CHOICE_CHANGED");
  x.db
    .prepare("UPDATE products SET status='ARCHIVED' WHERE id=?")
    .run(x.productId);
  await expect(x.repo.validate(x.storeId, x.selection, x.ctx)).rejects.toThrow(
    "PRODUCT_INVALID",
  );
  expect(await readValidatedOffers(x.tx, x.storeId)).toEqual([]);
});
it("restores immutable validations, rejects malformed pull envelopes and never overwrites a newer choice", async () => {
  const x = await setup();
  await x.repo.validate(x.storeId, x.selection, x.ctx);
  const v = (await readValidatedOffers(x.tx, x.storeId))[0]!.entity;
  await expect(applyValidatedOffer(x.tx, randomUUID(), v)).rejects.toThrow(
    "STORE_INVALID",
  );
  await expect(
    applyValidatedOffer(x.tx, x.storeId, { ...v, sourceFields: [] }),
  ).rejects.toThrow("IMMUTABLE");
  await expect(
    applyPullPage(x.tx, x.storeId, {
      changes: [
        {
          sequence: "1",
          entityType: "commercial_validated_offer",
          entityId: randomUUID(),
          entityVersion: 1,
          operation: "UPSERT",
          entity: v,
          changedAt: v.createdAt,
        },
      ],
      nextCursor: "bad",
      hasMore: false,
      serverTime: v.createdAt,
    }),
  ).rejects.toThrow("ENVELOPE_INVALID");
  await applyCommercialChoice(x.tx, x.storeId, { ...x.choice, version: 2 });
  await applyValidatedOffer(x.tx, x.storeId, {
    ...v,
    createdAt: new Date().toISOString(),
  });
  expect(
    x.db
      .prepare("SELECT payload_json FROM commercial_offer_choices WHERE id=?")
      .get(x.choice.id)?.payload_json,
  ).toContain('"version":2');
});

it("retries a refused immutable validation explicitly while retaining audit and excluding the superseded failure from active errors", async () => {
  const x = await setup();
  await x.repo.validate(x.storeId, x.selection, x.ctx);
  const cmd = (await new OutboxRepository(x.tx).listPending(x.storeId))[0]!;
  await new OutboxRepository(x.tx).markSyncing(cmd.commandId);
  await new OutboxRepository(x.tx).markFailed(
    cmd.commandId,
    "COMMERCIAL_VALIDATION_PRODUCT_INVALID",
  );
  x.db
    .prepare("UPDATE commercial_validated_offers SET sync_state='ERROR'")
    .run();
  expect(
    (await new OutboxRepository(x.tx).countActive(x.storeId)).failed_count,
  ).toBe(1);
  await x.repo.validate(x.storeId, x.selection, {
    ...x.ctx,
    commandIds: [randomUUID()],
  });
  expect(await new OutboxRepository(x.tx).countActive(x.storeId)).toEqual({
    pending_count: 1,
    failed_count: 0,
  });
  expect(
    x.db
      .prepare("SELECT COUNT(*) n FROM commercial_offer_validation_history")
      .get()?.n,
  ).toBe(2);
  expect(await new OutboxRepository(x.tx).countActive(randomUUID())).toEqual({
    pending_count: 0,
    failed_count: 0,
  });
});
it("does not require completing product category/nature/unit to validate reviewed offer terms", async () => {
  const x = await setup();
  x.db
    .prepare(
      "UPDATE products SET category='UNKNOWN',nature='UNKNOWN',sales_unit='UNKNOWN' WHERE id=?",
    )
    .run(x.productId);
  await x.repo.validate(x.storeId, x.selection, x.ctx);
  expect(await readValidatedOffers(x.tx, x.storeId)).toHaveLength(1);
  expect(
    x.db.prepare("SELECT nature FROM products WHERE id=?").get(x.productId)
      ?.nature,
  ).toBe("UNKNOWN");
});
