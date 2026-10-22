import { expect, it, vi } from "vitest";
import { runSyncPipeline } from "./sync-pipeline";
import type { SyncSummary } from "./sync-service";

const summary: SyncSummary = {
  pushed: 1,
  pulled: 2,
  failed: 0,
  conflicts: 0,
  cursor: "cursor",
  startedAt: "start",
  completedAt: "end",
};
it("shares uploads, repair, push/pull and recomputation across concurrent photo/manual/foreground triggers", async () => {
  const database = {},
    stages: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const work = vi.fn(async () => {
    stages.push("upload");
    await gate;
    stages.push("push", "pull", "recompute");
    return summary;
  });
  const first = runSyncPipeline(database, "owner", "store", work);
  const triggers = Array.from({ length: 93 }, () =>
    runSyncPipeline(database, "owner", "store", work),
  );
  expect(triggers.every((p) => p === first)).toBe(true);
  await Promise.resolve();
  expect(stages).toEqual(["upload"]);
  release();
  expect(await first).toEqual(summary);
  await Promise.all(triggers);
  expect(work).toHaveBeenCalledTimes(1);
  expect(stages).toEqual(["upload", "push", "pull", "recompute"]);
  await runSyncPipeline(database, "owner", "store", work);
  expect(work).toHaveBeenCalledTimes(2);
});
it("releases a failed cycle and never shares a cycle across databases, owners or stores", async () => {
  const db = {},
    work = vi.fn(async () => undefined);
  const failed = runSyncPipeline(db, "owner", "store", async () => {
    throw Error("offline");
  });
  await expect(failed).rejects.toThrow("offline");
  await runSyncPipeline(db, "owner", "store", work);
  await Promise.all([
    runSyncPipeline(db, "other", "store", work),
    runSyncPipeline(db, "owner", "other", work),
    runSyncPipeline({}, "owner", "store", work),
  ]);
  expect(work).toHaveBeenCalledTimes(4);
});
