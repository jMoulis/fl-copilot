import { mercalysWorkbook } from "../../../../scripts/test-mercalys-sync-fixtures";
import { MercalysImportPublicationRepository } from "./mercalys-import-publication";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { runLocalMigrations } from "../db/migrations";
import { joinedMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { ProductMasterRepository } from "../products/product-master-repository";
import {
  emptyProductDraft,
  saveProductEditor,
} from "../products/product-editor-service";
import {
  readCatalogueCleanup,
  setCatalogueArchived,
} from "../products/catalogue-cleanup";
import {
  prepareMercalysProductMatcher,
  type ProductMatchCatalog,
} from "@fl-copilot/domain";
import {
  MercalysConfirmationSession,
  commitMercalysResolution,
} from "./mercalys-confirmation-session";
import { MercalysBatchRepository } from "./mercalys-batch-repository";
import type { MercalysProductResolution } from "./mercalys-product-resolution";

class Db {
  sql = new DatabaseSync(":memory:");
  async execAsync(s: string) {
    this.sql.exec(s);
  }
  async getFirstAsync<T>(s: string, ...p: (string | number | null)[]) {
    return (this.sql.prepare(s).get(...p) as T) ?? null;
  }
  async getAllAsync<T>(s: string, ...p: (string | number | null)[]) {
    return this.sql.prepare(s).all(...p) as T[];
  }
  async runAsync(s: string, ...p: (string | number | null)[]) {
    return this.sql.prepare(s).run(...p);
  }
  async withExclusiveTransactionAsync(
    task: (tx: OutboxDatabase) => Promise<void>,
  ) {
    this.sql.exec("BEGIN");
    try {
      await task(this);
      this.sql.exec("COMMIT");
    } catch (e) {
      this.sql.exec("ROLLBACK");
      throw e;
    }
  }
}
const databases: Db[] = [];
afterEach(() => databases.splice(0).forEach((d) => d.sql.close()));
const storeId = randomUUID(),
  ownerId = randomUUID(),
  deviceId = randomUUID(),
  now = () => "2026-11-19T08:00:00.000Z";
const options = { storeId, deviceId, now, generateId: randomUUID };
async function setup() {
  const db = new Db();
  databases.push(db);
  await runLocalMigrations(db);
  await db.runAsync(
    "INSERT INTO app_metadata(key,value,updated_at) VALUES('device_id',?,?)",
    deviceId,
    now(),
  );
  return db;
}
async function catalog(db: Db): Promise<ProductMatchCatalog> {
  const r = new ProductMasterRepository(db);
  return {
    products: (await r.listProducts(storeId)).map((r) => r.entity),
    identifiers: (await r.listIdentifiersByStore(storeId)).map((r) => r.entity),
    aliases: (await r.listAliasesByStore(storeId)).map((r) => r.entity),
  };
}
function resolution(code: string): MercalysProductResolution {
  return {
    key: `ITM8:${code}`,
    label: "TOMATE VRAC",
    identifiers: [{ type: "ITM8", value: code }],
    sourceIndexes: [1],
    candidateProductIds: [],
    canCreate: true,
    canCreateAsDistinct: true,
  };
}
async function product(db: Db, code: string) {
  let id = "";
  await db.withExclusiveTransactionAsync(async (tx) => {
    id = await saveProductEditor(
      new ProductMasterRepository(joinedMutationDatabase(tx)),
      {
        ...emptyProductDraft,
        label: "TOMATE VRAC",
        identifiers: [{ type: "ITM8", value: code }],
      },
      options,
    );
  });
  return id;
}

it("persists a pending session across instances and blocks batch publication until explicitly finished", async () => {
  const db = await setup(),
    session = new MercalysConfirmationSession(db, storeId, ownerId, "hash");
  expect(await session.pending()).toBe(false);
  await session.begin();
  expect(
    await new MercalysConfirmationSession(
      db,
      storeId,
      ownerId,
      "hash",
    ).pending(),
  ).toBe(true);
  const batches = new MercalysBatchRepository(db, { storeId, ownerId });
  await expect(batches.assertConfirmationsFinished("hash")).rejects.toThrow(
    "MERCALYS_CONFIRMATIONS_PENDING",
  );
  expect(
    await new MercalysConfirmationSession(
      db,
      storeId,
      randomUUID(),
      "hash",
    ).pending(),
  ).toBe(false);
  await session.finish();
  await batches.assertConfirmationsFinished("hash");
});
it("creates distinct codes despite identical labels, preserves sequential decisions, and rejects stale retries without duplicate Outbox", async () => {
  const db = await setup();
  await product(db, "0000");
  let c = await catalog(db);
  await commitMercalysResolution(db, resolution("0001"), null, c, options);
  const count = db.sql.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get()!
    .n;
  await expect(
    commitMercalysResolution(db, resolution("0001"), null, c, options),
  ).rejects.toThrow();
  expect(db.sql.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get()!.n).toBe(
    count,
  );
  c = await catalog(db);
  await commitMercalysResolution(db, resolution("0002"), null, c, options);
  const after = await catalog(db);
  expect(after.products).toHaveLength(3);
  for (const code of ["0000", "0001", "0002"])
    expect(
      prepareMercalysProductMatcher(
        storeId,
        after,
      )({
        storeId,
        identifiers: [{ type: "ITM8", value: code }],
        label: "TOMATE VRAC",
      }).state,
    ).toBe("AUTO_MATCH");
});
it("records explicit association atomically and rejects an archived target", async () => {
  const db = await setup(),
    id = await product(db, "0000"),
    before = await catalog(db);
  await commitMercalysResolution(db, resolution("0001"), id, before, options);
  const after = await catalog(db);
  expect(after.products).toHaveLength(1);
  expect(after.identifiers.map((i) => i.value)).toContain("0001");
  const snap = await readCatalogueCleanup(db, storeId, "2026-11-19");
  await setCatalogueArchived(db, snap.items, true, {
    storeId,
    deviceId,
    now,
    id: randomUUID,
    assertCurrent() {},
  });
  await expect(
    commitMercalysResolution(db, resolution("0002"), id, after, options),
  ).rejects.toThrow();
  expect((await catalog(db)).identifiers.map((i) => i.value)).not.toContain(
    "0002",
  );
});
it("validates an existing unconfirmed code only after explicit association", async () => {
  const db = await setup();
  const id = await product(db, "0000");
  db.sql.exec("UPDATE product_identifiers SET status='TO_REVIEW'");
  const before = await catalog(db);
  const request = { storeId, identifiers: resolution("0000").identifiers };
  expect(prepareMercalysProductMatcher(storeId, before)(request).state).toBe(
    "AMBIGUOUS",
  );
  const count = db.sql.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get()!
    .n;
  await commitMercalysResolution(db, resolution("0000"), id, before, options);
  const after = await catalog(db);
  expect(after.identifiers).toHaveLength(1);
  expect(after.identifiers[0]?.version).toBe(2);
  expect(prepareMercalysProductMatcher(storeId, after)(request).state).toBe(
    "AUTO_MATCH",
  );
  expect(db.sql.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get()!.n).toBe(
    Number(count) + 1,
  );
});
it("archives and restores explicitly without deleting codes or prices; absent sales remain unknown", async () => {
  const db = await setup();
  const id = await product(db, "0000");
  const snap = await readCatalogueCleanup(db, storeId, "2026-11-19");
  expect(snap.coverage?.days).toBe(0);
  expect(snap.items[0]?.lastSale).toBeNull();
  await expect(
    setCatalogueArchived(db, snap.items, true, {
      storeId,
      deviceId,
      now,
      id: randomUUID,
      assertCurrent() {
        throw Error("NO_PERMISSION");
      },
    }),
  ).rejects.toThrow("NO_PERMISSION");
  expect((await catalog(db)).products[0]?.status).toBe("ACTIVE");
  await setCatalogueArchived(db, snap.items, true, {
    storeId,
    deviceId,
    now,
    id: randomUUID,
    assertCurrent() {},
  });
  const archived = await catalog(db);
  expect(archived.products[0]?.status).toBe("INACTIVE");
  expect(archived.identifiers).toHaveLength(1);
  expect(
    prepareMercalysProductMatcher(
      storeId,
      archived,
    )({ storeId, identifiers: [{ type: "ITM8", value: "0000" }] }).state,
  ).toBe("AMBIGUOUS");
  await expect(
    setCatalogueArchived(db, snap.items, false, {
      storeId,
      deviceId,
      now,
      id: randomUUID,
      assertCurrent() {},
    }),
  ).rejects.toThrow("CATALOGUE_CLEANUP_CHANGED");
  const current = await readCatalogueCleanup(db, storeId, "2026-11-19");
  await setCatalogueArchived(db, current.items, false, {
    storeId,
    deviceId,
    now,
    id: randomUUID,
    assertCurrent() {},
  });
  expect((await catalog(db)).products[0]).toMatchObject({
    id,
    status: "ACTIVE",
  });
});

it("uses real observed sales and published PA coverage, preserves observations through archival, and detects new sales before archival", async () => {
  const db = await setup(),
    id = await product(db, "00000001");
  const publication = new MercalysImportPublicationRepository(
    db,
    randomUUID,
    now,
  );
  await publication.publish(
    mercalysWorkbook(storeId, id, "MERCALYS_SALES", "2026-01-01", 12.4, false)
      .input,
  );
  await publication.publish(
    mercalysWorkbook(
      storeId,
      id,
      "MERCALYS_PURCHASE_PRICES",
      "2026-11-18",
      2,
      false,
    ).input,
  );
  const before = await readCatalogueCleanup(db, storeId, "2026-11-19");
  expect(before.coverage).toMatchObject({
    days: 1,
    first_date: "2026-01-01",
    last_date: "2026-01-01",
  });
  expect(before.items[0]).toMatchObject({
    lastSale: "2026-01-01",
    lastPrice: "2026-11-18",
    inLatestPrice: true,
  });
  const rows = () => [
    db.sql.prepare("SELECT * FROM sales_observations").all(),
    db.sql.prepare("SELECT * FROM purchase_price_observations").all(),
  ];
  const original = rows();
  const ctx = { storeId, deviceId, now, id: randomUUID, assertCurrent() {} };
  await setCatalogueArchived(db, before.items, true, ctx);
  expect(rows()).toEqual(original);
  await setCatalogueArchived(
    db,
    (await readCatalogueCleanup(db, storeId, "2026-11-19")).items,
    false,
    ctx,
  );
  const stale = await readCatalogueCleanup(db, storeId, "2026-11-19");
  await publication.publish(
    mercalysWorkbook(storeId, id, "MERCALYS_SALES", "2026-11-19", 5, false)
      .input,
  );
  await expect(
    setCatalogueArchived(db, stale.items, true, ctx),
  ).rejects.toThrow("CATALOGUE_CLEANUP_ACTIVITY_CHANGED");
  expect((await catalog(db)).products[0]?.status).toBe("ACTIVE");
});

it("rolls back an identity decision and all its Outbox commands if authority disappears at commit", async () => {
  const db = await setup();
  let checks = 0;
  await expect(
    commitMercalysResolution(db, resolution("0001"), null, await catalog(db), {
      ...options,
      assertCurrent() {
        if (++checks === 2) throw Error("REVOKED");
      },
    }),
  ).rejects.toThrow("REVOKED");
  expect((await catalog(db)).products).toHaveLength(0);
  expect(db.sql.prepare("SELECT COUNT(*) n FROM sync_outbox").get()!.n).toBe(0);
});
