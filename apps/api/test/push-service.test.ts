import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createMongoSyncPushService } from "../src/sync/push-service.js";

describe("sync push service", () => {
  it("returns a retryable per-command result when persistence is unavailable", async () => {
    const storeId = randomUUID();
    const deviceId = randomUUID();
    const entityId = randomUUID();
    const commandId = randomUUID();
    const timestamp = "2026-09-26T08:00:00.000Z";
    const service = createMongoSyncPushService({
      checkHealth: async () => "disconnected",
      getDb: async () => {
        throw new Error("private database failure");
      },
      close: async () => undefined,
    });

    const response = await service.push(
      {
        syncProtocolVersion: 1,
        appVersion: "0.1.0",
        deviceId,
        storeId,
        commands: [
          {
            commandId,
            localSequence: 1,
            type: "SYNC_TEST_ENTITY_UPSERT",
            entityType: "sync_test_entity",
            entityId,
            expectedRemoteVersion: null,
            createdAt: timestamp,
            payload: {
              id: entityId,
              storeId,
              label: "Poireaux",
              remoteVersion: 0,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          },
        ],
      },
      "request-id",
    );

    expect(response.results).toEqual([
      {
        commandId,
        status: "RETRYABLE_ERROR",
        entityType: "sync_test_entity",
        entityId,
        error: {
          code: "SYNC_TEMPORARILY_UNAVAILABLE",
          messageFr: "Cette commande n’a pas pu être synchronisée. Réessayez.",
          retryable: true,
          requestId: "request-id",
        },
      },
    ]);
    expect(JSON.stringify(response)).not.toContain("private database failure");
  });
});
