import { prepareVisualChatReview } from "../../../scripts/test-visual-chat-conflict-fixtures";
import { previewStoreConflict } from "../src/copilot/store-conflict-tool";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visualConflictKinds } from "../../../scripts/test-visual-conflict-fixtures";
import { receiptReviewDigest } from "../../../scripts/test-receipt-publication-sqlite";
import { VisualTestDatabase } from "../../../scripts/test-visual-sqlite";
import { runLocalMigrations } from "../../mobile/src/db/migrations";
import { VisualLibraryRepository } from "../../mobile/src/products/visual-library-repository";
import { VisualConflictRepository } from "../../mobile/src/products/visual-conflict-repository";
import { ConflictRepository } from "../../mobile/src/sync/conflict-repository";
import { OutboxRepository } from "../../mobile/src/sync/outbox-repository";
import { MobileSyncService } from "../../mobile/src/sync/sync-service";
import {
  bootstrapQuerySchema,
  syncPullQuerySchema,
  syncPushRequestSchema,
} from "@fl-copilot/sync-contracts";
import {
  visualEntitySchemas,
  type VisualEntityMap,
  type VisualEntityType,
} from "@fl-copilot/domain";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { isVisualEntityType, rebaseVisualChoice } from "@fl-copilot/domain";
import type { SyncPushRequest } from "@fl-copilot/sync-contracts";
import { visualLibraryFixture } from "../../../scripts/test-visual-library-fixtures";
import { createMongoDatabase } from "../src/database/mongo";
import { parseEnvironment } from "../src/config";
import type { DatabaseService } from "../src/database/types";
import { createMongoSyncPushService } from "../src/sync/push-service";
import { createMongoSyncPullService } from "../src/sync/pull-service";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "visual library metadata canonical sync",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `flc_visual_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
        }),
      );
      await database.getDb();
    }, 60000);
    afterAll(async () => {
      if (database)
        try {
          await (await database.getDb()).dropDatabase();
        } finally {
          await database.close();
        }
    }, 60000);
    const request = (
      f: ReturnType<typeof visualLibraryFixture>,
      commands: Array<{
        type: string;
        entityType: string;
        payload: { id: string; updatedAt: string } & Record<string, unknown>;
        expected?: number | null;
      }>,
    ): SyncPushRequest => ({
      syncProtocolVersion: 1,
      appVersion: "test",
      deviceId: f.deviceId,
      storeId: f.storeId,
      commands: commands.map((c, i) => ({
        commandId: randomUUID(),
        localSequence: i + 1,
        type: c.type,
        entityType: c.entityType,
        entityId: c.payload.id,
        expectedRemoteVersion: c.expected ?? null,
        createdAt: c.payload.updatedAt,
        payload: z.json().parse(c.payload),
      })),
    });
    async function initialize() {
      const f = visualLibraryFixture(),
        db = await database.getDb();
      await db.collection("storeMemberships").insertOne({
        storeId: f.storeId,
        userId: f.actorId,
        role: "MANAGER",
        active: true,
      });
      return { f, push: createMongoSyncPushService(database), db };
    }
    const entries = (f: ReturnType<typeof visualLibraryFixture>) => [
      { type: "PRODUCT_UPSERT", entityType: "product", payload: f.product },
      {
        type: "VISUAL_ASSET_UPSERT",
        entityType: "visual_asset",
        payload: f.asset,
      },
      {
        type: "VISUAL_IDENTITY_UPSERT",
        entityType: "visual_identity",
        payload: f.identity,
      },
      {
        type: "PRODUCT_VISUAL_LINK_UPSERT",
        entityType: "product_visual_link",
        payload: f.link,
      },
    ];
    for (const kind of visualConflictKinds)
      it.each([
        { local: true, chat: false },
        { local: false, chat: false },
        { local: true, chat: true },
        { local: false, chat: true },
      ])(
        `${kind} resolves a complete real group on its latest pull, restores metadata on another device and reopens offline (%j)`,
        async ({ local, chat }) => {
          const { f, push, db } = await initialize(),
            dir = mkdtempSync(join(tmpdir(), "fl-visual-mongo-")),
            path = join(dir, "restored.db"),
            a = new VisualTestDatabase(new DatabaseSync(":memory:")),
            b = new VisualTestDatabase(new DatabaseSync(":memory:")),
            c = new VisualTestDatabase(new DatabaseSync(path)),
            pull = createMongoSyncPullService(database),
            boot = createMongoSyncBootstrapService(database),
            bDevice = randomUUID(),
            cDevice = randomUUID();
          let cClosed = false;
          const synchronize = (device: VisualTestDatabase, deviceId: string) =>
            new MobileSyncService(
              device,
              {
                push: (r: SyncPushRequest) =>
                  push.push(r, randomUUID(), f.actorId),
                pull: (storeId: string, cursor: string) =>
                  pull.pull(
                    storeId,
                    syncPullQuerySchema.parse({
                      cursor,
                      visualLibrary: "true",
                    }),
                  ),
                bootstrap: () =>
                  boot.bootstrap(
                    {
                      storeId: f.storeId,
                      userId: f.actorId,
                      storeName: "Test",
                      role: "MANAGER",
                      sessionId: randomUUID(),
                      deviceId,
                    },
                    bootstrapQuerySchema.parse({ visualLibrary: "true" }),
                  ),
              },
              {
                deviceId,
                appVersion: "test",
                visualLibrary: true,
                copilotOwnerId: f.actorId,
              },
            ).sync(f.storeId);
          try {
            expect(
              (
                await push.push(request(f, entries(f)), "initial", f.actorId)
              ).results.every((r) => r.status === "APPLIED"),
            ).toBe(true);
            for (const device of [a, b, c]) await runLocalMigrations(device);
            await synchronize(a, f.deviceId);
            await synchronize(b, bDevice);
            const repoA = new VisualLibraryRepository(a),
              repoB = new VisualLibraryRepository(b),
              initial = visualEntitySchemas[kind].parse(
                kind === "visual_asset"
                  ? f.asset
                  : kind === "visual_identity"
                    ? f.identity
                    : f.link,
              ) as VisualEntityMap[VisualEntityType],
              remote = rebaseVisualChoice(
                kind,
                initial,
                initial,
                f.actorId,
                "2026-10-20T11:00:00.000Z",
              ),
              pending = rebaseVisualChoice(
                kind,
                initial,
                initial,
                f.actorId,
                "2026-10-20T12:00:00.000Z",
              );
            await repoA.save(kind, remote, {
              storeId: f.storeId,
              actorId: f.actorId,
              deviceId: f.deviceId,
              commandId: randomUUID(),
              expectedLocalVersion: 1,
              canWrite: true,
            });
            expect(await synchronize(a, f.deviceId)).toMatchObject({
              pushed: 1,
              conflicts: 0,
              failed: 0,
            });
            await repoB.save(kind, pending, {
              storeId: f.storeId,
              actorId: f.actorId,
              deviceId: bDevice,
              commandId: randomUUID(),
              expectedLocalVersion: 1,
              canWrite: true,
            });
            expect(await synchronize(b, bDevice)).toMatchObject({
              pushed: 0,
              conflicts: 1,
              failed: 0,
            });
            const first = (
                await new ConflictRepository(b).listOpenForEntity(
                  f.storeId,
                  kind,
                  initial.id,
                )
              )[0]!,
              original = (await new OutboxRepository(b).getById(
                first.commandId!,
              ))!,
              clone = await new OutboxRepository(b).enqueue({
                ...original,
                commandId: randomUUID(),
              });
            await new OutboxRepository(b).markSyncing(clone.commandId);
            const collision = await push.push(
              syncPushRequestSchema.parse({
                syncProtocolVersion: 1,
                appVersion: "test",
                deviceId: bDevice,
                storeId: f.storeId,
                commands: [
                  {
                    commandId: clone.commandId,
                    localSequence: clone.localSequence,
                    type: clone.commandType,
                    entityType: kind,
                    entityId: clone.entityId,
                    expectedRemoteVersion: clone.expectedRemoteVersion,
                    createdAt: clone.createdAt,
                    payload: clone.payload,
                  },
                ],
              }),
              "second-conflict",
              f.actorId,
            );
            expect(collision.results[0]).toMatchObject({
              status: "CONFLICT",
              remoteVersion: 2,
            });
            await new ConflictRepository(b).recordPushConflict(
              clone,
              collision.results[0]!,
            );
            await new OutboxRepository(b).markConflict(
              clone.commandId,
              "VISUAL_VERSION_CONFLICT",
            );
            const latest = rebaseVisualChoice(
              kind,
              remote,
              remote,
              f.actorId,
              "2026-10-20T14:00:00.000Z",
            );
            await repoA.save(kind, latest, {
              storeId: f.storeId,
              actorId: f.actorId,
              deviceId: f.deviceId,
              commandId: randomUUID(),
              expectedLocalVersion: 2,
              canWrite: true,
            });
            await synchronize(a, f.deviceId);
            await synchronize(b, bDevice);
            const conflicts = new VisualConflictRepository(
                b,
                receiptReviewDigest,
                () => "2026-10-20T15:00:00.000Z",
              ),
              review = await conflicts.review(f.storeId, first.id, f.actorId);
            expect(review.group.conflicts).toHaveLength(2);
            expect(review.remote).toEqual(latest);
            expect(review.canKeep).toBe(true);
            expect(review.canAdopt).toBe(true);
            let actionId: string = randomUUID();
            if (chat) {
              const copilotKind =
                kind === "visual_asset"
                  ? "VISUAL_ASSET"
                  : kind === "visual_identity"
                    ? "VISUAL_IDENTITY"
                    : "PRODUCT_VISUAL_LINK";
              const preview = await previewStoreConflict(db, f.storeId, {
                kind: copilotKind,
                entityId: initial.id,
              });
              expect(preview.basis.remoteVersion).toBe(3);
              const prepared = await prepareVisualChatReview(
                b,
                { storeId: f.storeId, ownerId: f.actorId, deviceId: bDevice },
                copilotKind,
                latest,
                preview,
              );
              expect(prepared.state.status).toBe("READY");
              expect(prepared.state.review!.visualReview!.remote).toEqual(
                latest,
              );
              const resolved = await prepared.controller.confirm(
                prepared.message,
                prepared.state.review!.basisHash,
                local ? "KEEP_LOCAL" : "ADOPT_REMOTE",
                true,
                undefined,
                { confirmVisualRights: true },
              );
              expect(resolved.status).toBe("COMPLETED");
              actionId = resolved.result!.commandId;
              expect(
                (
                  await prepared.controller.confirm(
                    prepared.message,
                    prepared.state.review!.basisHash,
                    local ? "KEEP_LOCAL" : "ADOPT_REMOTE",
                    true,
                    undefined,
                    { confirmVisualRights: true },
                  )
                ).result,
              ).toEqual(resolved.result);
            } else
              await conflicts.resolve(f.storeId, first.id, local, {
                actorId: f.actorId,
                deviceId: bDevice,
                commandId: actionId,
                reviewHash: review.hash,
                rightsConfirmed: true,
                canResolve: () => true,
              });
            await synchronize(b, bDevice);
            await synchronize(c, cDevice);
            const chosen = (await repoB.get(kind, f.storeId, initial.id))!,
              restored = (await new VisualLibraryRepository(c).get(
                kind,
                f.storeId,
                initial.id,
              ))!;
            expect(chosen.entity.version).toBe(local ? 4 : 3);
            expect(chosen.syncState).toBe("SYNCED");
            expect(restored.entity).toEqual(chosen.entity);
            expect(restored.remoteVersion).toBe(chosen.entity.version);
            expect(chosen.entity.createdBy).toBe(initial.createdBy);
            expect(chosen.entity.createdAt).toBe(initial.createdAt);
            expect(
              await new ConflictRepository(b).listOpenForEntity(
                f.storeId,
                kind,
                initial.id,
              ),
            ).toEqual([]);
            const history = await b.getFirstAsync<{
              local_json: string;
              remote_json: string;
            }>(
              "SELECT local_json,remote_json FROM visual_conflict_history WHERE action_id=?",
              actionId,
            );
            expect(JSON.parse(history!.local_json)).toEqual(pending);
            expect(JSON.parse(history!.remote_json)).toEqual(latest);
            const count = await db
              .collection("visualLibraryHistory")
              .countDocuments({
                storeId: f.storeId,
                entityType: kind,
                entityId: initial.id,
              });
            expect(count).toBe(local ? 4 : 3);
            await synchronize(b, bDevice);
            expect(
              await db.collection("visualLibraryHistory").countDocuments({
                storeId: f.storeId,
                entityType: kind,
                entityId: initial.id,
              }),
            ).toBe(count);
            c.raw.close();
            cClosed = true;
            const offline = new VisualTestDatabase(new DatabaseSync(path)),
              fetch = globalThis.fetch;
            globalThis.fetch = async () => {
              throw Error("OFFLINE");
            };
            try {
              expect(
                (await new VisualLibraryRepository(offline).get(
                  kind,
                  f.storeId,
                  initial.id,
                ))!.entity,
              ).toEqual(chosen.entity);
              expect(
                await new OutboxRepository(offline).listPending(f.storeId),
              ).toEqual([]);
            } finally {
              globalThis.fetch = fetch;
              offline.raw.close();
            }
          } finally {
            a.raw.close();
            b.raw.close();
            if (!cClosed) c.raw.close();
            rmSync(dir, { recursive: true, force: true });
          }
        },
      );
    it("persists explicit approved links idempotently and negotiates metadata for bootstrap/pull", async () => {
      const { f, push, db } = await initialize(),
        input = request(f, entries(f));
      expect(
        (await push.push(input, "save", f.actorId)).results.map(
          (r) => r.status,
        ),
      ).toEqual(["APPLIED", "APPLIED", "APPLIED", "APPLIED"]);
      expect(
        (await push.push(input, "replay", f.actorId)).results.map(
          (r) => r.status,
        ),
      ).toEqual([
        "ALREADY_APPLIED",
        "ALREADY_APPLIED",
        "ALREADY_APPLIED",
        "ALREADY_APPLIED",
      ]);
      expect(
        await db
          .collection("visualLibraryHistory")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(3);
      const store = {
        userId: f.actorId,
        sessionId: randomUUID(),
        deviceId: f.deviceId,
        storeId: f.storeId,
        storeName: "Test",
        role: "MANAGER",
      };
      const bootstrap = createMongoSyncBootstrapService(database);
      expect(
        (await bootstrap.bootstrap(store, { rawObservationDays: 90 })).entities
          .visualAssets,
      ).toBeUndefined();
      const snapshot = await bootstrap.bootstrap(store, {
        rawObservationDays: 90,
        visualLibrary: "true",
      });
      expect(snapshot.entities.visualAssets).toEqual([f.asset]);
      expect(snapshot.entities.visualIdentities).toEqual([f.identity]);
      expect(snapshot.entities.productVisualLinks).toEqual([f.link]);
      const pull = createMongoSyncPullService(database);
      expect(
        (await pull.pull(f.storeId, { limit: 500 })).changes.some((c) =>
          isVisualEntityType(c.entityType),
        ),
      ).toBe(false);
      expect(
        (
          await pull.pull(f.storeId, { limit: 500, visualLibrary: "true" })
        ).changes.filter((c) => isVisualEntityType(c.entityType)),
      ).toHaveLength(3);
      expect(
        await db
          .collection("salesObservations")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(0);
    }, 20000);
    it("reconciles simultaneous canonical creations without renaming IDs and bootstraps a removed link", async () => {
      const { f, push, db } = await initialize();
      await push.push(request(f, entries(f)), "first-device", f.actorId);
      const actor = randomUUID(),
        device = { ...f, deviceId: randomUUID() },
        at = "2026-10-20T12:00:00.000Z";
      await db.collection("storeMemberships").insertOne({
        storeId: f.storeId,
        userId: actor,
        role: "MANAGER",
        active: true,
      });
      const localAsset = {
        ...f.asset,
        createdBy: actor,
        updatedBy: actor,
        createdAt: at,
        updatedAt: at,
        provenance: {
          type: "USER_UPLOAD" as const,
          rights: "USER_CONFIRMED" as const,
          confirmedBy: actor,
          confirmedAt: at,
        },
        review: { ...f.asset.review, actorId: actor, at },
      };
      expect(
        (
          await push.push(
            request(device, [{ ...entries(f)[1]!, payload: localAsset }]),
            "simultaneous-asset",
            actor,
          )
        ).results[0],
      ).toMatchObject({ status: "CONFLICT", remoteEntity: f.asset });
      const rebased = rebaseVisualChoice(
        "visual_asset",
        localAsset,
        f.asset,
        actor,
        at,
      );
      expect(
        (
          await push.push(
            request(device, [
              { ...entries(f)[1]!, payload: rebased, expected: 1 },
            ]),
            "chosen-asset",
            actor,
          )
        ).results[0]?.status,
      ).toBe("APPLIED");
      expect(
        await db
          .collection("visualAssets")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(1);
      expect(
        await db.collection("visualAssets").findOne({ id: f.asset.id }),
      ).toMatchObject({
        id: f.asset.id,
        createdBy: f.actorId,
        updatedBy: actor,
        version: 2,
      });
      const localLink = {
        ...f.link,
        createdBy: actor,
        updatedBy: actor,
        createdAt: at,
        updatedAt: at,
        verifiedBy: actor,
        verifiedAt: at,
      };
      expect(
        (
          await push.push(
            request(device, [{ ...entries(f)[3]!, payload: localLink }]),
            "simultaneous-link",
            actor,
          )
        ).results[0]?.status,
      ).toBe("CONFLICT");
      const removed = {
        ...rebaseVisualChoice(
          "product_visual_link",
          localLink,
          f.link,
          actor,
          at,
        ),
        deletedAt: at,
      };
      expect(
        (
          await push.push(
            request(device, [
              { ...entries(f)[3]!, payload: removed, expected: 1 },
            ]),
            "removed-link",
            actor,
          )
        ).results[0]?.status,
      ).toBe("APPLIED");
      const snapshot = await createMongoSyncBootstrapService(
        database,
      ).bootstrap(
        {
          userId: actor,
          sessionId: randomUUID(),
          deviceId: device.deviceId,
          storeId: f.storeId,
          storeName: "Test",
          role: "MANAGER",
        },
        { rawObservationDays: 90, visualLibrary: "true" },
      );
      expect(snapshot.entities.productVisualLinks).toEqual([removed]);
      const restored = { ...removed, version: 3, deletedAt: null };
      expect(
        (
          await push.push(
            request(device, [
              { ...entries(f)[3]!, payload: restored, expected: 2 },
            ]),
            "restored-link",
            actor,
          )
        ).results[0]?.status,
      ).toBe("APPLIED");
      expect(
        await db
          .collection("productVisualLinks")
          .countDocuments({ storeId: f.storeId }),
      ).toBe(1);
    }, 20000);

    it("requires a fresh command after a terminal refusal and fresh rights before restoring an inert draft", async () => {
      const { f, push, db } = await initialize(),
        entry = entries(f)[1]!;
      await db
        .collection("storeMemberships")
        .updateOne({ storeId: f.storeId }, { $set: { role: "STAFF" } });
      const refused = request(f, [entry]);
      expect(
        (await push.push(refused, "refused", f.actorId)).results[0]?.error
          ?.code,
      ).toBe("VISUAL_ACCESS_INVALID");
      await db
        .collection("storeMemberships")
        .updateOne({ storeId: f.storeId }, { $set: { role: "MANAGER" } });
      expect(
        (await push.push(refused, "same-command", f.actorId)).results[0]
          ?.status,
      ).toBe("REJECTED");
      const retry = request(f, [entry]);
      expect(retry.commands[0]?.commandId).not.toBe(
        refused.commands[0]?.commandId,
      );
      expect(
        (await push.push(retry, "fresh-command", f.actorId)).results[0]?.status,
      ).toBe("APPLIED");
      expect(
        (await push.push(request(f, [entry]), "unknown-remote", f.actorId))
          .results[0]?.status,
      ).toBe("CONFLICT");

      const other = await initialize(),
        later = "2026-10-20T14:00:00.000Z";
      const tombstone = rebaseVisualChoice(
        "visual_asset",
        {
          ...other.f.asset,
          deletedAt: later,
          review: { status: "REVOKED", actorId: other.f.actorId, at: later },
        },
        null,
        other.f.actorId,
        later,
      );
      expect(tombstone.provenance).toEqual(other.f.asset.provenance);
      expect(
        (
          await other.push.push(
            request(other.f, [{ ...entries(other.f)[1]!, payload: tombstone }]),
            "retire-unused",
            other.f.actorId,
          )
        ).results[0]?.status,
      ).toBe("APPLIED");
      const withoutRights = {
        ...tombstone,
        version: 2,
        deletedAt: null,
        review: {
          status: "APPROVED" as const,
          actorId: other.f.actorId,
          at: later,
        },
      };
      expect(
        (
          await other.push.push(
            request(other.f, [
              { ...entries(other.f)[1]!, payload: withoutRights, expected: 1 },
            ]),
            "no-new-rights",
            other.f.actorId,
          )
        ).results[0]?.error?.code,
      ).toBe("VISUAL_RIGHTS_CONFIRMATION_INVALID");
      const confirmed = rebaseVisualChoice(
        "visual_asset",
        { ...other.f.asset, deletedAt: null },
        tombstone,
        other.f.actorId,
        later,
      );
      expect(
        (
          await other.push.push(
            request(other.f, [
              { ...entries(other.f)[1]!, payload: confirmed, expected: 1 },
            ]),
            "rights-confirmed",
            other.f.actorId,
          )
        ).results[0]?.status,
      ).toBe("APPLIED");
      expect(
        await db
          .collection("visualAssets")
          .countDocuments({ storeId: other.f.storeId }),
      ).toBe(1);
    }, 20000);

    it("refuses forged reviewers, inactive/nonmanager memberships and immutable binary replacement", async () => {
      const { f, push, db } = await initialize();
      const forged = { ...f.asset, updatedBy: randomUUID() };
      expect(
        (
          await push.push(
            request(f, [{ ...entries(f)[1]!, payload: forged }]),
            "forged",
            f.actorId,
          )
        ).results[0]?.status,
      ).toBe("REJECTED");
      await db
        .collection("storeMemberships")
        .updateOne({ storeId: f.storeId }, { $set: { role: "STAFF" } });
      expect(
        (await push.push(request(f, [entries(f)[1]!]), "staff", f.actorId))
          .results[0]?.error?.code,
      ).toBe("VISUAL_ACCESS_INVALID");
      await db
        .collection("storeMemberships")
        .updateOne(
          { storeId: f.storeId },
          { $set: { role: "MANAGER", active: false } },
        );
      expect(
        (await push.push(request(f, [entries(f)[1]!]), "inactive", f.actorId))
          .results[0]?.error?.code,
      ).toBe("VISUAL_ACCESS_INVALID");
      await db
        .collection("storeMemberships")
        .updateOne({ storeId: f.storeId }, { $set: { active: true } });
      expect(
        (await push.push(request(f, [entries(f)[1]!]), "create", f.actorId))
          .results[0]?.status,
      ).toBe("APPLIED");
      const mutated = { ...f.asset, version: 2, width: 501 };
      expect(
        (
          await push.push(
            request(f, [{ ...entries(f)[1]!, payload: mutated, expected: 1 }]),
            "mutate",
            f.actorId,
          )
        ).results[0]?.error?.code,
      ).toBe("VISUAL_BINARY_IMMUTABLE");
    }, 20000);
    it("keeps same-hash and active-product uniqueness, refuses foreign parents, and exposes two-device conflicts", async () => {
      const { f, push } = await initialize();
      await push.push(request(f, entries(f)), "setup", f.actorId);
      expect(
        (
          await push.push(
            request(f, [
              { ...entries(f)[1]!, payload: { ...f.asset, id: randomUUID() } },
            ]),
            "same-binary",
            f.actorId,
          )
        ).results[0]?.error?.code,
      ).toBe("VISUAL_ID_INVALID");
      expect(
        (
          await push.push(
            request(f, [
              { ...entries(f)[3]!, payload: { ...f.link, id: randomUUID() } },
            ]),
            "same-product",
            f.actorId,
          )
        ).results[0]?.error?.code,
      ).toBe("VISUAL_ID_INVALID");
      const first = {
        ...f.asset,
        version: 2,
        review: { ...f.asset.review, status: "REVOKED" as const },
      };
      expect(
        (
          await push.push(
            request(f, [{ ...entries(f)[1]!, payload: first, expected: 1 }]),
            "device-a",
            f.actorId,
          )
        ).results[0]?.status,
      ).toBe("APPLIED");
      expect(
        (
          await push.push(
            request(f, [
              {
                ...entries(f)[1]!,
                payload: { ...f.asset, version: 2 },
                expected: 1,
              },
            ]),
            "device-b",
            f.actorId,
          )
        ).results[0],
      ).toMatchObject({
        status: "CONFLICT",
        remoteEntity: { review: { status: "REVOKED" } },
      });
      const foreign = await initialize();
      await foreign.push.push(
        request(foreign.f, [entries(foreign.f)[1]!]),
        "foreign-asset",
        foreign.f.actorId,
      );
      expect(
        (
          await push.push(
            request(f, [
              {
                ...entries(f)[2]!,
                payload: {
                  ...f.identity,
                  id: randomUUID(),
                  primaryAssetId: foreign.f.asset.id,
                },
              },
            ]),
            "foreign-parent",
            f.actorId,
          )
        ).results[0]?.error?.code,
      ).toBe("VISUAL_TARGET_UNAVAILABLE");
    }, 20000);
  },
);
