import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service";
import { bootstrapQuerySchema } from "@fl-copilot/sync-contracts";
import { runLocalMigrations } from "../../mobile/src/db/migrations";
import { applyBootstrap } from "../../mobile/src/sync/apply-bootstrap";
import { AllocationSqliteAdapter } from "../../../scripts/test-physical-allocation-sqlite";
import { LayoutIllustrationRepository } from "../../mobile/src/copilot/layout-illustration-repository";
import {
  LayoutIllustrationTransfer,
  type LayoutIllustrationFilePort,
} from "../../mobile/src/copilot/layout-illustration-transfer";
import { illustrationDigest } from "../../../scripts/test-layout-illustration-preparations";
import { sourceOriginalHash } from "../../mobile/src/documents/source-original-hash";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import type { Document } from "mongodb";
import { createMongoDatabase } from "../src/database/mongo";
import { parseEnvironment } from "../src/config";
import type { DatabaseService } from "../src/database/types";
import {
  createLayoutIllustrationFiles,
  layoutIllustrationObjectKey,
} from "../src/copilot/layout-illustration-files";
import { illustrationAssetsFixture } from "../../../scripts/test-layout-illustration-assets";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "private immutable illustration bundles",
  () => {
    let database: DatabaseService, root: string;
    beforeAll(async () => {
      root = await mkdtemp(join(tmpdir(), "fl-illustration-blobs-"));
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `fl_illustration_files_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
        }),
      );
      await database.getDb();
    }, 60000);
    afterAll(async () => {
      try {
        await (await database.getDb()).dropDatabase();
      } finally {
        await database.close();
        await rm(root, { recursive: true, force: true });
      }
    }, 60000);
    async function seed() {
      const f = await illustrationAssetsFixture(),
        db = await database.getDb();
      const put = (
        name: string,
        id: string,
        payload: Record<string, unknown>,
      ) =>
        db
          .collection<Document & { _id: string }>(name)
          .insertOne({ _id: id, ...payload });
      await put("storeMemberships", randomUUID(), {
        storeId: f.scope.storeId,
        userId: f.scope.ownerId,
        active: true,
        role: "MANAGER",
      });
      await put("copilotConversations", f.conversation.id, f.conversation);
      for (const m of [f.user, f.assistant, f.card])
        await put("copilotMessages", m.id, m);
      await put("storeLayoutRevisions", f.reference.revisionId, {
        id: f.reference.revisionId,
        storeId: f.scope.storeId,
        plan: f.reference,
        version: 1,
      });
      await put("copilotLayoutIllustrations", f.preparation.id, f.preparation);
      let fail: string | undefined;
      const keys: string[] = [];
      const storage = {
        read: async (key: string, max: number) => {
          try {
            const b = new Uint8Array(await readFile(join(root, key)));
            if (b.length > max) throw Error("TEST_OVERSIZE");
            return b;
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
            throw e;
          }
        },
        writeImmutable: async (key: string, bytes: Uint8Array) => {
          if (fail && key.includes(fail))
            throw Error("TEST_UPLOAD_INTERRUPTED");
          const path = join(root, key);
          await mkdir(dirname(path), { recursive: true });
          try {
            await writeFile(path, bytes, { flag: "wx" });
            keys.push(key);
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
            expect(new Uint8Array(await readFile(path))).toEqual(bytes);
          }
        },
      };
      const service = createLayoutIllustrationFiles(database, storage),
        scope = { storeId: f.scope.storeId, userId: f.scope.ownerId };
      return {
        ...f,
        dbMongo: db,
        scopeFiles: scope,
        service,
        storage,
        keys,
        fail: (v: string | undefined) => (fail = v),
      };
    }
    it("retains all original/source/result bytes and one exact manifest across duplicate completion and a restarted service", async () => {
      const f = await seed();
      try {
        const m = await f.service.persist(
          f.scopeFiles,
          f.preparation.id,
          f.manifest.id,
          f.output,
          f.manifest.createdAt,
        );
        expect(m).toEqual(f.manifest);
        expect(
          await f.service.persist(
            f.scopeFiles,
            f.preparation.id,
            m.id,
            f.output,
            m.createdAt,
          ),
        ).toEqual(m);
        expect(f.keys.length).toBe(4);
        const restarted = createLayoutIllustrationFiles(database, f.storage);
        expect(
          await restarted.manifest(f.scopeFiles, f.preparation.id),
        ).toEqual({ state: "READY", manifest: m });
        for (const v of ["source", "original", "image", "data"] as const)
          expect(
            (await restarted.read(f.scopeFiles, f.preparation.id, m.id, v))
              .bytes,
          ).toEqual(f.bytes[v]);
        await f.dbMongo
          .collection<Document & { _id: string }>("storeMemberships")
          .updateOne(
            { storeId: f.scope.storeId, userId: f.scope.ownerId },
            { $set: { role: "STAFF" } },
          );
        const snapshot = await createMongoSyncBootstrapService(
          database,
        ).bootstrap(
          {
            ...f.scopeFiles,
            role: "STAFF",
            storeName: "Test",
            deviceId: randomUUID(),
            sessionId: randomUUID(),
          },
          bootstrapQuerySchema.parse({
            copilotHistory: "true",
            layoutIllustrations: "true",
          }),
          true,
          true,
        );
        const path = join(root, `cold-${randomUUID()}.sqlite`),
          dbB = new DatabaseSync(path),
          a = new AllocationSqliteAdapter(dbB);
        const filename = (id: string, v: string) =>
          join(root, "native", f.scope.storeId, f.scope.ownerId, id, v);
        const filePort: LayoutIllustrationFilePort = {
          existing: async (manifest, v) => {
            const path = filename(manifest.id, v);
            try {
              const b = new Uint8Array(await readFile(path));
              if (
                b.length !== manifest.files[v].sizeBytes ||
                sourceOriginalHash(b) !== manifest.files[v].checksum
              )
                throw Error("TEST_CACHE_INVALID");
              return pathToFileURL(path).href;
            } catch (e) {
              if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
              throw e;
            }
          },
          write: async (manifest, v, bytes, check) => {
            check();
            const path = filename(manifest.id, v);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, bytes);
            check();
            return pathToFileURL(path).href;
          },
        };
        const transport = {
          manifest: (storeId: string, id: string) =>
            restarted.manifest({ ...f.scopeFiles, storeId }, id),
          download: async (
            storeId: string,
            manifest: typeof m,
            v: keyof typeof m.files,
          ) =>
            (
              await restarted.read(
                { ...f.scopeFiles, storeId },
                manifest.preparation.id,
                manifest.id,
                v,
              )
            ).bytes,
        };
        let closed = false;
        try {
          await runLocalMigrations(a);
          await applyBootstrap(a, f.scope.storeId, snapshot, f.scope.ownerId);
          const repository = new LayoutIllustrationRepository(
              a,
              { ...f.scope, canPrepare: false },
              illustrationDigest,
            ),
            transfer = new LayoutIllustrationTransfer(
              a,
              repository,
              transport,
              filePort,
              () => f.scopeFiles,
            );
          expect(await transfer.load(f.card)).toBeNull();
          const view = await transfer.refresh(f.card, true);
          expect(view?.manifest).toEqual(m);
          expect(view?.imageUri).toContain(m.id);
          expect(view?.originalUri).toContain(m.id);
          dbB.close();
          closed = true;
          const reopened = new DatabaseSync(path),
            b = new AllocationSqliteAdapter(reopened);
          try {
            const offline = new LayoutIllustrationTransfer(
              b,
              new LayoutIllustrationRepository(
                b,
                { ...f.scope, canPrepare: false },
                illustrationDigest,
              ),
              {
                manifest: async () => {
                  throw Error("OFFLINE");
                },
                download: async () => {
                  throw Error("OFFLINE");
                },
              },
              filePort,
              () => f.scopeFiles,
            );
            expect(await offline.load(f.card)).toEqual(view);
            expect(await b.getAllAsync("SELECT * FROM sync_outbox")).toEqual(
              [],
            );
          } finally {
            reopened.close();
          }
        } finally {
          if (!closed) dbB.close();
        }
        expect(m.files.original.checksum).not.toBe(m.files.image.checksum);
        expect(
          await f.dbMongo
            .collection("copilotLayoutIllustrationFiles")
            .countDocuments({ preparationId: f.preparation.id }),
        ).toBe(1);
      } finally {
        f.db.close();
      }
    });
    it("does not publish a partial bundle and resumes its immutable writes without invoking an image provider", async () => {
      const f = await seed();
      try {
        f.fail("/image-");
        await expect(
          f.service.persist(
            f.scopeFiles,
            f.preparation.id,
            f.manifest.id,
            f.output,
            f.manifest.createdAt,
          ),
        ).rejects.toThrow("TEST_UPLOAD_INTERRUPTED");
        expect(
          await f.service.manifest(f.scopeFiles, f.preparation.id),
        ).toEqual({ state: "EMPTY", preparationId: f.preparation.id });
        f.fail(undefined);
        const restarted = createLayoutIllustrationFiles(database, f.storage);
        await restarted.recover(f.scopeFiles, f.preparation.id, f.manifest.id);
        expect(
          (await restarted.manifest(f.scopeFiles, f.preparation.id)).state,
        ).toBe("READY");
        expect(f.keys.length).toBe(4);
      } finally {
        f.db.close();
      }
    });
    it("retains an uncertain checkpoint when the original was never conserved; recovery must never create a replacement image", async () => {
      const f = await seed();
      try {
        f.fail("/original-");
        await expect(
          f.service.persist(
            f.scopeFiles,
            f.preparation.id,
            f.manifest.id,
            f.output,
            f.manifest.createdAt,
          ),
        ).rejects.toThrow("TEST_UPLOAD_INTERRUPTED");
        f.fail(undefined);
        const restarted = createLayoutIllustrationFiles(database, f.storage);
        await expect(
          restarted.recover(f.scopeFiles, f.preparation.id, f.manifest.id),
        ).rejects.toThrow("LAYOUT_ILLUSTRATION_RESULT_UNCERTAIN");
        expect(
          (await restarted.manifest(f.scopeFiles, f.preparation.id)).state,
        ).toBe("EMPTY");
        expect(f.keys).toEqual([]);
      } finally {
        f.db.close();
      }
    });
    it("archives already-produced bytes after role revocation/deletion but refuses every private read, foreign owner and store", async () => {
      const f = await seed();
      try {
        await f.dbMongo
          .collection<Document & { _id: string }>("storeMemberships")
          .updateOne(
            { storeId: f.scope.storeId, userId: f.scope.ownerId },
            { $set: { active: false } },
          );
        await f.dbMongo
          .collection<Document & { _id: string }>("copilotConversations")
          .updateOne(
            { _id: f.conversation.id },
            { $set: { deletedMessageIds: [f.user.id] } },
          );
        await f.service.persist(
          f.scopeFiles,
          f.preparation.id,
          f.manifest.id,
          f.output,
          f.manifest.createdAt,
        );
        for (const scope of [
          f.scopeFiles,
          { ...f.scopeFiles, userId: randomUUID() },
          { ...f.scopeFiles, storeId: randomUUID() },
        ]) {
          await expect(
            f.service.manifest(scope, f.preparation.id),
          ).rejects.toMatchObject({
            publicCode: "LAYOUT_ILLUSTRATION_UNAVAILABLE",
          });
          await expect(
            f.service.read(scope, f.preparation.id, f.manifest.id, "original"),
          ).rejects.toMatchObject({
            publicCode: "LAYOUT_ILLUSTRATION_UNAVAILABLE",
          });
        }
      } finally {
        f.db.close();
      }
    });
    it("refuses a changed result or corrupt stored bytes instead of rebinding the illustration", async () => {
      const f = await seed();
      try {
        await f.service.persist(
          f.scopeFiles,
          f.preparation.id,
          f.manifest.id,
          f.output,
          f.manifest.createdAt,
        );
        await expect(
          f.service.persist(
            f.scopeFiles,
            f.preparation.id,
            f.manifest.id,
            {
              ...f.output,
              binding: {
                ...f.output.binding,
                physicalHash: `sha256:${"a".repeat(64)}`,
              },
            },
            f.manifest.createdAt,
          ),
        ).rejects.toThrow("INVALID");
        const key = layoutIllustrationObjectKey(f.manifest, "image");
        await writeFile(join(root, key), new Uint8Array([0]));
        await expect(
          f.service.read(
            f.scopeFiles,
            f.preparation.id,
            f.manifest.id,
            "image",
          ),
        ).rejects.toThrow("INVALID");
      } finally {
        f.db.close();
      }
    });
  },
);
