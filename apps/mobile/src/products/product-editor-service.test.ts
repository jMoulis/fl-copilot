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
  saveProductEditorLocally,
  productSnapshotToDraft,
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
  it("does not multiply pending commands or change codes and aliases when only a product field changes", async () => {
    const { adapter, database } = await temporaryDatabase();
    try {
      const repository = new ProductMasterRepository(adapter);
      const options = {
        storeId: "11111111-1111-4111-8111-111111111111",
        deviceId: "22222222-2222-4222-8222-222222222222",
        now: () => "2026-10-22T12:00:00.000Z",
        generateId: idSequence(),
      };
      const productId = await saveProductEditorLocally(
        adapter,
        {
          ...emptyProductDraft,
          label: "Butternut",
          identifiers: [{ type: "EAN", value: "00001234" }],
          aliases: Array.from({ length: 20 }, (_, i) => ({
            alias: `Butternut ${i}`,
          })),
        },
        options,
      );
      const base = (await loadProductEditorSnapshot(repository, productId))!;
      database
        .prepare(
          "INSERT INTO product_daily_performance(id,store_id,product_id,business_date,payload_json,origin,formula_version,input_revision,computed_at) VALUES('existing-day',?,?,'2026-10-20','{}','LOCAL','test','test',?)",
        )
        .run(options.storeId, productId, options.now());
      const before = database
        .prepare("SELECT COUNT(*) n FROM sync_outbox")
        .get() as { n: number };
      await saveProductEditorLocally(
        adapter,
        { ...productSnapshotToDraft(base), category: "VEGETABLE" },
        { ...options, productId },
        base,
      );
      const after = (await loadProductEditorSnapshot(repository, productId))!;
      expect(
        database.prepare("SELECT COUNT(*) n FROM sync_outbox").get(),
      ).toEqual({ n: before.n + 1 });
      expect(after.identifiers).toEqual(base.identifiers);
      expect(after.aliases).toEqual(base.aliases);
      await saveProductEditorLocally(
        adapter,
        productSnapshotToDraft(after),
        { ...options, productId },
        after,
      );
      expect(await loadProductEditorSnapshot(repository, productId)).toEqual(
        after,
      );
      expect(
        database
          .prepare(
            "SELECT COUNT(*) n FROM local_jobs WHERE type='ANALYTICS_RECOMPUTE_PRODUCT_DATES'",
          )
          .get(),
      ).toEqual({ n: 1 });
      expect(
        database.prepare("SELECT COUNT(*) n FROM sync_outbox").get(),
      ).toEqual({ n: before.n + 1 });
    } finally {
      database.close();
    }
  });
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

describe("guarded manual product editing", () => {
  const storeId = "11111111-1111-4111-8111-111111111111";
  const deviceId = "22222222-2222-4222-8222-222222222222";
  function options() {
    return {
      storeId,
      deviceId,
      now: () => "2026-10-19T12:00:00.000Z",
      generateId: idSequence(),
    };
  }
  it("allows an acknowledgement-only refresh but refuses a changed canonical fiche without overwriting it", async () => {
    const { adapter, database } = await temporaryDatabase();
    try {
      const opt = options(),
        repo = new ProductMasterRepository(adapter);
      const id = await saveProductEditorLocally(
        adapter,
        {
          ...emptyProductDraft,
          label: "Butternut",
          identifiers: [{ type: "EAN", value: "00001234" }],
        },
        opt,
      );
      const base = (await loadProductEditorSnapshot(repo, id))!;
      database
        .prepare(
          "UPDATE products SET dirty=0, sync_state='SYNCED', remote_version=1 WHERE id=?",
        )
        .run(id);
      database
        .prepare(
          "INSERT INTO product_daily_performance(id,store_id,product_id,business_date,payload_json,origin,formula_version,input_revision,computed_at) VALUES('test-daily',?,?,'2026-10-18','{}','LOCAL','test','test',?)",
        )
        .run(storeId, id, opt.now());
      const draft = {
        ...productSnapshotToDraft(base),
        category: "VEGETABLE" as const,
      };
      await saveProductEditorLocally(
        adapter,
        draft,
        { ...opt, productId: id },
        base,
      );
      const job = database
        .prepare(
          "SELECT type,payload_json FROM local_jobs WHERE type='ANALYTICS_RECOMPUTE_PRODUCT_DATES'",
        )
        .get() as { type: string; payload_json: string };
      expect(JSON.parse(job.payload_json)).toMatchObject({
        storeId,
        scopes: [{ productId: id, businessDate: "2026-10-18" }],
      });
      const changed = (await loadProductEditorSnapshot(repo, id))!;
      const count = database
        .prepare("SELECT COUNT(*) n FROM sync_outbox")
        .get();
      await expect(
        saveProductEditorLocally(
          adapter,
          { ...draft, label: "Écrasé" },
          { ...opt, productId: id },
          base,
        ),
      ).rejects.toThrow("PRODUCT_EDITOR_CHANGED");
      expect(
        (await loadProductEditorSnapshot(repo, id))!.product.entity.label,
      ).toBe("Butternut");
      expect(
        database.prepare("SELECT COUNT(*) n FROM sync_outbox").get(),
      ).toEqual(count);
      expect(changed.product.entity.category).toBe("VEGETABLE");
    } finally {
      database.close();
    }
  });
  it("rolls back the complete product, its earlier code and Outbox if a later SQLite write fails", async () => {
    const { adapter, database } = await temporaryDatabase();
    try {
      const opt = options();
      database.exec(
        "CREATE TRIGGER reject_test_code BEFORE INSERT ON product_identifiers WHEN NEW.value='99999' BEGIN SELECT RAISE(ABORT, 'test_late_write_failure'); END",
      );
      await expect(
        saveProductEditorLocally(
          adapter,
          {
            ...emptyProductDraft,
            label: "Poire",
            identifiers: [
              { type: "EAN", value: "00123" },
              { type: "EAN", value: "99999" },
            ],
          },
          opt,
        ),
      ).rejects.toThrow();
      for (const table of ["products", "product_identifiers", "sync_outbox"])
        expect(
          database.prepare(`SELECT COUNT(*) n FROM ${table}`).get(),
        ).toEqual({ n: 0 });
    } finally {
      database.close();
    }
  });
  it("refuses foreign, deleted and concurrently conflicted targets without creating commands", async () => {
    const { adapter, database } = await temporaryDatabase();
    try {
      const opt = options(),
        repo = new ProductMasterRepository(adapter);
      const id = await saveProductEditorLocally(
        adapter,
        { ...emptyProductDraft, label: "Poire" },
        opt,
      );
      const base = (await loadProductEditorSnapshot(repo, id))!,
        draft = productSnapshotToDraft(base);
      const count = database
        .prepare("SELECT COUNT(*) n FROM sync_outbox")
        .get();
      await expect(
        saveProductEditorLocally(
          adapter,
          draft,
          { ...opt, productId: id, storeId: deviceId },
          base,
        ),
      ).rejects.toThrow("PRODUCT_EDITOR_UNAVAILABLE");
      await expect(
        saveProductEditorLocally(adapter, draft, { ...opt, productId: id }),
      ).rejects.toThrow("PRODUCT_EDITOR_CHANGED");
      database
        .prepare(
          `INSERT INTO sync_conflicts(id,store_id,entity_type,entity_id,local_payload_json,remote_payload_json,local_expected_version,remote_version,conflict_type,status,created_at) VALUES('test',?,'product',?,'{}','{}',1,2,'SYNC_VERSION_CONFLICT','OPEN',?)`,
        )
        .run(storeId, id, opt.now());
      await expect(
        saveProductEditorLocally(
          adapter,
          draft,
          { ...opt, productId: id },
          base,
        ),
      ).rejects.toThrow("PRODUCT_EDITOR_CONFLICT");
      database.prepare("DELETE FROM sync_conflicts WHERE id='test'").run();
      database
        .prepare("UPDATE products SET deleted_at=? WHERE id=?")
        .run(opt.now(), id);
      await expect(
        saveProductEditorLocally(
          adapter,
          draft,
          { ...opt, productId: id },
          base,
        ),
      ).rejects.toThrow("PRODUCT_EDITOR_UNAVAILABLE");
      expect(
        database.prepare("SELECT COUNT(*) n FROM sync_outbox").get(),
      ).toEqual(count);
    } finally {
      database.close();
    }
  });
  it("does not move an existing EAN to a newly created product", async () => {
    const { adapter, database } = await temporaryDatabase();
    try {
      const opt = options();
      await saveProductEditorLocally(
        adapter,
        {
          ...emptyProductDraft,
          label: "Poire",
          identifiers: [{ type: "EAN", value: "00123" }],
        },
        opt,
      );
      const before = database
        .prepare("SELECT COUNT(*) n FROM sync_outbox")
        .get();
      await expect(
        saveProductEditorLocally(
          adapter,
          {
            ...emptyProductDraft,
            label: "Pomme",
            identifiers: [{ type: "EAN", value: "00123" }],
          },
          opt,
        ),
      ).rejects.toThrow("PRODUCT_EDITOR_IDENTIFIER_CONFLICT");
      expect(database.prepare("SELECT label FROM products").all()).toEqual([
        { label: "Poire" },
      ]);
      expect(
        database.prepare("SELECT COUNT(*) n FROM sync_outbox").get(),
      ).toEqual(before);
    } finally {
      database.close();
    }
  });
});
