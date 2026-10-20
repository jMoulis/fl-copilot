import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  serializeSourceOriginalMetadata,
  type SourceOriginalManifest,
} from "@fl-copilot/sync-contracts";
import { VisualTestDatabase } from "../../../../scripts/test-visual-sqlite";
import { runLocalMigrations } from "../db/migrations";
import {
  SourceOriginalTransfer,
  type SourceOriginalProof,
  type SourceOriginalSession,
} from "./source-original-transfer";
import { SourceOriginalJobs } from "./source-original-jobs";
import { readPendingWork } from "../sync/pending-work";
const hash = (text: string) =>
  `sha256:${createHash("sha256").update(text).digest("hex")}`;
async function fixture() {
  const db = new VisualTestDatabase(new DatabaseSync(":memory:"));
  await runLocalMigrations(db);
  const actorId = randomUUID(),
    storeId = randomUUID(),
    sourceId = randomUUID();
  const metadata = {
    schemaVersion: 1 as const,
    sourceDocumentId: sourceId,
    storeId,
    sourceType: "MERCALYS_SALES" as const,
    access: "STORE" as const,
    ownerId: null,
    filename: "ventes.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const,
    sizeBytes: 100,
    checksum: `sha256:${"a".repeat(64)}`,
    registeredAt: "2026-10-20T12:00:00.000Z",
    objectVersion: "version",
  };
  const manifest: SourceOriginalManifest = {
    ...metadata,
    manifestHash: hash(serializeSourceOriginalMetadata(metadata)),
  };
  let scope: SourceOriginalSession | null = { storeId, userId: actorId },
    time = new Date("2026-10-20T13:00:00Z");
  const session = () => scope;
  const proof: SourceOriginalProof = {
    localUri: `file:///app/source-originals/${storeId}/${actorId}/${sourceId}/original.xlsx`,
    views: null,
  };
  const files = {
    hash: async (text: string) => hash(text),
    existing: vi.fn(async () => proof as SourceOriginalProof | null),
    receive: vi.fn(async () => proof),
  };
  const api = {
    download: vi.fn(async () => ({
      manifest,
      url: "https://test.private.blob.vercel-storage.com/file?secret=test-only",
      expiresAt: "2026-10-20T13:02:00Z",
    })),
    manifest: vi.fn(async () => manifest),
  };
  const makeTransfer = () =>
    new SourceOriginalTransfer(db, api, files, session, randomUUID, () => time);
  const transfer = makeTransfer(),
    jobs = new SourceOriginalJobs(
      db,
      transfer,
      session,
      randomUUID,
      () => time,
    );
  async function seed(status = "CONFIRMED") {
    await db.runAsync(
      "INSERT INTO source_documents(id,store_id,source_type,checksum,local_file_uri,local_processing_status,remote_upload_status,version,created_at,updated_at,sync_state,dirty) VALUES(?,?,?,?,'file:///original.xlsx','PUBLISHED',?,7,?,?,'PENDING',1)",
      sourceId,
      storeId,
      manifest.sourceType,
      manifest.checksum,
      status,
      metadata.registeredAt,
      metadata.registeredAt,
    );
    await db.runAsync(
      "UPDATE source_documents SET original_filename=? WHERE id=?",
      metadata.filename,
      sourceId,
    );
    await db.runAsync(
      "INSERT INTO local_files(id,store_id,source_document_id,local_uri,mime_type,size_bytes,checksum,retention_status,upload_status,created_at,updated_at) VALUES(?,?,?,'file:///original.xlsx',?,?,?,'RETAINED',?,?,?)",
      randomUUID(),
      storeId,
      sourceId,
      manifest.mimeType,
      manifest.sizeBytes,
      manifest.checksum,
      status,
      metadata.registeredAt,
      metadata.registeredAt,
    );
  }
  return {
    db,
    actorId,
    storeId,
    sourceId,
    manifest,
    files,
    api,
    proof,
    transfer,
    jobs,
    makeTransfer,
    seed,
    session,
    changeScope: (s: typeof scope) => {
      scope = s;
    },
    advance: (ms: number) => {
      time = new Date(time.getTime() + ms);
    },
  };
}
it("recovers a missing manifest/file without fabricating a source publication, preserves UUID, and reads the verified copy offline after worker restart", async () => {
  const f = await fixture();
  try {
    await expect(f.transfer.recover(f.sourceId)).resolves.toEqual(f.proof);
    expect(f.files.receive).toHaveBeenCalledTimes(1);
    expect(
      await f.db.getFirstAsync("SELECT * FROM source_documents"),
    ).toBeNull();
    expect(await f.db.getFirstAsync("SELECT * FROM sync_outbox")).toBeNull();
    expect(await f.db.getFirstAsync("SELECT * FROM source_records")).toBeNull();
    const cache = await f.db.getFirstAsync<{ manifest_json: string }>(
      "SELECT manifest_json FROM source_original_manifests",
    );
    expect(JSON.parse(cache!.manifest_json)).toEqual(f.manifest);
    expect(cache!.manifest_json).not.toContain("secret");
    f.api.download.mockRejectedValue(Error("OFFLINE"));
    f.api.manifest.mockRejectedValue(Error("OFFLINE"));
    await expect(f.makeTransfer().recover(f.sourceId)).resolves.toEqual(
      f.proof,
    );
    expect(f.api.download).toHaveBeenCalledTimes(1);
  } finally {
    f.db.raw.close();
  }
});
it("keeps existing local originals and business state, file IDs and unsynchronized edits intact", async () => {
  const f = await fixture();
  try {
    await f.seed();
    const before = await f.db.getFirstAsync<Record<string, unknown>>(
      "SELECT * FROM source_documents",
    );
    const id = (await f.db.getFirstAsync<{ id: string }>(
      "SELECT id FROM local_files",
    ))!.id;
    f.files.existing.mockResolvedValue({
      localUri: "file:///original.xlsx",
      views: null,
    });
    await f.transfer.recover(f.sourceId);
    expect(f.files.receive).not.toHaveBeenCalled();
    expect(f.api.download).not.toHaveBeenCalled();
    expect(await f.db.getFirstAsync("SELECT * FROM source_documents")).toEqual(
      before,
    );
    expect(
      (await f.db.getFirstAsync<{ id: string }>("SELECT id FROM local_files"))!
        .id,
    ).toBe(id);
  } finally {
    f.db.raw.close();
  }
});
it.each(["pending", "binding", "owner", "withdrawn", "changed", "cancel"])(
  "preserves prior references on %s failure around network/commit",
  async (mode) => {
    const f = await fixture();
    try {
      await f.seed(mode === "pending" ? "PENDING" : "CONFIRMED");
      const before = await f.db.getFirstAsync("SELECT * FROM local_files");
      f.files.existing.mockResolvedValue(null);
      if (mode === "binding")
        f.api.download.mockImplementation(async () => ({
          manifest: { ...f.manifest, storeId: randomUUID() },
          url: "https://test.private.blob.vercel-storage.com/file",
          expiresAt: "2026-10-20T13:02:00Z",
        }));
      if (mode === "owner")
        f.files.receive.mockImplementation(async () => {
          f.changeScope({ storeId: f.storeId, userId: randomUUID() });
          return f.proof;
        });
      if (mode === "withdrawn")
        f.api.manifest.mockRejectedValue(Error("SOURCE_ORIGINAL_UNAVAILABLE"));
      if (mode === "changed")
        f.files.receive.mockImplementation(async () => {
          await f.db.runAsync(
            "UPDATE source_documents SET local_file_uri='file:///new-local-original.xlsx'",
          );
          return f.proof;
        });
      await expect(
        f.transfer.recover(
          f.sourceId,
          mode === "cancel"
            ? async (tx) => {
                if (tx) throw Error("CANCELLED");
              }
            : undefined,
        ),
      ).rejects.toThrow();
      expect(await f.db.getFirstAsync("SELECT * FROM local_files")).toEqual(
        before,
      );
      expect(
        await f.db.getFirstAsync("SELECT * FROM source_original_manifests"),
      ).toBeNull();
      expect(await f.db.getFirstAsync("SELECT * FROM sync_outbox")).toBeNull();
      if (mode === "pending") expect(f.api.download).not.toHaveBeenCalled();
    } finally {
      f.db.raw.close();
    }
  },
);
it("deduplicates durable requests, scopes their visibility and resumes a network retry with a fresh lease", async () => {
  const f = await fixture();
  try {
    await f.jobs.request(f.sourceId);
    await f.jobs.request(f.sourceId);
    expect((await f.db.getAllAsync("SELECT * FROM local_jobs")).length).toBe(1);
    f.api.download.mockRejectedValueOnce(Error("NETWORK_INTERRUPTED"));
    await f.jobs.process(f.storeId, f.actorId);
    expect(
      await f.db.getFirstAsync("SELECT status FROM local_jobs"),
    ).toMatchObject({ status: "RETRY" });
    const resumed = new SourceOriginalJobs(
      f.db,
      f.makeTransfer(),
      f.session,
      randomUUID,
      () => new Date("2026-10-20T13:01:01Z"),
    );
    await resumed.process(f.storeId, f.actorId);
    expect(
      await f.db.getFirstAsync("SELECT status FROM local_jobs"),
    ).toMatchObject({ status: "COMPLETED" });
    expect(f.api.download).toHaveBeenCalledTimes(2);
    expect(f.files.receive).toHaveBeenCalledTimes(1);
    await f.jobs.request(f.sourceId);
    expect(await readPendingWork(f.db, f.storeId, randomUUID())).toEqual([]);
    expect(await readPendingWork(f.db, f.storeId, f.actorId)).toMatchObject([
      { label: "Récupération des originaux", count: 1 },
    ]);
  } finally {
    f.db.raw.close();
  }
});
it("does not commit a cancelled active recovery or automatically rearm a failed request", async () => {
  const f = await fixture();
  try {
    await f.jobs.request(f.sourceId);
    f.files.receive.mockImplementation(async () => {
      await f.jobs.cancel(f.sourceId);
      return f.proof;
    });
    await f.jobs.process(f.storeId, f.actorId);
    expect(
      await f.db.getFirstAsync("SELECT status FROM local_jobs"),
    ).toMatchObject({ status: "CANCELLED" });
    expect(
      await f.db.getFirstAsync("SELECT * FROM source_original_manifests"),
    ).toBeNull();
    await f.jobs.request(f.sourceId, true);
    f.files.receive.mockRejectedValue(Error("SOURCE_ORIGINAL_FILE_INVALID"));
    await f.jobs.process(f.storeId, f.actorId);
    expect(
      await f.db.getFirstAsync("SELECT status FROM local_jobs"),
    ).toMatchObject({ status: "FAILED" });
    await f.jobs.request(f.sourceId);
    expect(
      await f.db.getFirstAsync("SELECT status FROM local_jobs"),
    ).toMatchObject({ status: "FAILED" });
    await f.jobs.request(f.sourceId, true);
    expect(
      await f.db.getFirstAsync("SELECT status FROM local_jobs"),
    ).toMatchObject({ status: "PENDING" });
  } finally {
    f.db.raw.close();
  }
});
it("rolls back all file references on an interrupted cache commit and retains the downloaded immutable copy", async () => {
  const f = await fixture();
  try {
    await f.seed();
    f.files.existing.mockResolvedValue(null);
    const source = await f.db.getFirstAsync("SELECT * FROM source_documents"),
      original = await f.db.getFirstAsync("SELECT * FROM local_files");
    await f.db.execAsync(
      "CREATE TRIGGER original_cache_failure BEFORE INSERT ON source_original_manifests BEGIN SELECT RAISE(ABORT,'storage interrupted'); END;",
    );
    await expect(f.transfer.recover(f.sourceId)).rejects.toThrow(
      "storage interrupted",
    );
    expect(f.files.receive).toHaveBeenCalledTimes(1);
    expect(await f.db.getFirstAsync("SELECT * FROM local_files")).toEqual(
      original,
    );
    expect(await f.db.getFirstAsync("SELECT * FROM source_documents")).toEqual(
      source,
    );
    expect(
      await f.db.getFirstAsync("SELECT * FROM source_original_manifests"),
    ).toBeNull();
  } finally {
    f.db.raw.close();
  }
});
