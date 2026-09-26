import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createMongoSyncPullService,
  SyncPullCursorError,
} from "../src/sync/pull-service.js";

describe("sync pull service", () => {
  it("rejects a malformed cursor before accessing persistence", async () => {
    let databaseAccessed = false;
    const service = createMongoSyncPullService({
      checkHealth: async () => "connected",
      getDb: async () => {
        databaseAccessed = true;
        throw new Error("database should not be accessed");
      },
      close: async () => undefined,
    });

    await expect(
      service.pull(randomUUID(), { cursor: "invalid-cursor", limit: 25 }),
    ).rejects.toBeInstanceOf(SyncPullCursorError);
    expect(databaseAccessed).toBe(false);
  });
});
