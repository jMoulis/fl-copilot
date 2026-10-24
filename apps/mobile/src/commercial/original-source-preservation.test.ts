import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { commercialChoiceId } from "@fl-copilot/commercial-core";
import { commercialOfferChoiceSchema } from "@fl-copilot/domain";
import {
  commercialChoiceFixture,
  testChoiceDigest,
} from "../../../../scripts/test-commercial-choice-fixtures";
import { VisualTestDatabase } from "../../../../scripts/test-visual-sqlite";
import {
  localMigrations,
  runLocalMigrations,
  getLocalSchemaVersion,
} from "../db/migrations";
import { CommercialChoiceRepository } from "./offer-choice-repository";
import { applyCommercialVisualReading } from "./visual-repository";
import {
  readCommercialChoiceSource,
  readCommercialOfferEditorSource,
} from "./choice-source";
import { ProductMasterRepository } from "../products/product-master-repository";
import { OutboxRepository } from "../sync/outbox-repository";

it("upgrades v60 atomically with every legacy payload, history, dirty state and queued command intact, including retry after failed migration", async () => {
  const directory = mkdtempSync(join(tmpdir(), "fl-choice-upgrade-")),
    path = join(directory, "a.sqlite");
  let db = new VisualTestDatabase(new DatabaseSync(path));
  try {
    await runLocalMigrations(db, localMigrations.slice(0, 60));
    const f = await commercialChoiceFixture();
    await applyCommercialVisualReading(db, f.storeId, f.reading);
    await new ProductMasterRepository(db).upsertProduct(f.product, {
      commandId: randomUUID(),
      deviceId: randomUUID(),
    });
    await new CommercialChoiceRepository(db, testChoiceDigest).save(f.choice, {
      commandId: randomUUID(),
      deviceId: randomUUID(),
    });
    await db.runAsync(
      "UPDATE commercial_offer_choices SET remote_payload_json=?,remote_version=7,sync_state='CONFLICT' WHERE id=?",
      JSON.stringify({ ...f.choice, note: "remote", version: 7 }),
      f.choice.id,
    );
    const snapshot = () =>
      [
        "commercial_offer_choices",
        "commercial_choice_history",
        "sync_outbox",
        "commercial_visual_readings",
      ].map((name) => db.raw.prepare(`SELECT * FROM ${name}`).all());
    const before = snapshot();
    const exec = db.execAsync.bind(db);
    db.execAsync = async (sql) => {
      if (sql.includes("INSERT INTO commercial_offer_choices_next"))
        throw Error("COPY_INTERRUPTED");
      await exec(sql);
    };
    await expect(runLocalMigrations(db)).rejects.toThrow("COPY_INTERRUPTED");
    expect(await getLocalSchemaVersion(db)).toBe(60);
    expect(snapshot()).toEqual(before);
    db.execAsync = exec;
    await runLocalMigrations(db);
    expect(await getLocalSchemaVersion(db)).toBe(61);
    expect(snapshot()).toEqual(before);
    db.raw.close();
    db = new VisualTestDatabase(new DatabaseSync(path));
    await runLocalMigrations(db);
    expect(snapshot()).toEqual(before);
    for (let i = 0; i < 2; i++)
      await db.runAsync(
        "INSERT INTO commercial_offer_choices(id,store_id,source_document_id,payload_json,sync_state) VALUES(?,?,?,?,?)",
        randomUUID(),
        f.storeId,
        f.sourceDocumentId,
        "{}",
        "PENDING",
      );
    await expect(
      db.runAsync(
        "INSERT INTO commercial_offer_choices(id,store_id,source_document_id,reading_id,operation_index,item_index,payload_json,sync_state) VALUES(?,?,?,?,?,?,?,?)",
        randomUUID(),
        f.storeId,
        f.sourceDocumentId,
        f.readingId,
        0,
        0,
        "{}",
        "PENDING",
      ),
    ).rejects.toThrow("UNIQUE");
    await expect(
      db.runAsync(
        "INSERT INTO commercial_offer_choices(id,store_id,source_document_id,reading_id,payload_json,sync_state) VALUES(?,?,?,?,?,?)",
        randomUUID(),
        f.storeId,
        f.sourceDocumentId,
        f.readingId,
        "{}",
        "PENDING",
      ),
    ).rejects.toThrow("CHECK");
  } finally {
    db.raw.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("fences a queued or interrupted original save, and permits a faithful withdrawal after the original is unavailable", async () => {
  const db = new VisualTestDatabase(new DatabaseSync(":memory:"));
  try {
    await runLocalMigrations(db);
    const f = await commercialChoiceFixture(),
      source = {
        kind: "PDF_ORIGINAL" as const,
        sourceDocumentId: f.sourceDocumentId,
        checksum: `sha256:${"a".repeat(64)}`,
        pageNumber: 2,
        excerpt: "Raisin blanc vrac S44 moins de 2,20 EUR/kg",
      };
    const choice = commercialOfferChoiceSchema.parse({
      ...f.choice,
      id: await commercialChoiceId(f.storeId, source, testChoiceDigest),
      source,
    });
    const repo = new CommercialChoiceRepository(db, testChoiceDigest),
      outbox = new OutboxRepository(db);
    await new ProductMasterRepository(db).upsertProduct(f.product, {
      commandId: randomUUID(),
      deviceId: randomUUID(),
    });
    db.raw.exec("UPDATE sync_outbox SET status='ACKNOWLEDGED'");
    await db.runAsync(
      "INSERT INTO source_documents(id,store_id,source_type,checksum,local_processing_status,remote_upload_status,version,created_at,updated_at,sync_state,dirty) VALUES(?,?,'WEEKLY_COMMERCIAL_PDF',?,'PENDING','PENDING',1,?,?,'PENDING',1)",
      f.sourceDocumentId,
      f.storeId,
      source.checksum,
      f.choice.createdAt,
      f.choice.updatedAt,
    );
    const ctx = { commandId: randomUUID(), deviceId: randomUUID() };
    for (const stopAfter of [1, 2, 3]) {
      let checks = 0;
      await expect(
        repo.save(choice, {
          ...ctx,
          assertCurrentScope: () => {
            if (++checks === stopAfter) throw Error("SCOPE_CHANGED");
          },
        }),
      ).rejects.toThrow("SCOPE_CHANGED");
      expect(await repo.list(f.storeId)).toEqual([]);
      expect(await outbox.listPending(f.storeId)).toEqual([]);
      expect(
        await db.getFirstAsync(
          "SELECT COUNT(*) n FROM commercial_choice_history",
        ),
      ).toEqual({ n: 0 });
    }
    await repo.save(choice, ctx);
    await db.runAsync(
      "UPDATE source_documents SET deleted_at=? WHERE id=?",
      f.choice.updatedAt,
      f.sourceDocumentId,
    );
    expect((await readCommercialChoiceSource(db, choice)).offer).toBeNull();
    const editor = await readCommercialOfferEditorSource(
      db,
      f.storeId,
      {
        id: choice.id,
        choiceId: choice.id,
        operationIndex: NaN,
        itemIndex: NaN,
      },
      (id) => repo.get(f.storeId, id),
      testChoiceDigest,
    );
    expect(editor.sourceAvailable).toBe(false);
    expect(editor.offer.source).toEqual(source);
    const withdrawn = {
      ...choice,
      status: "WITHDRAWN" as const,
      version: 2,
      note: "Non retenu",
      updatedAt: "2026-10-24T14:00:00Z",
    };
    await expect(
      repo.save(
        { ...withdrawn, saleEnd: "2026-10-09" },
        { commandId: randomUUID(), deviceId: ctx.deviceId },
      ),
    ).rejects.toThrow("COMMERCIAL_CHOICE_WITHDRAWAL_CHANGED");
    await repo.save(withdrawn, {
      commandId: randomUUID(),
      deviceId: ctx.deviceId,
    });
    expect((await repo.get(f.storeId, choice.id))?.entity).toEqual(withdrawn);
    expect(
      await db.getFirstAsync(
        "SELECT COUNT(*) n FROM commercial_choice_history",
      ),
    ).toEqual({ n: 2 });
  } finally {
    db.raw.close();
  }
});
