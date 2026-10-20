import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { ApiClientError } from "@fl-copilot/api-client";
import { visualLibraryFixture } from "../../../../scripts/test-visual-library-fixtures";
import { VisualTestDatabase } from "../../../../scripts/test-visual-sqlite";
import { runLocalMigrations } from "../db/migrations";
import { readPendingWork } from "../sync/pending-work";
import { VisualFileJobs, enqueueVisualFileJob } from "./visual-file-jobs";
import type { VisualFileSession } from "./visual-file-transfer";
async function setup() {
  const db = new VisualTestDatabase(new DatabaseSync(":memory:"));
  await runLocalMigrations(db);
  const f = visualLibraryFixture();
  await db.runAsync(
    "INSERT INTO visual_assets(id,store_id,content_hash,payload_json,remote_payload_json,remote_version,sync_state,dirty) VALUES(?,?,?,?,?,1,'SYNCED',0)",
    f.asset.id,
    f.storeId,
    f.asset.contentHash,
    JSON.stringify(f.asset),
    JSON.stringify(f.asset),
  );
  let session: VisualFileSession | null = {
      storeId: f.storeId,
      userId: f.actorId,
      canWrite: true,
    },
    time = new Date(f.at);
  const transfer = {
    send: vi.fn(async () => ({}) as never),
    fetchPreview: vi.fn(async () => ({}) as never),
  };
  const jobs = new VisualFileJobs(
    db,
    transfer,
    () => session,
    randomUUID,
    () => time,
  );
  const payload = {
    storeId: f.storeId,
    ownerId: f.actorId,
    assetId: f.asset.id,
    sourceHash: f.asset.contentHash,
    variant: "UPLOAD" as const,
  };
  const queue = () =>
    db.withExclusiveTransactionAsync(async (tx) => {
      await enqueueVisualFileJob(tx, payload, randomUUID, time.toISOString());
    });
  return {
    db,
    f,
    jobs,
    transfer,
    queue,
    payload,
    setSession: (s: typeof session) => {
      session = s;
    },
    advance: (ms: number) => {
      time = new Date(time.getTime() + ms);
    },
    newWorker: () =>
      new VisualFileJobs(
        db,
        transfer,
        () => session,
        randomUUID,
        () => time,
      ),
  };
}
it("deduplicates durable jobs and runs upload followed by preview without creating receipt analysis work", async () => {
  const s = await setup();
  try {
    await s.queue();
    await s.queue();
    expect(s.db.raw.prepare("SELECT COUNT(*) n FROM local_jobs").get()!.n).toBe(
      1,
    );
    expect(await s.jobs.process(s.f.storeId, s.f.actorId)).toEqual({
      completed: 2,
      failed: 0,
      retry: 0,
    });
    expect(s.transfer.send).toHaveBeenCalledTimes(1);
    expect(s.transfer.fetchPreview).toHaveBeenCalledTimes(1);
    expect(
      s.db.raw.prepare("SELECT status,type FROM local_jobs").all(),
    ).toEqual([
      { status: "COMPLETED", type: "VISUAL_FILE_TRANSFER" },
      { status: "COMPLETED", type: "VISUAL_FILE_TRANSFER" },
    ]);
  } finally {
    s.db.raw.close();
  }
});
it("persists backoff across worker recreation and lets an explicit retry restart the preserved job", async () => {
  const s = await setup();
  try {
    await s.queue();
    s.transfer.send.mockRejectedValueOnce(
      new ApiClientError(0, {
        code: "NETWORK_UNAVAILABLE",
        messageFr: "Réseau indisponible",
        retryable: true,
      }),
    );
    expect(await s.jobs.process(s.f.storeId, s.f.actorId)).toMatchObject({
      retry: 1,
    });
    expect(
      s.db.raw
        .prepare("SELECT status,last_error,next_attempt_at FROM local_jobs")
        .get(),
    ).toEqual({
      status: "RETRY",
      last_error: "NETWORK_UNAVAILABLE",
      next_attempt_at: "2026-10-20T10:01:00.000Z",
    });
    const restarted = s.newWorker();
    expect(await restarted.process(s.f.storeId, s.f.actorId)).toEqual({
      completed: 0,
      failed: 0,
      retry: 0,
    });
    expect(s.transfer.send).toHaveBeenCalledTimes(1);
    await restarted.retry(s.f.storeId, s.f.actorId, s.f.asset.id);
    expect(await restarted.process(s.f.storeId, s.f.actorId)).toMatchObject({
      completed: 2,
    });
  } finally {
    s.db.raw.close();
  }
});
it("does not repeatedly process a permanent missing original, and exposes it in the existing pending-work UI", async () => {
  const s = await setup();
  try {
    await s.queue();
    s.transfer.send.mockRejectedValueOnce(Error("VISUAL_SOURCE_FILE_MISSING"));
    expect(await s.jobs.process(s.f.storeId, s.f.actorId)).toMatchObject({
      failed: 1,
    });
    s.advance(60 * 60_000);
    await s.newWorker().process(s.f.storeId, s.f.actorId);
    expect(s.transfer.send).toHaveBeenCalledTimes(1);
    expect(
      await readPendingWork(s.db, s.f.storeId, s.f.actorId),
    ).toContainEqual({
      label: "Images des produits",
      count: 1,
      state: "Échec à examiner",
      code: "VISUAL_SOURCE_FILE_MISSING",
    });
    expect(await readPendingWork(s.db, s.f.storeId, randomUUID())).toEqual([]);
  } finally {
    s.db.raw.close();
  }
});
it("coalesces simultaneous pumps and recovers a genuinely stale running job after reopening", async () => {
  const s = await setup();
  try {
    await s.queue();
    let release: () => void = () => {};
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    s.transfer.send.mockImplementationOnce(async () => {
      await wait;
      return {} as never;
    });
    const a = s.jobs.process(s.f.storeId, s.f.actorId),
      b = s.jobs.process(s.f.storeId, s.f.actorId);
    expect(a).toBe(b);
    release();
    await a;
    expect(s.transfer.send).toHaveBeenCalledTimes(1);
    await s.db.runAsync(
      "UPDATE local_jobs SET status='RUNNING' WHERE json_extract(payload_json,'$.variant')='UPLOAD'",
    );
    expect(await s.newWorker().process(s.f.storeId, s.f.actorId)).toMatchObject(
      { completed: 0 },
    );
    s.advance(6 * 60_000);
    expect(await s.newWorker().process(s.f.storeId, s.f.actorId)).toMatchObject(
      { completed: 2 },
    );
  } finally {
    s.db.raw.close();
  }
});
it("stops on logout and never acknowledges the previous owner’s work under the next account", async () => {
  const s = await setup();
  try {
    await s.queue();
    s.transfer.send.mockImplementationOnce(async () => {
      s.setSession(null);
      return {} as never;
    });
    await expect(s.jobs.process(s.f.storeId, s.f.actorId)).rejects.toThrow(
      "VISUAL_SCOPE_CHANGED",
    );
    expect(s.db.raw.prepare("SELECT status FROM local_jobs").get()).toEqual({
      status: "RUNNING",
    });
    const other = randomUUID();
    s.setSession({ storeId: s.f.storeId, userId: other, canWrite: true });
    expect(await s.newWorker().process(s.f.storeId, other)).toEqual({
      completed: 0,
      failed: 0,
      retry: 0,
    });
    expect(s.transfer.fetchPreview).not.toHaveBeenCalled();
  } finally {
    s.db.raw.close();
  }
});

it("starts backoff after a slow interrupted transfer rather than retrying the same large file immediately", async () => {
  const s = await setup();
  try {
    await s.queue();
    s.transfer.send.mockImplementationOnce(async () => {
      s.advance(2 * 60_000);
      throw new ApiClientError(0, {
        code: "NETWORK_UNAVAILABLE",
        messageFr: "Réseau",
        retryable: true,
      });
    });
    expect(await s.jobs.process(s.f.storeId, s.f.actorId)).toMatchObject({
      retry: 1,
      completed: 0,
    });
    expect(s.transfer.send).toHaveBeenCalledTimes(1);
    expect(
      s.db.raw.prepare("SELECT next_attempt_at FROM local_jobs").get()!
        .next_attempt_at,
    ).toBe("2026-10-20T10:03:00.000Z");
  } finally {
    s.db.raw.close();
  }
});

it("coalesces thumbnail requests, preserves retry deadlines and terminal errors, and rearms a completed preview for cache repair", async () => {
  const s = await setup();
  try {
    const request = () =>
      s.jobs.requestPreview(s.f.storeId, s.f.actorId, s.f.asset.id);
    await request();
    await request();
    expect(s.db.raw.prepare("SELECT COUNT(*) n FROM local_jobs").get()!.n).toBe(
      1,
    );
    s.transfer.fetchPreview.mockRejectedValueOnce(
      new ApiClientError(0, {
        code: "NETWORK_UNAVAILABLE",
        messageFr: "Réseau indisponible",
        retryable: true,
      }),
    );
    await s.jobs.process(s.f.storeId, s.f.actorId);
    const retry = s.db.raw.prepare("SELECT * FROM local_jobs").get();
    await request();
    expect(s.db.raw.prepare("SELECT * FROM local_jobs").get()).toEqual(retry);
    await s.newWorker().process(s.f.storeId, s.f.actorId);
    expect(s.transfer.fetchPreview).toHaveBeenCalledTimes(1);
    s.advance(60_000);
    s.transfer.fetchPreview.mockRejectedValueOnce(Error("VISUAL_FILE_INVALID"));
    await s.jobs.process(s.f.storeId, s.f.actorId);
    const failed = s.db.raw.prepare("SELECT * FROM local_jobs").get();
    expect(failed).toMatchObject({ status: "FAILED", attempt_count: 2 });
    await request();
    expect(s.db.raw.prepare("SELECT * FROM local_jobs").get()).toEqual(failed);
    s.advance(60 * 60_000);
    await s.newWorker().process(s.f.storeId, s.f.actorId);
    expect(s.transfer.fetchPreview).toHaveBeenCalledTimes(2);
    await s.jobs.retry(s.f.storeId, s.f.actorId, s.f.asset.id);
    await s.jobs.process(s.f.storeId, s.f.actorId);
    expect(s.transfer.fetchPreview).toHaveBeenCalledTimes(3);
    // The display has detected a missing/corrupt physical file after completion.
    await request();
    await request();
    expect(s.db.raw.prepare("SELECT COUNT(*) n FROM local_jobs").get()!.n).toBe(
      1,
    );
    await s.newWorker().process(s.f.storeId, s.f.actorId);
    expect(s.transfer.fetchPreview).toHaveBeenCalledTimes(4);
    expect(
      s.db.raw.prepare("SELECT status FROM local_jobs").get()!.status,
    ).toBe("COMPLETED");
  } finally {
    s.db.raw.close();
  }
});
