/** Isolated protocol proof. No real AI generation, reviewer, Blob account or physical phone. */
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../../packages/api-client/src/index";
import { visualPilotFixture } from "../../../scripts/test-visual-pilot-fixtures";
import { VisualTestDatabase } from "../../../scripts/test-visual-sqlite";
import { createMongoDatabase } from "../src/database/mongo";
import { parseEnvironment } from "../src/config";
import { buildApp } from "../src/build-app";
import { AuthError, type AuthService } from "../src/auth/service";
import {
  createVisualFileService,
  type VisualFileStorage,
} from "../src/products/visual-file-service";
import {
  createPilotRun,
  runPilotImport,
  pilotPushPacket,
  pilotHash,
  recordPilotMobileReview,
  type VisualPilotApi,
  type PilotRun,
} from "../src/development/visual-pilot-import";
import { runLocalMigrations } from "../../mobile/src/db/migrations";
import { MobileSyncService } from "../../mobile/src/sync/sync-service";
import { VisualLibraryRepository } from "../../mobile/src/products/visual-library-repository";
import { VisualFileCache } from "../../mobile/src/products/visual-file-cache";
import { VisualFileTransfer } from "../../mobile/src/products/visual-file-transfer";
import { VisualFileJobs } from "../../mobile/src/products/visual-file-jobs";
import type { VisualFileStorage as NativeStorage } from "../../mobile/src/products/visual-file-storage-port";
import { visualFilePath } from "../../mobile/src/products/visual-file-cache";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "administrative import through canonical HTTP → Mongo → SQLite/file cache",
  () => {
    const database = createMongoDatabase(
      parseEnvironment({
        NODE_ENV: "test",
        MONGODB_URI: uri,
        MONGODB_DATABASE: `flc_pilot_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      }),
    );
    afterAll(async () => {
      try {
        await (await database.getDb()).dropDatabase();
      } finally {
        await database.close();
        vi.unstubAllGlobals();
      }
    }, 60000);
    it("imports a test illustration once, verifies original/manifest, survives a lost ACK, and restores it through the real mobile sync/cache code over restart", async () => {
      const s = await visualPilotFixture(),
        db = await database.getDb(),
        objects = new Map<string, Uint8Array>();
      await db.collection("storeMemberships").insertOne({
        storeId: s.f.storeId,
        userId: s.f.actorId,
        role: "MANAGER",
        active: true,
      });
      const storage: VisualFileStorage = {
        uploadUrl: async (pathname) =>
          `https://vercel.com/api/blob/?pathname=${encodeURIComponent(pathname)}&signature=TEST_ONLY`,
        read: async (key) => objects.get(key) ?? null,
        writeImmutable: async (key, bytes) => {
          const old = objects.get(key);
          if (old && pilotHash(old) !== pilotHash(bytes))
            throw Error("IMMUTABLE");
          objects.set(key, bytes.slice());
        },
        removeStaging: async (key) => {
          objects.delete(key);
        },
      };
      const auth: AuthService = {
        requestChallenge: vi.fn(),
        verifyChallenge: vi.fn(),
        refreshSession: vi.fn(),
        logout: vi.fn(),
        authorizeStore: async (token, storeId, deviceId) => {
          if (
            token !== "ISOLATED_TEST_SESSION" ||
            storeId !== s.f.storeId ||
            (deviceId && deviceId !== s.f.deviceId)
          )
            throw new AuthError(403, "STORE_FORBIDDEN", "Test scope");
          return {
            storeId,
            userId: s.f.actorId,
            deviceId: s.f.deviceId,
            sessionId: randomUUID(),
            storeName: "Isolated test",
            role: "MANAGER",
          };
        },
      };
      const app = buildApp(parseEnvironment({ NODE_ENV: "test" }), {
        database,
        auth,
        visualFiles: createVisualFileService(database, storage),
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string | URL, init?: RequestInit) => {
          const parsed = new URL(url);
          if (parsed.origin === "https://vercel.com") {
            expect(init?.method).toBe("PUT");
            expect(init?.headers).toEqual({ "content-type": "image/png" });
            expect(init?.redirect).toBe("error");
            objects.set(
              parsed.searchParams.get("pathname")!,
              new Uint8Array(init?.body as Buffer),
            );
            return new Response(null, { status: 200 });
          }
          expect(parsed.origin).toBe("https://isolated-api.test");
          const response = await app.inject({
            method: (init?.method ?? "GET") as "GET" | "POST",
            url: parsed.pathname + parsed.search,
            headers: init?.headers as Record<string, string>,
            ...(init?.body ? { payload: String(init.body) } : {}),
          });
          return new Response(new Uint8Array(response.rawPayload), {
            status: response.statusCode,
            headers: response.headers as Record<string, string>,
          });
        }),
      );
      const client = new ApiClient("https://isolated-api.test"),
        token = "ISOLATED_TEST_SESSION";
      const api: VisualPilotApi = {
        snapshot: () => client.visualLibrarySnapshot(token, s.f.storeId),
        push: (commands) =>
          client.pushSync(token, pilotPushPacket(s.scope, commands)),
        init: (id) => client.initVisualFile(token, s.f.storeId, id),
        complete: (id, upload) =>
          client.completeVisualFile(token, s.f.storeId, id, upload),
        manifest: (id) => client.visualFileManifest(token, s.f.storeId, id),
        download: (manifest, variant) =>
          client.downloadVisualFile(token, s.f.storeId, manifest, variant),
        put: async (url, bytes, headers) => {
          const response = await fetch(url, {
            method: "PUT",
            headers,
            body: Buffer.from(bytes),
            redirect: "error",
          });
          if (!response.ok) throw Error("PUT_FAILED");
        },
      };
      let native: VisualTestDatabase | undefined;
      try {
        const productCommand = {
          commandId: randomUUID(),
          localSequence: 1,
          type: "PRODUCT_UPSERT",
          entityType: "product",
          entityId: s.f.product.id,
          expectedRemoteVersion: null,
          createdAt: s.f.at,
          payload: s.f.product,
        };
        expect((await api.push([productCommand])).results[0]?.status).toBe(
          "APPLIED",
        );
        const run = await createPilotRun({
          root: s.root,
          input: s.input,
          scope: s.scope,
          api,
          visualKey: "tomato_round",
          review: async (d) => d.digest,
        });
        const realPush = api.push;
        let loseAck = true;
        api.push = async (commands) => {
          const ack = await realPush(commands);
          if (loseAck) {
            loseAck = false;
            throw Error("TEST_LOST_ACK_AFTER_COMMIT");
          }
          return ack;
        };
        let journal: PilotRun | undefined;
        const options = {
          root: s.root,
          input: s.input,
          scope: s.scope,
          api,
          run,
          persist: async (r: PilotRun) => {
            journal = structuredClone(r);
          },
        };
        await expect(runPilotImport(options)).rejects.toThrow(
          "TEST_LOST_ACK_AFTER_COMMIT",
        );
        expect(journal?.assetCommand?.commandId).toBe(
          run.assetCommand?.commandId,
        );
        const result = await runPilotImport({ ...options, run: journal! });
        expect(result.phase).toBe("AWAITING_MOBILE");
        expect(
          await db
            .collection("visualAssets")
            .countDocuments({ storeId: s.f.storeId }),
        ).toBe(1);
        expect(
          await db
            .collection("visualLibraryHistory")
            .countDocuments({ storeId: s.f.storeId }),
        ).toBe(3);
        const manifest = await api.manifest(result.asset.id);
        expect(manifest.source.contentHash).toBe(pilotHash(s.bytes));
        expect(manifest.preview.mimeType).toBe("image/jpeg");
        expect(await api.download(manifest, "source")).toEqual(
          new Uint8Array(s.bytes),
        );
        const sqlitePath = join(s.root, "second-device.sqlite"),
          cached = new Map<string, Uint8Array>();
        const nativeFiles: NativeStorage = {
          capture: async () => {
            throw Error("NOT_USED");
          },
          read: async (store, variant, d) => {
            const bytes = cached.get(
              visualFilePath(store, variant, d.mimeType, d.contentHash),
            );
            if (
              !bytes ||
              pilotHash(bytes) !== d.contentHash ||
              bytes.length !== d.sizeBytes
            )
              throw Error("CACHE_INVALID");
            return bytes;
          },
          write: async (store, variant, d, bytes) => {
            expect(pilotHash(bytes)).toBe(d.contentHash);
            const relativePath = visualFilePath(
              store,
              variant,
              d.mimeType,
              d.contentHash,
            );
            cached.set(relativePath, bytes.slice());
            return {
              relativePath,
              contentHash: d.contentHash,
              sizeBytes: bytes.length,
            };
          },
          uri: async (store, variant, d) =>
            cached.has(
              visualFilePath(store, variant, d.mimeType, d.contentHash),
            )
              ? `test-cache://${d.contentHash}`
              : null,
          removeCached: async () => {},
          upload: async () => {
            throw Error("READER_MUST_NOT_UPLOAD");
          },
        };
        native = new VisualTestDatabase(new DatabaseSync(sqlitePath));
        await runLocalMigrations(native);
        const sync = new MobileSyncService(
          native,
          {
            bootstrap: () => api.snapshot(),
            pull: async (store, cursor) => {
              const args: Parameters<ApiClient["pullSync"]> = [
                token,
                store,
                cursor,
              ];
              args[29] = true;
              return client.pullSync(...args);
            },
            push: async () => {
              throw Error("NO_LOCAL_WRITES");
            },
          },
          {
            appVersion: "test",
            deviceId: randomUUID(),
            copilotOwnerId: s.f.actorId,
            visualLibrary: true,
          },
        );
        await sync.sync(s.f.storeId);
        expect(
          (
            await new VisualLibraryRepository(native).get(
              "product_visual_link",
              s.f.storeId,
              result.link.id,
            )
          )?.entity,
        ).toEqual(result.link);
        const transfer = new VisualFileTransfer(
          native,
          {
            init: (_store, id) => api.init(id),
            complete: (_store, id, upload) => api.complete(id, upload),
            manifest: (_store, id) => api.manifest(id),
            download: (_store, m, variant) => api.download(m, variant),
          },
          nativeFiles,
          () => ({
            storeId: s.f.storeId,
            userId: s.f.actorId,
            canWrite: false,
          }),
        );
        const jobs = new VisualFileJobs(
          native,
          transfer,
          () => ({
            storeId: s.f.storeId,
            userId: s.f.actorId,
            canWrite: false,
          }),
          randomUUID,
        );
        await jobs.requestPreview(s.f.storeId, s.f.actorId, result.asset.id);
        expect(await jobs.process(s.f.storeId, s.f.actorId)).toMatchObject({
          failed: 0,
        });
        native.raw.close();
        native = new VisualTestDatabase(new DatabaseSync(sqlitePath));
        expect(
          (
            await new VisualLibraryRepository(native).get(
              "visual_asset",
              s.f.storeId,
              result.asset.id,
            )
          )?.entity,
        ).toEqual(result.asset);
        const cachedProof = await new VisualFileCache(native).get(
          s.f.storeId,
          result.asset,
          "PREVIEW",
        );
        expect(cachedProof?.manifest).toEqual(manifest);
        expect(
          await nativeFiles.uri(
            s.f.storeId,
            "PREVIEW",
            cachedProof!.manifest!.preview,
          ),
        ).toBeTruthy();
        await expect(
          createPilotRun({
            root: s.root,
            input: s.input,
            scope: s.scope,
            api,
            visualKey: "avocado_hass",
            firstRun: result,
            review: async (d) => d.digest,
          }),
        ).rejects.toThrow("PILOT_FIRST_MOBILE_REVIEW_REQUIRED");
        await expect(
          recordPilotMobileReview({
            api,
            run: result,
            scope: s.scope,
            screenshotRoot: s.root,
            screenshotFile: "test-only.png",
            confirm: async (d) => d,
          }),
        ).rejects.toThrow("PILOT_MOBILE_SCREENSHOT_REQUIRED");
      } finally {
        native?.raw.close();
        await app.close();
        vi.unstubAllGlobals();
        await rm(s.root, { recursive: true, force: true });
      }
    }, 60000);
  },
);
