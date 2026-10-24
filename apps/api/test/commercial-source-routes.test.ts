import { randomUUID } from "node:crypto";
import { it, expect, vi } from "vitest";
import { buildApp } from "../src/build-app";
import { parseEnvironment } from "../src/config";
import type { AuthService } from "../src/auth/service";
import { AuthError } from "../src/auth/service";
import type { Db } from "mongodb";
import { commercialChoiceFixture } from "../../../scripts/test-commercial-choice-fixtures";

it("authorizes before revealing commercial source compatibility and restricts commercial decisions to managers", async () => {
  const f = await commercialChoiceFixture(),
    deviceId = randomUUID(),
    ownerId = randomUUID();
  const push = vi.fn(async (input) => ({
    results: input.commands.map(
      (c: { commandId: string; entityType: string; entityId: string }) => ({
        ...c,
        status: "APPLIED",
        remoteVersion: 1,
      }),
    ),
    serverTime: new Date().toISOString(),
  }));
  let role = "MEMBER";
  const auth = {
    requestChallenge: vi.fn(),
    verifyChallenge: vi.fn(),
    refreshSession: vi.fn(),
    logout: vi.fn(),
    authorizeStore: async (token: string) => {
      if (token !== "valid")
        throw new AuthError(401, "AUTH_REQUIRED", "Connectez-vous.");
      return {
        storeId: f.storeId,
        storeName: "Fixture",
        role,
        userId: ownerId,
        sessionId: randomUUID(),
        deviceId,
      };
    },
  } satisfies AuthService;
  const getDb = vi.fn(async () => {
    throw Error("MUST_NOT_READ_METADATA_BEFORE_AUTH");
  });
  const app = buildApp(parseEnvironment({ NODE_ENV: "test" }), {
    auth,
    syncPush: { push },
    database: {
      getDb: getDb as () => Promise<Db>,
      checkHealth: async () => "connected",
      close: async () => {},
    },
  });
  try {
    const payload = {
      syncProtocolVersion: 1,
      appVersion: "fixture",
      deviceId,
      storeId: f.storeId,
      commands: [
        {
          commandId: randomUUID(),
          localSequence: 1,
          type: "COMMERCIAL_OFFER_CHOICE_UPSERT",
          entityType: "commercial_offer_choice",
          entityId: f.choice.id,
          expectedRemoteVersion: null,
          createdAt: f.choice.createdAt,
          payload: f.choice,
        },
      ],
    };
    const headers = {
      authorization: "Bearer valid",
      "x-store-id": f.storeId,
      "x-sync-protocol-version": "1",
      "x-commercial-source-version": "2",
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/sync/push",
          headers: { ...headers, authorization: "Bearer invalid" },
          payload,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/sync/push",
          headers,
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect(push).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
    role = "MANAGER";
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/sync/push",
          headers,
          payload,
        })
      ).statusCode,
    ).toBe(200);
    expect(push.mock.calls[0]?.[0]).toMatchObject({
      commercialOriginalSources: true,
    });
  } finally {
    await app.close();
  }
});

it("returns an explicit update requirement before starting a legacy client's model turn when raw choices exist", async () => {
  const storeId = randomUUID(),
    userId = randomUUID(),
    context = vi.fn();
  const findOne = vi.fn(async () => ({ _id: randomUUID() })),
    collection = vi.fn((name: string) => {
      expect(name).toBe("commercialOfferChoices");
      return { findOne };
    });
  const auth = {
    requestChallenge: vi.fn(),
    verifyChallenge: vi.fn(),
    refreshSession: vi.fn(),
    logout: vi.fn(),
    authorizeStore: async () => ({
      storeId,
      storeName: "Fixture",
      role: "MANAGER",
      userId,
      sessionId: randomUUID(),
      deviceId: randomUUID(),
    }),
  } satisfies AuthService;
  const app = buildApp(parseEnvironment({ NODE_ENV: "test" }), {
    auth,
    copilotContext: context,
    database: {
      getDb: async () => ({ collection }) as unknown as Db,
      checkHealth: async () => "connected",
      close: async () => {},
    },
  });
  try {
    const result = await app.inject({
      method: "POST",
      url: "/api/v1/copilot/turn",
      headers: { authorization: "Bearer valid", "x-store-id": storeId },
      payload: {
        replyId: randomUUID(),
        conversationId: randomUUID(),
        userMessageId: randomUUID(),
      },
    });
    expect(result.statusCode).toBe(426);
    expect(result.json()).toMatchObject({
      code: "COMMERCIAL_SOURCE_UPGRADE_REQUIRED",
      retryable: false,
    });
    expect(context).not.toHaveBeenCalled();
    expect(findOne).toHaveBeenCalledExactlyOnceWith(
      { storeId, "source.kind": "PDF_ORIGINAL" },
      { projection: { _id: 1 }, maxTimeMS: 2000 },
    );
  } finally {
    await app.close();
  }
});
