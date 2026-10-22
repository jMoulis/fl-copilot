import { sourceOriginalHash } from "./source-original-hash";
import { serializeSourceOriginalMetadata } from "@fl-copilot/sync-contracts";
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  MercalysTestDatabase,
  mercalysLocalFixture,
  mercalysWorkbook,
  mercalysTimestamp,
} from "../../../../scripts/test-mercalys-sync-fixtures";
import { MercalysImportPublicationRepository } from "./mercalys-import-publication";
import {
  enqueueMercalysPublications,
  repairMercalysPublications,
  readMercalysPublication,
  applyMercalysPublication,
} from "./mercalys-publication-sync";
import { OutboxRepository } from "../sync/outbox-repository";
import { SQLiteProductDateRecomputer } from "../analytics/local-recomputation";

describe("durable Mercalys canonical synchronization", () => {
  it("isolates historical repair errors, retains a visible diagnostic and retries the same source without discarding valid commands", async () => {
    const db = new MercalysTestDatabase(),
      storeId = randomUUID(),
      productId = randomUUID();
    try {
      await mercalysLocalFixture(db, storeId, productId);
      const repository = new MercalysImportPublicationRepository(
        db,
        randomUUID,
      );
      const old = await repository.publish(
        mercalysWorkbook(storeId, productId).input,
      );
      const records = await db.getAllAsync<{
        id: string;
        raw_payload_json: string;
      }>(
        "SELECT id,raw_payload_json FROM source_records WHERE source_document_id=?",
        old.sourceDocumentId,
      );
      await db.runAsync("UPDATE sync_outbox SET status='ACKNOWLEDGED'");
      await db.runAsync(
        "UPDATE source_records SET raw_payload_json='not-json' WHERE source_document_id=?",
        old.sourceDocumentId,
      );
      await repository.publish(
        mercalysWorkbook(storeId, productId, "MERCALYS_SALES", "2026-10-08")
          .input,
      );
      const pending = await new OutboxRepository(db).listPending(storeId);
      await repairMercalysPublications(db, storeId, randomUUID, () => {
        throw Error("monitor unavailable");
      });
      expect(await new OutboxRepository(db).listPending(storeId)).toEqual(
        pending,
      );
      expect(
        await db.getFirstAsync(
          "SELECT status,last_error,attempt_count FROM local_jobs WHERE type='MERCALYS_PUBLICATION_REPAIR'",
        ),
      ).toEqual({
        status: "FAILED",
        last_error: "LOCAL_DATA_INVALID",
        attempt_count: 1,
      });
      expect(
        await db.getFirstAsync(
          "SELECT COUNT(*) n FROM sales_observations WHERE deleted_at IS NULL",
        ),
      ).toEqual({ n: 2 });
      for (const r of records)
        await db.runAsync(
          "UPDATE source_records SET raw_payload_json=? WHERE id=?",
          r.raw_payload_json,
          r.id,
        );
      await repairMercalysPublications(db, storeId, randomUUID);
      expect(
        await db.getFirstAsync(
          "SELECT status,last_error FROM local_jobs WHERE type='MERCALYS_PUBLICATION_REPAIR'",
        ),
      ).toEqual({ status: "COMPLETED", last_error: null });
      expect(await new OutboxRepository(db).listPending(storeId)).toHaveLength(
        2,
      );
      await repairMercalysPublications(db, storeId, randomUUID);
      expect(await new OutboxRepository(db).listPending(storeId)).toHaveLength(
        2,
      );
    } finally {
      db.db.close();
    }
  });

  it("rolls back a failed corrected import after supersession and preserves the previous figures and immutable pending commands", async () => {
    const db = new MercalysTestDatabase(),
      storeId = randomUUID(),
      productId = randomUUID();
    try {
      await mercalysLocalFixture(db, storeId, productId);
      const repository = new MercalysImportPublicationRepository(
        db,
        randomUUID,
      );
      await repository.publish(
        mercalysWorkbook(
          storeId,
          productId,
          "MERCALYS_SALES",
          "2026-10-07",
          12.4,
          false,
        ).input,
      );
      const recomputer = new SQLiteProductDateRecomputer(db);
      await recomputer.recomputeProduct(storeId, {
        productId,
        businessDate: "2026-10-07",
      });
      await recomputer.recomputeDepartment(storeId, "2026-10-07");
      const before = await Promise.all([
        db.getAllAsync("SELECT * FROM sales_observations"),
        db.getAllAsync("SELECT * FROM product_daily_performance"),
        db.getAllAsync("SELECT * FROM department_daily_performance"),
        db.getAllAsync("SELECT * FROM sync_outbox"),
      ]);
      const correction = mercalysWorkbook(
        storeId,
        productId,
        "MERCALYS_SALES",
        "2026-10-07",
        15,
        false,
      ).input;
      const overlap = (await repository.analyzeOverlap(
        storeId,
        correction.summary,
      ))!;
      db.db.exec(
        "CREATE TRIGGER fail_new_source BEFORE INSERT ON source_records BEGIN SELECT RAISE(ABORT, 'test_insert_failure'); END",
      );
      await expect(
        repository.publish({
          ...correction,
          reconciliationApproval: {
            fingerprint: overlap.fingerprint,
            actorUserId: randomUUID(),
          },
        }),
      ).rejects.toThrow("test_insert_failure");
      expect(
        await Promise.all([
          db.getAllAsync("SELECT * FROM sales_observations"),
          db.getAllAsync("SELECT * FROM product_daily_performance"),
          db.getAllAsync("SELECT * FROM department_daily_performance"),
          db.getAllAsync("SELECT * FROM sync_outbox"),
        ]),
      ).toEqual(before);
      expect(
        await db.getFirstAsync("SELECT COUNT(*) n FROM source_documents"),
      ).toEqual({ n: 1 });
    } finally {
      db.db.close();
    }
  });
  it("publishes an unrelated new file without reparsing a damaged historical source or deleting its observations", async () => {
    const db = new MercalysTestDatabase(),
      storeId = randomUUID(),
      productId = randomUUID();
    try {
      await mercalysLocalFixture(db, storeId, productId);
      const repository = new MercalysImportPublicationRepository(
        db,
        randomUUID,
      );
      const old = await repository.publish(
        mercalysWorkbook(storeId, productId).input,
      );
      await db.runAsync("UPDATE sync_outbox SET status='ACKNOWLEDGED'");
      await db.runAsync(
        "UPDATE source_records SET raw_payload_json='not-json' WHERE source_document_id=?",
        old.sourceDocumentId,
      );
      const before = await db.getAllAsync(
        "SELECT * FROM sales_observations WHERE source_document_id=?",
        old.sourceDocumentId,
      );
      const next = await repository.publish(
        mercalysWorkbook(storeId, productId, "MERCALYS_SALES", "2026-10-08")
          .input,
      );
      expect(next.publishedCount).toBe(1);
      expect(
        await db.getAllAsync(
          "SELECT * FROM sales_observations WHERE source_document_id=?",
          old.sourceDocumentId,
        ),
      ).toEqual(before);
      expect(await new OutboxRepository(db).listPending(storeId)).toHaveLength(
        1,
      );
    } finally {
      db.db.close();
    }
  });
  it("rolls back a publication when its durable command cannot be created", async () => {
    const db = new MercalysTestDatabase(),
      storeId = randomUUID(),
      productId = randomUUID();
    try {
      await mercalysLocalFixture(db, storeId, productId);
      await db.runAsync("DELETE FROM app_metadata WHERE key='device_id'");
      await expect(
        new MercalysImportPublicationRepository(db, randomUUID).publish(
          mercalysWorkbook(storeId, productId).input,
        ),
      ).rejects.toThrow("MERCALYS_DEVICE_ID_REQUIRED");
      expect(
        await db.getFirstAsync("SELECT COUNT(*) AS n FROM source_documents"),
      ).toEqual({ n: 0 });
      expect(
        await db.getFirstAsync("SELECT COUNT(*) AS n FROM sales_observations"),
      ).toEqual({ n: 0 });
      expect(
        await db.getFirstAsync("SELECT COUNT(*) AS n FROM local_jobs"),
      ).toEqual({ n: 0 });
    } finally {
      db.db.close();
    }
  });

  it("enqueues approved rows atomically, preserves warning records and repairs legacy publication once", async () => {
    const db = new MercalysTestDatabase(),
      storeId = randomUUID(),
      productId = randomUUID();
    try {
      await mercalysLocalFixture(db, storeId, productId);
      const f = mercalysWorkbook(storeId, productId);
      const publication = await new MercalysImportPublicationRepository(
        db,
        randomUUID,
      ).publish(f.input);
      const commands = await new OutboxRepository(db).listPending(storeId);
      expect(commands).toHaveLength(1);
      const packet = commands[0]!.payload as {
        sales: { id: string }[];
        records: { status: string }[];
      };
      expect(packet.sales).toHaveLength(1);
      expect(packet.records.map((r) => r.status)).toEqual([
        "PUBLISHED",
        "WARNING",
      ]);
      const observation = packet.sales[0]!.id;
      await db.runAsync("DELETE FROM sync_outbox");
      await db.withExclusiveTransactionAsync((tx) =>
        enqueueMercalysPublications(tx, storeId, randomUUID, mercalysTimestamp),
      );
      await db.withExclusiveTransactionAsync((tx) =>
        enqueueMercalysPublications(tx, storeId, randomUUID, mercalysTimestamp),
      );
      expect(await new OutboxRepository(db).listPending(storeId)).toHaveLength(
        1,
      );
      expect(
        (await readMercalysPublication(
          db,
          storeId,
          publication.sourceDocumentId,
        ))!.sales[0]!.id,
      ).toBe(observation);
      const remote = {
        id: publication.sourceDocumentId,
        storeId,
        remoteVersion: 1,
        publication: await readMercalysPublication(
          db,
          storeId,
          publication.sourceDocumentId,
        ),
      };
      await db.withExclusiveTransactionAsync((tx) =>
        applyMercalysPublication(tx, storeId, remote, true),
      );
      await db.runAsync("UPDATE sync_outbox SET status='ACKNOWLEDGED'");
      await db.withExclusiveTransactionAsync((tx) =>
        enqueueMercalysPublications(tx, storeId, randomUUID, mercalysTimestamp),
      );
      expect(await new OutboxRepository(db).listPending(storeId)).toHaveLength(
        0,
      );
      const other = new MercalysTestDatabase();
      try {
        await mercalysLocalFixture(other, storeId, productId);
        await other.withExclusiveTransactionAsync((tx) =>
          applyMercalysPublication(tx, storeId, remote),
        );
        await other.withExclusiveTransactionAsync((tx) =>
          applyMercalysPublication(tx, storeId, remote),
        );
        expect(
          await other.getFirstAsync(
            "SELECT id,sync_state FROM sales_observations",
          ),
        ).toEqual({ id: observation, sync_state: "SYNCED" });
        expect(
          await other.getFirstAsync(
            "SELECT local_file_uri FROM source_documents",
          ),
        ).toEqual({ local_file_uri: null });
      } finally {
        other.db.close();
      }
    } finally {
      db.db.close();
    }
  });
  it("keeps a newer local correction when an earlier packet is acknowledged", async () => {
    const db = new MercalysTestDatabase(),
      storeId = randomUUID(),
      productId = randomUUID();
    try {
      await mercalysLocalFixture(db, storeId, productId);
      const p = await new MercalysImportPublicationRepository(
        db,
        randomUUID,
      ).publish(mercalysWorkbook(storeId, productId).input);
      const packet = await readMercalysPublication(
        db,
        storeId,
        p.sourceDocumentId,
      );
      await db.runAsync(
        "UPDATE sales_observations SET version=2,deleted_at=?,updated_at=?,dirty=1",
        mercalysTimestamp,
        mercalysTimestamp,
      );
      await db.withExclusiveTransactionAsync((tx) =>
        applyMercalysPublication(
          tx,
          storeId,
          {
            id: p.sourceDocumentId,
            storeId,
            remoteVersion: 1,
            publication: packet,
          },
          true,
        ),
      );
      expect(
        await db.getFirstAsync(
          "SELECT version,deleted_at,dirty FROM sales_observations",
        ),
      ).toEqual({ version: 2, deleted_at: mercalysTimestamp, dirty: 1 });
      await db.runAsync("UPDATE sync_outbox SET status='ACKNOWLEDGED'");
      await db.withExclusiveTransactionAsync((tx) =>
        enqueueMercalysPublications(tx, storeId, randomUUID, mercalysTimestamp),
      );
      expect(
        (await new OutboxRepository(db).listPending(storeId))[0]!
          .expectedRemoteVersion,
      ).toBe(1);
    } finally {
      db.db.close();
    }
  });
});
it.each(["VALID", "DAMAGED", "FOREIGN", "PRIVATE", "PENDING"])(
  "joins only a verified original restored before its publication (%s), preserving the business pull",
  async (mode) => {
    const first = new MercalysTestDatabase(),
      second = new MercalysTestDatabase(),
      storeId = randomUUID(),
      productId = randomUUID();
    try {
      await mercalysLocalFixture(first, storeId, productId);
      await mercalysLocalFixture(second, storeId, productId);
      const published = await new MercalysImportPublicationRepository(
        first,
        randomUUID,
      ).publish(mercalysWorkbook(storeId, productId).input);
      const packet = (await readMercalysPublication(
        first,
        storeId,
        published.sourceDocumentId,
      ))!;
      const fileId = randomUUID(),
        ownerId = randomUUID(),
        uri = "file:///retained-before-pull.xlsx";
      const manifest = {
        schemaVersion: 1,
        sourceDocumentId: published.sourceDocumentId,
        storeId,
        access: "STORE",
        ownerId: null,
        sourceType: packet.source.sourceType,
        filename: packet.source.originalFilename,
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sizeBytes: 100,
        checksum: packet.source.checksum,
        registeredAt: mercalysTimestamp,
        objectVersion: "blob-version",
        manifestHash: `sha256:${"a".repeat(64)}`,
      };
      const { manifestHash: _previousHash, ...metadata } = manifest;
      void _previousHash;
      manifest.manifestHash = sourceOriginalHash(
        serializeSourceOriginalMetadata(metadata),
      );
      if (mode === "DAMAGED")
        manifest.manifestHash = `sha256:${"b".repeat(64)}`;
      if (mode === "FOREIGN") manifest.storeId = randomUUID();
      if (mode === "PRIVATE")
        Object.assign(manifest, { access: "OWNER", ownerId });
      await second.runAsync(
        "INSERT INTO local_files(id,store_id,source_document_id,local_uri,mime_type,size_bytes,checksum,retention_status,upload_status,created_at,updated_at) VALUES(?,?,?,?,?,100,?,'RETAINED','CONFIRMED',?,?)",
        fileId,
        storeId,
        published.sourceDocumentId,
        uri,
        manifest.mimeType,
        manifest.checksum!,
        mercalysTimestamp,
        mercalysTimestamp,
      );
      await second.runAsync(
        "INSERT INTO source_original_manifests(store_id,owner_id,source_document_id,manifest_json,local_file_id,verified_at) VALUES(?,?,?,?,?,?)",
        storeId,
        ownerId,
        published.sourceDocumentId,
        JSON.stringify(manifest),
        fileId,
        mercalysTimestamp,
      );
      if (mode === "PENDING")
        await second.runAsync("UPDATE local_files SET upload_status='PENDING'");
      await second.withExclusiveTransactionAsync((tx) =>
        applyMercalysPublication(tx, storeId, {
          id: published.sourceDocumentId,
          storeId,
          remoteVersion: 1,
          publication: packet,
        }),
      );
      expect(
        await second.getFirstAsync(
          "SELECT local_file_uri,dirty,remote_version,local_processing_status FROM source_documents",
        ),
      ).toEqual({
        local_file_uri: mode === "VALID" ? uri : null,
        dirty: 0,
        remote_version: 1,
        local_processing_status: "PUBLISHED",
      });
      expect(
        await second.getFirstAsync("SELECT COUNT(*) n FROM sales_observations"),
      ).toEqual({ n: 1 });
      expect(await new OutboxRepository(second).listPending(storeId)).toEqual(
        [],
      );
    } finally {
      first.db.close();
      second.db.close();
    }
  },
);
