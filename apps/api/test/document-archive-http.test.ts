import { randomUUID } from "node:crypto";
import { it, expect, vi } from "vitest";
import { buildApp } from "../src/build-app";
import { parseEnvironment } from "../src/config";
import type { AuthService } from "../src/auth/service";

it.each(["MANAGER", "VIEWER"] as const)(
  "binds personal archive writes and history to the authenticated account (%s)",
  async (role) => {
    const ownerId = randomUUID(),
      storeId = randomUUID(),
      deviceId = randomUUID(),
      id = randomUUID(),
      at = "2026-10-31T08:00:00.000Z";
    const push = vi.fn(async () => ({ results: [], serverTime: at }));
    const pull = vi.fn(async () => ({
      changes: [],
      nextCursor: "next",
      hasMore: false,
      serverTime: at,
      documentArchives: true as const,
    }));
    const app = buildApp(parseEnvironment({ NODE_ENV: "test" }), {
      database: {
        getDb: async () => {
          throw Error("NO_DATABASE_CALL");
        },
        checkHealth: async () => "connected",
        close: async () => {},
      },
      syncPush: { push },
      syncPull: { pull },
      auth: {
        authorizeStore: async () => ({
          userId: ownerId,
          storeId,
          deviceId,
          sessionId: randomUUID(),
          storeName: "Test",
          role,
        }),
      } as unknown as AuthService,
    });
    try {
      const body = {
        syncProtocolVersion: 1,
        appVersion: "test",
        storeId,
        deviceId,
        commands: [
          {
            commandId: randomUUID(),
            localSequence: 1,
            type: "DOCUMENT_ARCHIVE_SET",
            entityType: "document_archive",
            entityId: id,
            createdAt: at,
            payload: {
              id,
              storeId,
              ownerId,
              targetKind: "COMMERCIAL_DOCUMENT",
              archived: true,
              version: 1,
              updatedAt: at,
            },
          },
        ],
      };
      const headers = {
        authorization: "Bearer token",
        "x-store-id": storeId,
        "x-sync-protocol-version": "1",
      };
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/sync/push",
        headers,
        payload: body,
      });
      expect(response.statusCode).toBe(200);
      expect(push).toHaveBeenCalledWith(body, expect.any(String), ownerId);
      const history = await app.inject({
        method: "GET",
        url: "/api/v1/sync/pull?documentArchives=true&documentArchiveHistory=true",
        headers,
      });
      expect(history.statusCode).toBe(200);
      expect(pull).toHaveBeenCalledWith(
        storeId,
        expect.objectContaining({
          documentArchives: "true",
          documentArchiveHistory: "true",
        }),
        ownerId,
        false,
      );
      const anonymous = await app.inject({
        method: "GET",
        url: "/api/v1/sync/pull?documentArchives=true&documentArchiveHistory=true",
        headers: { "x-store-id": storeId, "x-sync-protocol-version": "1" },
      });
      expect(anonymous.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  },
);
