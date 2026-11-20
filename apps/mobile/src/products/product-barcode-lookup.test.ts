import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { runLocalMigrations } from "../db/migrations";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { ProductMasterRepository } from "./product-master-repository";
import {
  barcodeLookupCodes,
  lookupProductBarcode,
} from "./product-barcode-lookup";

const storeId = randomUUID(),
  otherStore = randomUUID(),
  deviceId = randomUUID();
const at = "2026-11-20T10:00:00.000Z";
let db: DatabaseSync;
let repository: ProductMasterRepository;
beforeEach(async () => {
  db = new DatabaseSync(":memory:");
  const adapter = {
    execAsync: async (sql: string) => {
      db.exec(sql);
    },
    getFirstAsync: async <T>(
      sql: string,
      ...args: (string | number | null)[]
    ) => (db.prepare(sql).get(...args) as T | undefined) ?? null,
    getAllAsync: async <T>(sql: string, ...args: (string | number | null)[]) =>
      db.prepare(sql).all(...args) as T[],
    runAsync: async (sql: string, ...args: (string | number | null)[]) =>
      db.prepare(sql).run(...args),
    withExclusiveTransactionAsync: async (
      work: (tx: OutboxDatabase) => Promise<void>,
    ) => {
      db.exec("BEGIN");
      try {
        await work(adapter);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
  await runLocalMigrations(adapter);
  repository = new ProductMasterRepository(adapter);
});
afterEach(() => db.close());

async function product(
  code: string,
  options: {
    store?: string;
    validated?: boolean;
    active?: boolean;
    type?: "ITM8" | "EAN";
  } = {},
) {
  const id = randomUUID(),
    store = options.store ?? storeId;
  await repository.upsertProduct(
    {
      id,
      storeId: store,
      label: "Banane bio",
      category: "FRUIT",
      nature: "PACKAGED",
      salesUnit: "PIECE",
      packaging: null,
      familyId: null,
      subfamilyId: null,
      status: options.active === false ? "INACTIVE" : "ACTIVE",
      version: 1,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    },
    { commandId: randomUUID(), deviceId },
  );
  await repository.upsertIdentifier(
    {
      id: randomUUID(),
      storeId: store,
      productId: id,
      type: options.type ?? "EAN",
      value: code,
      source: "MERCALYS",
      status: options.validated === false ? "TO_REVIEW" : "VALIDATED",
      version: 1,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    },
    { commandId: randomUUID(), deviceId },
  );
  return id;
}

it("finds the exact local EAN independently of labels and leaves all data/Outbox unchanged", async () => {
  const id = await product("3250393062582");
  await product("8720165700066");
  const before = db.prepare("SELECT total_changes() n").get();
  expect(
    await lookupProductBarcode(repository, storeId, "3250393062582"),
  ).toEqual({ status: "FOUND", productId: id });
  expect(db.prepare("SELECT total_changes() n").get()).toEqual(before);
  expect(await lookupProductBarcode(repository, storeId, "03930625")).toEqual({
    status: "UNKNOWN",
  });
});

it("does not resolve a same-label product, an ITM8, another store or a deleted code", async () => {
  await product("3250393062582", { store: otherStore });
  await product("12345678", { type: "ITM8" });
  await product("8720165700066");
  db.prepare("UPDATE product_identifiers SET deleted_at=? WHERE value=?").run(
    at,
    "8720165700066",
  );
  for (const code of ["3250393062582", "12345678", "8720165700066"])
    expect(await lookupProductBarcode(repository, storeId, code)).toEqual({
      status: "UNKNOWN",
    });
});

it("keeps multiple owners ambiguous and requires validated identifiers", async () => {
  await product("3250393062582");
  await product("3250393062582");
  expect(
    await lookupProductBarcode(repository, storeId, "3250393062582"),
  ).toEqual({ status: "AMBIGUOUS" });
  await product("8720165700066", { validated: false });
  expect(
    await lookupProductBarcode(repository, storeId, "8720165700066"),
  ).toEqual({ status: "UNVALIDATED" });
});

it("allows reading an inactive reference without reactivating it", async () => {
  const id = await product("3250393062582", { active: false });
  expect(
    await lookupProductBarcode(repository, storeId, "3250393062582"),
  ).toEqual({ status: "FOUND", productId: id });
  expect((await repository.getProduct(id))?.entity.status).toBe("INACTIVE");
});

it("supports UPC-A/EAN-13 equivalence without arbitrary zero stripping or weight/price decoding", async () => {
  const id = await product("0036000291452");
  expect(
    await lookupProductBarcode(repository, storeId, "036000291452"),
  ).toEqual({ status: "FOUND", productId: id });
  expect(barcodeLookupCodes("0000000040300")).toEqual([
    "0000000040300",
    "000000040300",
  ]);
  expect(barcodeLookupCodes("2800363123456")).toEqual(["2800363123456"]);
  expect(barcodeLookupCodes("abc")).toEqual([]);
  expect(
    await lookupProductBarcode(repository, storeId, "https://example.com"),
  ).toEqual({ status: "INVALID" });
});
