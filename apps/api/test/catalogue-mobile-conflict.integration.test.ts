import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, afterAll, expect, it, describe } from "vitest";
import {
  catalogueConflictSchemas,
  catalogueConflictTables,
} from "@fl-copilot/domain";
import { syncPushRequestSchema } from "@fl-copilot/sync-contracts";
import { nativeCatalogueConflictFixture } from "../../../scripts/test-catalogue-conflict-fixtures";
import {
  ReceiptTestDatabase,
  receiptReviewDigest,
} from "../../../scripts/test-receipt-publication-sqlite";
import { runLocalMigrations } from "../../mobile/src/db/migrations";
import { MobileSyncService } from "../../mobile/src/sync/sync-service";
import { OutboxRepository } from "../../mobile/src/sync/outbox-repository";
import { ConflictRepository } from "../../mobile/src/sync/conflict-repository";
import { ProductMasterRepository } from "../../mobile/src/products/product-master-repository";
import { ProductMasterConflictRepository } from "../../mobile/src/products/conflict-repository";
import { createMongoDatabase } from "../src/database/mongo";
import { parseEnvironment } from "../src/config";
import type { DatabaseService } from "../src/database/types";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { createMongoSyncPullService } from "../src/sync/pull-service";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service";
const uri = process.env.TEST_MONGODB_URI;
const cases = (["PRODUCT", "IDENTIFIER", "ALIAS"] as const)
  .flatMap((kind) =>
    [true, false].map((local) => ({ kind, local, deletion: false })),
  )
  .concat(
    [true, false].map((local) => ({
      kind: "ALIAS" as const,
      local,
      deletion: true,
    })),
  );
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "native catalogue conflict transport",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `flc_native_catalogue_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
        }),
      );
      await database.getDb();
    });
    afterAll(async () => {
      if (database)
        try {
          await (await database.getDb()).dropDatabase();
        } finally {
          await database.close();
        }
    });
    it.each(cases)(
      "$kind projects the real push refusal, applies local=$local deletion=$deletion and restores on a third SQLite",
      async ({ kind, local, deletion }) => {
        const s = await nativeCatalogueConflictFixture(
            kind,
            ":memory:",
            undefined,
            false,
            deletion,
            deletion ? "WASTE_RECEIPT" : "USER",
          ),
          r = s.review,
          dir = mkdtempSync(join(tmpdir(), "fl-native-catalogue-")),
          path = join(dir, "restored.db"),
          other = new ReceiptTestDatabase(new DatabaseSync(path)),
          pushing = createMongoSyncPushService(database),
          pulling = createMongoSyncPullService(database),
          boot = createMongoSyncBootstrapService(database);
        let closed = false;
        const service = (db: ReceiptTestDatabase, deviceId: string) =>
          new MobileSyncService(
            db,
            {
              push: (request) =>
                pushing.push(request, randomUUID(), s.scope.ownerId),
              pull: (storeId, cursor) =>
                pulling.pull(storeId, { cursor, limit: 500 }),
              bootstrap: (storeId) =>
                boot.bootstrap(
                  {
                    storeId,
                    userId: s.scope.ownerId,
                    deviceId,
                    storeName: "Test",
                    role: "MANAGER",
                    sessionId: randomUUID(),
                  },
                  { rawObservationDays: 90 },
                ),
            },
            { appVersion: "test", deviceId },
          );
        try {
          await runLocalMigrations(other);
          const source = [
              "source_documents",
              "waste_receipts",
              "waste_lines",
              "sales_observations",
              "waste_observations",
            ].map((t) =>
              s.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
            ),
            request = (
              entries: Array<{
                type: string;
                entityType: string;
                entity: unknown;
                expected: number | null;
              }>,
            ) =>
              syncPushRequestSchema.parse({
                syncProtocolVersion: 1,
                appVersion: "test",
                storeId: s.scope.storeId,
                deviceId: randomUUID(),
                commands: entries.map((entry, i) => ({
                  commandId: randomUUID(),
                  localSequence: i + 1,
                  type: entry.type,
                  entityType: entry.entityType,
                  entityId: (entry.entity as { id: string }).id,
                  expectedRemoteVersion: entry.expected,
                  createdAt: r.product.updatedAt,
                  payload: entry.entity,
                })),
              }),
            initial = request([
              {
                type: "PRODUCT_UPSERT",
                entityType: "product",
                entity: r.product,
                expected: null,
              },
              {
                type: "PRODUCT_IDENTIFIER_UPSERT",
                entityType: "product_identifier",
                entity: r.identifier,
                expected: null,
              },
              {
                type: "PRODUCT_ALIAS_UPSERT",
                entityType: "product_alias",
                entity: r.alias,
                expected: null,
              },
            ]);
          expect(
            (
              await pushing.push(initial, "initial", s.scope.ownerId)
            ).results.every((result) => result.status === "APPLIED"),
          ).toBe(true);
          const concurrent = (
            await pushing.push(
              request([
                {
                  type: `${r.entityType.toUpperCase()}_UPSERT`,
                  entityType: r.entityType,
                  entity: r.remote,
                  expected: 1,
                },
              ]),
              "concurrent",
              s.scope.ownerId,
            )
          ).results[0]!;
          expect(concurrent).toMatchObject({
            status: "APPLIED",
            remoteVersion: 2,
          });
          const canonicalRemote = catalogueConflictSchemas[kind].parse(
            concurrent.remoteEntity,
          );
          await s.a.runAsync(
            "DELETE FROM sync_conflicts WHERE entity_id=?",
            r.local.id,
          );
          await s.a.runAsync(
            `UPDATE ${r.table} SET sync_state='PENDING' WHERE id=?`,
            r.local.id,
          );
          await s.a.runAsync(
            "UPDATE sync_outbox SET status='PENDING' WHERE command_id=?",
            r.command.commandId,
          );
          const sync = service(s.a, s.scope.deviceId);
          expect((await sync.push(s.scope.storeId)).conflicts).toBe(1);
          expect(
            s.db
              .prepare(`SELECT sync_state FROM ${r.table} WHERE id=?`)
              .get(r.local.id)!.sync_state,
          ).toBe("CONFLICT");
          const repository = new ProductMasterConflictRepository(
              s.a,
              receiptReviewDigest,
            ),
            review = await repository.review(s.scope.storeId, r.conflict.id);
          expect(review.canKeep).toBe(true);
          expect(review.canAdopt).toBe(true);
          expect(review.current.entity).toEqual(r.local);
          expect(review.remote).toEqual(canonicalRemote);
          if (deletion)
            await expect(
              repository.resolve(s.scope.storeId, r.conflict.id, local, {
                commandId: randomUUID(),
                deviceId: s.scope.deviceId,
                jobId: randomUUID(),
                reviewHash: review.hash,
                canResolve: () => true,
              }),
            ).rejects.toThrow("LOCAL_DELETION_CONFIRMATION_REQUIRED");
          await repository.resolve(s.scope.storeId, r.conflict.id, local, {
            commandId: randomUUID(),
            deviceId: s.scope.deviceId,
            jobId: randomUUID(),
            reviewHash: review.hash,
            confirmLocalDeletionChoice: deletion,
            canResolve: () => true,
          });
          expect((await sync.push(s.scope.storeId)).pushed).toBe(local ? 1 : 0);
          const otherSync = service(other, randomUUID());
          await otherSync.sync(s.scope.storeId);
          const repo = new ProductMasterRepository(other),
            restored =
              kind === "PRODUCT"
                ? await repo.getProduct(r.local.id)
                : kind === "IDENTIFIER"
                  ? await repo.getIdentifier(r.local.id)
                  : await repo.getAlias(r.local.id);
          if (deletion && local)
            expect(!restored || !!restored.entity.deletedAt).toBe(true);
          else {
            expect(restored!.syncState).toBe("SYNCED");
            expect(restored!.entity.createdAt).toBe(canonicalRemote.createdAt);
            expect(restored!.entity.version).toBe(local ? 3 : 2);
            if (kind === "ALIAS")
              expect((await repo.getAlias(r.local.id))!.entity.confidence).toBe(
                "confidence" in r.remote ? r.remote.confidence : null,
              );
          }
          expect(
            await new ConflictRepository(s.a).listOpen(s.scope.storeId),
          ).toEqual([]);
          expect(
            (await new OutboxRepository(s.a).getById(r.command.commandId))!
              .lastErrorCode,
          ).toBe("PRODUCT_MASTER_CONFLICT_SUPERSEDED");
          expect(s.count("product_master_conflict_history")).toBe(1);
          expect(
            [
              "source_documents",
              "waste_receipts",
              "waste_lines",
              "sales_observations",
              "waste_observations",
            ].map((t) =>
              s.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
            ),
          ).toEqual(source);
          expect((await sync.push(s.scope.storeId)).pushed).toBe(0);
          other.db.close();
          closed = true;
          const reopened = new DatabaseSync(path);
          try {
            const row = reopened
              .prepare(
                `SELECT * FROM ${catalogueConflictTables[kind]} WHERE id=?`,
              )
              .get(r.local.id);
            if (deletion && local) expect(!row || !!row.deleted_at).toBe(true);
            else expect(row!.version).toBe(local ? 3 : 2);
            expect(
              await new OutboxRepository(
                new ReceiptTestDatabase(reopened),
              ).listPending(s.scope.storeId),
            ).toEqual([]);
          } finally {
            reopened.close();
          }
        } finally {
          s.db.close();
          if (!closed) other.db.close();
          rmSync(dir, { recursive: true, force: true });
        }
      },
      60000,
    );
  },
);
