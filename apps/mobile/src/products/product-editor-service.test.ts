import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  runLocalMigrations,
  type SQLiteMigrationDatabase,
} from "../db/migrations";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { ProductMasterRepository } from "./product-master-repository";
import {
  emptyProductDraft,
  loadProductEditorSnapshot,
  saveProductEditor,
} from "./product-editor-service";

type SQLiteValue = string | number | null;
class NodeDatabase
  implements SQLiteMigrationDatabase, OutboxDatabase, AtomicMutationDatabase
{
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
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("product editor service", () => {
  it("creates the aggregate offline and queues every mutation", async () => {
    const { adapter, database } = await temporaryDatabase();
    const ids = idSequence();
    const repository = new ProductMasterRepository(adapter);
    const productId = await saveProductEditor(
      repository,
      {
        ...emptyProductDraft,
        label: "Tomate grappe vrac",
        category: "VEGETABLE",
        nature: "BULK",
        salesUnit: "KG",
        identifiers: [{ type: "EAN", value: "0000087004664" }],
        aliases: [{ alias: "Tomate grappe vra" }],
      },
      {
        storeId: "11111111-1111-4111-8111-111111111111",
        deviceId: "22222222-2222-4222-8222-222222222222",
        now: () => "2026-09-26T22:00:00.000Z",
        generateId: ids,
      },
    );
    const snapshot = await loadProductEditorSnapshot(repository, productId);
    expect(snapshot).toMatchObject({
      product: { entity: { label: "Tomate grappe vrac" }, dirty: true },
      identifiers: [{ entity: { value: "0000087004664" } }],
      aliases: [{ entity: { normalizedAlias: "TOMATE GRAPPE VRA" } }],
    });
    expect(
      database
        .prepare("SELECT command_type FROM sync_outbox ORDER BY local_sequence")
        .all(),
    ).toEqual([
      { command_type: "PRODUCT_UPSERT" },
      { command_type: "PRODUCT_IDENTIFIER_UPSERT" },
      { command_type: "PRODUCT_ALIAS_UPSERT" },
    ]);
    database.close();
  });

  it("chains repeated offline edits against the previous local version", async () => {
    const { adapter, database } = await temporaryDatabase();
    const ids = idSequence();
    const repository = new ProductMasterRepository(adapter);
    const options = {
      storeId: "11111111-1111-4111-8111-111111111111",
      deviceId: "22222222-2222-4222-8222-222222222222",
      now: () => "2026-09-26T22:00:00.000Z",
      generateId: ids,
    };
    const productId = await saveProductEditor(
      repository,
      { ...emptyProductDraft, label: "Pomme Gala" },
      options,
    );
    const existing = await loadProductEditorSnapshot(repository, productId);
    if (!existing) throw new Error("Missing test product.");
    await saveProductEditor(
      repository,
      { ...emptyProductDraft, label: "Pomme Gala vrac" },
      { ...options, productId, existing },
    );
    expect(
      database
        .prepare(
          `SELECT expected_remote_version FROM sync_outbox
           WHERE entity_type = 'product' ORDER BY local_sequence`,
        )
        .all(),
    ).toEqual([
      { expected_remote_version: null },
      { expected_remote_version: 1 },
    ]);
    database.close();
  });
});

async function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "fl-product-editor-"));
  directories.push(directory);
  const database = new DatabaseSync(join(directory, "local.db"));
  const adapter = new NodeDatabase(database);
  await runLocalMigrations(adapter);
  return { adapter, database };
}

function idSequence() {
  let value = 1;
  return () => {
    const suffix = String(value++).padStart(12, "0");
    return `00000000-0000-4000-8000-${suffix}`;
  };
}
