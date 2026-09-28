import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { runLocalMigrations } from "../db/migrations";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { ProductMasterRepository } from "./product-master-repository";

type SQLiteValue = string | number | null;

class NodeDatabase implements OutboxDatabase, AtomicMutationDatabase {
  constructor(readonly database: DatabaseSync) {}
  async execAsync(sql: string) {
    this.database.exec(sql);
  }
  async getFirstAsync<T>(sql: string, ...params: SQLiteValue[]) {
    return (this.database.prepare(sql).get(...params) as T | undefined) ?? null;
  }
  async getAllAsync<T>(sql: string, ...params: SQLiteValue[]) {
    return this.database.prepare(sql).all(...params) as T[];
  }
  async runAsync(sql: string, ...params: SQLiteValue[]) {
    return this.database.prepare(sql).run(...params);
  }
  async withExclusiveTransactionAsync(
    task: (transaction: OutboxDatabase) => Promise<void>,
  ) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      await task(this);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

const directories: string[] = [];
const storeId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
const productId = "33333333-3333-4333-8333-333333333333";
const timestamp = "2026-09-26T08:00:00.000Z";

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("ProductMasterRepository", () => {
  it("stores an offline aggregate and preserves leading-zero identifiers", async () => {
    const directory = mkdtempSync(join(tmpdir(), "fl-copilot-products-"));
    directories.push(directory);
    const database = new DatabaseSync(join(directory, "local.db"));
    const adapter = new NodeDatabase(database);
    await runLocalMigrations(adapter);
    const repository = new ProductMasterRepository(adapter);

    await repository.upsertProduct(
      {
        id: productId,
        storeId,
        label: "Poire Conférence vrac",
        category: "FRUIT",
        nature: "BULK",
        salesUnit: "KG",
        packaging: null,
        familyId: null,
        subfamilyId: null,
        status: "ACTIVE",
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      },
      {
        commandId: "44444444-4444-4444-8444-444444444444",
        deviceId,
      },
    );
    await repository.upsertIdentifier(
      {
        id: "55555555-5555-4555-8555-555555555555",
        storeId,
        productId,
        type: "EAN",
        value: "0000087003017",
        source: "MERCALYS",
        status: "VALIDATED",
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      },
      {
        commandId: "66666666-6666-4666-8666-666666666666",
        deviceId,
      },
    );
    await repository.upsertAlias(
      {
        id: "77777777-7777-4777-8777-777777777777",
        storeId,
        productId,
        alias: "Poire conférence vra",
        normalizedAlias: "POIRE CONFERENCE VRA",
        source: "MERCALYS",
        status: "VALIDATED",
        confidence: null,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      },
      {
        commandId: "88888888-8888-4888-8888-888888888888",
        deviceId,
      },
    );

    await expect(repository.getProduct(productId)).resolves.toMatchObject({
      entity: { id: productId, label: "Poire Conférence vrac" },
      syncState: "PENDING",
      dirty: true,
      remoteVersion: null,
    });
    await expect(repository.listIdentifiers(productId)).resolves.toMatchObject([
      { entity: { value: "0000087003017" }, syncState: "PENDING" },
    ]);
    await expect(repository.listAliases(productId)).resolves.toHaveLength(1);
    await expect(
      repository.listIdentifiersByStore(storeId),
    ).resolves.toMatchObject([
      { entity: { productId, value: "0000087003017" } },
    ]);
    await expect(repository.listAliasesByStore(storeId)).resolves.toMatchObject(
      [{ entity: { productId, normalizedAlias: "POIRE CONFERENCE VRA" } }],
    );
    expect(
      database
        .prepare(
          "SELECT command_type, payload_json FROM sync_outbox ORDER BY local_sequence",
        )
        .all()
        .map((row) => ({
          commandType: row.command_type,
          payload: JSON.parse(row.payload_json as string),
        })),
    ).toMatchObject([
      { commandType: "PRODUCT_UPSERT" },
      {
        commandType: "PRODUCT_IDENTIFIER_UPSERT",
        payload: { value: "0000087003017" },
      },
      { commandType: "PRODUCT_ALIAS_UPSERT" },
    ]);
    database.close();
  });

  it("soft-deletes an entity and enqueues its stable ID atomically", async () => {
    const directory = mkdtempSync(join(tmpdir(), "fl-copilot-products-"));
    directories.push(directory);
    const database = new DatabaseSync(join(directory, "local.db"));
    const adapter = new NodeDatabase(database);
    await runLocalMigrations(adapter);
    const repository = new ProductMasterRepository(adapter);
    await repository.upsertProduct(
      {
        id: productId,
        storeId,
        label: "Tomate",
        category: "VEGETABLE",
        nature: "BULK",
        salesUnit: "KG",
        status: "ACTIVE",
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        commandId: "44444444-4444-4444-8444-444444444444",
        deviceId,
      },
    );
    await repository.delete(
      "product",
      productId,
      storeId,
      "2026-09-26T09:00:00.000Z",
      {
        commandId: "99999999-9999-4999-8999-999999999999",
        deviceId,
      },
    );

    await expect(repository.getProduct(productId)).resolves.toMatchObject({
      entity: { id: productId, deletedAt: "2026-09-26T09:00:00.000Z" },
      syncState: "PENDING",
      dirty: true,
    });
    expect(
      database
        .prepare("SELECT command_type FROM sync_outbox WHERE command_id = ?")
        .get("99999999-9999-4999-8999-999999999999"),
    ).toEqual({ command_type: "PRODUCT_DELETE" });
    database.close();
  });
});
