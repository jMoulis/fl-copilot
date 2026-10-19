import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import sharp from "sharp";
import { expect, it, vi } from "vitest";
import { visualLibraryFixture } from "../../../scripts/test-visual-library-fixtures";
import type { DatabaseService } from "../src/database/types";
import {
  createVisualFileService,
  type VisualFileStorage,
} from "../src/products/visual-file-service";
import { visualBytesHash } from "../src/products/visual-image-normalization";
type Row = Record<string, unknown>;
function matches(row: Row, query: Row): boolean {
  return Object.entries(query).every(([key, value]) => {
    if (key === "$or") return (value as Row[]).some((q) => matches(row, q));
    if (value && typeof value === "object" && !(value instanceof Date))
      return Object.entries(value).every(([op, v]) => {
        if (op === "$ne") return row[key] !== v;
        if (op === "$in") return (v as unknown[]).includes(row[key]);
        if (op === "$gt") return (row[key] as Date) > v;
        if (op === "$lte") return (row[key] as Date) <= v;
        throw Error(`Unsupported test operator ${op}`);
      });
    return row[key] === value;
  });
}
/** Logic double only; replica-set transaction/index verification lives in the integration suite. */
class MemoryDatabase implements DatabaseService {
  rows = new Map<string, Row[]>();
  failCommit = false;
  transactions = 0;
  data(name: string) {
    if (!this.rows.has(name)) this.rows.set(name, []);
    return this.rows.get(name)!;
  }
  async checkHealth() {
    return "connected" as const;
  }
  async close() {}
  async getDb() {
    return {
      collection: (name: string) => ({
        findOne: async (q: Row) =>
          this.data(name).find((r) => matches(r, q)) ?? null,
        insertOne: async (r: Row) => {
          this.data(name).push(structuredClone(r));
          return { acknowledged: true };
        },
        updateOne: async (
          q: Row,
          u: { $set?: Row; $setOnInsert?: Row },
          o?: { upsert?: boolean },
        ) => {
          let r = this.data(name).find((r) => matches(r, q));
          const matchedCount = r ? 1 : 0;
          if (!r && o?.upsert) {
            r = { ...q, ...structuredClone(u.$setOnInsert ?? {}) };
            this.data(name).push(r);
          }
          if (r && u.$set) Object.assign(r, structuredClone(u.$set));
          return { matchedCount };
        },
        find: (q: Row) => {
          let rows = this.data(name).filter((r) => matches(r, q));
          const cursor = {
            sort: () => cursor,
            limit: (n: number) => {
              rows = rows.slice(0, n);
              return cursor;
            },
            toArray: async () => rows,
          };
          return cursor;
        },
      }),
      client: {
        startSession: () => ({
          withTransaction: async (fn: () => Promise<void>) => {
            const before = structuredClone(this.rows);
            this.transactions++;
            try {
              await fn();
              if (this.failCommit) throw Error("TEST_COMMIT_LOST");
            } catch (e) {
              this.rows = before;
              throw e;
            }
          },
          endSession: async () => {},
        }),
      },
    } as unknown as Db;
  }
}
async function setup() {
  const f = visualLibraryFixture();
  const bytes = new Uint8Array(
    await sharp({
      create: { width: 32, height: 16, channels: 3, background: "#e9b640" },
    })
      .png()
      .toBuffer(),
  );
  f.asset = {
    ...f.asset,
    mimeType: "image/png",
    width: 32,
    height: 16,
    sizeBytes: bytes.byteLength,
    contentHash: visualBytesHash(bytes),
  };
  const database = new MemoryDatabase();
  database.data("visualAssets").push({ ...f.asset, _id: f.asset.id });
  database.data("storeMemberships").push({
    storeId: f.storeId,
    userId: f.actorId,
    role: "MANAGER",
    active: true,
  });
  const objects = new Map<string, Uint8Array>();
  let cleanupFails = false,
    time = new Date(f.at);
  const storage: VisualFileStorage = {
    uploadUrl: vi.fn(async (key) => `https://private.example.test/${key}`),
    read: vi.fn(async (key, max) => {
      const b = objects.get(key);
      if (b && b.byteLength > max) throw Error("VISUAL_FILE_TOO_LARGE");
      return b ?? null;
    }),
    writeImmutable: vi.fn(async (key, b) => {
      const old = objects.get(key);
      if (old && visualBytesHash(old) !== visualBytesHash(b))
        throw Error("TEST_IMMUTABLE");
      objects.set(key, b.slice());
    }),
    removeStaging: vi.fn(async (key) => {
      if (cleanupFails) throw Error("TEST_STORAGE_OFFLINE");
      objects.delete(key);
    }),
  };
  const service = createVisualFileService(
    database,
    storage,
    undefined,
    () => time,
  );
  const context = { storeId: f.storeId, userId: f.actorId, role: "MANAGER" };
  async function upload() {
    const init = await service.init(context, f.asset.id);
    expect(init.state).toBe("UPLOAD_REQUIRED");
    const row = database
      .data("visualAssetUploads")
      .find((r) => r._id === init.uploadId)!;
    objects.set(row.stagingKey as string, bytes.slice());
    return { ...init, row };
  }
  return {
    f,
    bytes,
    database,
    objects,
    storage,
    service,
    context,
    upload,
    setCleanupFails: (v: boolean) => {
      cleanupFails = v;
    },
    tick: () => {
      time = new Date(time.getTime() + 11 * 60 * 1000);
    },
  };
}
it("keeps original bytes private, creates a safe preview and confirms idempotently without repeating normalization", async () => {
  const s = await setup(),
    init = await s.upload();
  const retry = await s.service.init(s.context, s.f.asset.id);
  expect(retry.uploadId).toBe(init.uploadId);
  expect(s.storage.uploadUrl).toHaveBeenCalledWith(
    init.row.stagingKey,
    "image/png",
    s.bytes.byteLength,
    expect.any(Number),
  );
  const manifest = await s.service.complete(
    s.context,
    s.f.asset.id,
    init.uploadId!,
  );
  expect(manifest.preview).toMatchObject({
    mimeType: "image/jpeg",
    width: 32,
    height: 16,
  });
  const source = await s.service.read(s.context, s.f.asset.id, "source");
  expect(source.bytes).toEqual(s.bytes);
  const preview = await s.service.read(s.context, s.f.asset.id, "preview");
  expect((await sharp(preview.bytes).metadata()).format).toBe("jpeg");
  const writes = vi.mocked(s.storage.writeImmutable).mock.calls.length;
  expect(
    await s.service.complete(s.context, s.f.asset.id, init.uploadId!),
  ).toEqual(manifest);
  expect(await s.service.init(s.context, s.f.asset.id)).toMatchObject({
    state: "READY",
    manifest,
    uploadUrl: null,
  });
  expect(vi.mocked(s.storage.writeImmutable).mock.calls.length).toBe(writes);
  expect(s.database.data("visualAssetFiles")).toHaveLength(1);
  expect(s.objects.has(init.row.stagingKey as string)).toBe(false);
  expect(s.database.data("sourceDocuments")).toHaveLength(0);
  expect(s.database.data("localJobs")).toHaveLength(0);
});
it("retains the staging original after a failed DB commit and resumes without overwriting a verified binary", async () => {
  const s = await setup(),
    init = await s.upload();
  s.database.failCommit = true;
  await expect(
    s.service.complete(s.context, s.f.asset.id, init.uploadId!),
  ).rejects.toThrow("TEST_COMMIT_LOST");
  expect(s.database.data("visualAssetFiles")).toHaveLength(0);
  expect(s.storage.removeStaging).not.toHaveBeenCalled();
  expect(s.objects.has(init.row.stagingKey as string)).toBe(true);
  s.database.failCommit = false;
  expect(
    await s.service.complete(s.context, s.f.asset.id, init.uploadId!),
  ).toMatchObject({ assetId: s.f.asset.id });
  expect(s.database.data("visualAssetFiles")).toHaveLength(1);
});
it("does not turn cleanup failure into publication failure, and retries cleanup even after the signed token expired", async () => {
  const s = await setup(),
    init = await s.upload();
  s.setCleanupFails(true);
  const manifest = await s.service.complete(
    s.context,
    s.f.asset.id,
    init.uploadId!,
  );
  expect(s.objects.has(init.row.stagingKey as string)).toBe(true);
  s.setCleanupFails(false);
  s.tick();
  expect(await s.service.init(s.context, s.f.asset.id)).toMatchObject({
    state: "READY",
    manifest,
  });
  expect(s.objects.has(init.row.stagingKey as string)).toBe(false);
});
it.each(["missing", "corrupt", "oversized", "expired"])(
  "rejects a %s upload without confirming or deleting the original",
  async (kind) => {
    const s = await setup(),
      init = await s.upload(),
      key = init.row.stagingKey as string;
    if (kind === "missing") s.objects.delete(key);
    if (kind === "corrupt")
      s.objects.set(key, new Uint8Array(s.bytes.byteLength));
    if (kind === "oversized")
      s.objects.set(key, new Uint8Array(s.bytes.byteLength + 1));
    if (kind === "expired") s.tick();
    await expect(
      s.service.complete(s.context, s.f.asset.id, init.uploadId!),
    ).rejects.toMatchObject({
      publicCode:
        kind === "missing"
          ? "VISUAL_FILE_MISSING"
          : kind === "expired"
            ? "VISUAL_UPLOAD_EXPIRED"
            : "VISUAL_FILE_INVALID",
    });
    expect(s.database.data("visualAssetFiles")).toHaveLength(0);
    expect(s.storage.removeStaging).not.toHaveBeenCalled();
    if (kind === "corrupt" || kind === "oversized")
      expect(s.database.data("visualAssetUploads")[0]?.status).toBe("INVALID");
  },
);
it("checks current membership and approval again before committing or returning private bytes", async () => {
  const s = await setup(),
    init = await s.upload();
  vi.mocked(s.storage.writeImmutable).mockImplementationOnce(async () => {
    s.database.data("storeMemberships")[0]!.active = false;
  });
  await expect(
    s.service.complete(s.context, s.f.asset.id, init.uploadId!),
  ).rejects.toMatchObject({ statusCode: 403 });
  expect(s.database.data("visualAssetFiles")).toHaveLength(0);
  expect(s.storage.removeStaging).not.toHaveBeenCalled();
  s.database.data("storeMemberships")[0]!.active = true;
  await s.service.complete(s.context, s.f.asset.id, init.uploadId!);
  const normal = s.storage.read;
  vi.mocked(s.storage.read).mockImplementationOnce(async (key, max) => {
    s.database.data("visualAssets")[0]!.review = {
      status: "REVOKED",
      actorId: s.f.actorId,
      at: s.f.at,
    };
    return normal(key, max);
  });
  await expect(
    s.service.read(s.context, s.f.asset.id, "preview"),
  ).rejects.toMatchObject({ publicCode: "VISUAL_REVIEW_REQUIRED" });
});
it("isolates stores and upload owners; staff may read approved files but cannot send one", async () => {
  const s = await setup(),
    init = await s.upload();
  await expect(
    s.service.complete(
      { ...s.context, userId: randomUUID() },
      s.f.asset.id,
      init.uploadId!,
    ),
  ).rejects.toMatchObject({ statusCode: 403 });
  await expect(
    s.service.init({ ...s.context, storeId: randomUUID() }, s.f.asset.id),
  ).rejects.toMatchObject({ statusCode: 403 });
  const other = randomUUID();
  s.database.data("storeMemberships").push({
    storeId: s.f.storeId,
    userId: other,
    role: "MANAGER",
    active: true,
  });
  await expect(
    s.service.complete(
      { ...s.context, userId: other },
      s.f.asset.id,
      init.uploadId!,
    ),
  ).rejects.toMatchObject({ publicCode: "VISUAL_UPLOAD_UNAVAILABLE" });
  await s.service.complete(s.context, s.f.asset.id, init.uploadId!);
  s.database.data("storeMemberships")[0]!.role = "STAFF";
  await expect(s.service.init(s.context, s.f.asset.id)).rejects.toMatchObject({
    statusCode: 403,
  });
  expect(await s.service.manifest(s.context, s.f.asset.id)).toMatchObject({
    assetId: s.f.asset.id,
  });
  s.database.data("visualAssetFiles")[0]!.sourceKey =
    "stores/another/private.png";
  await expect(
    s.service.read(s.context, s.f.asset.id, "source"),
  ).rejects.toThrow("VISUAL_STORED_FILE_INVALID");
});
