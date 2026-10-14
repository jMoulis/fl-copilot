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
  readMercalysPublication,
  applyMercalysPublication,
} from "./mercalys-publication-sync";
import { OutboxRepository } from "../sync/outbox-repository";

describe("durable Mercalys canonical synchronization", () => {
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
