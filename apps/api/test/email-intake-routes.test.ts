import { createHmac, randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { buildApp } from "../src/build-app.js";
import { parseEnvironment } from "../src/config.js";
import { AuthError, type AuthService } from "../src/auth/service.js";
import type { EmailIntakeStore } from "../src/intake/email-intake-store.js";
function fixture(enabled = true, webhook = false) {
  const ownerId = randomUUID(),
    storeId = randomUUID(),
    conversationId = randomUUID(),
    bindingId = randomUUID();
  let role: "MANAGER" | "USER" = "MANAGER",
    revoked = false;
  const auth: AuthService = {
    requestChallenge: vi.fn(),
    verifyChallenge: vi.fn(),
    refreshSession: vi.fn(),
    logout: vi.fn(),
    authorizeStore: vi.fn(async (token, store) => {
      if (token !== "valid" || store !== storeId || revoked)
        throw new AuthError(403, "STORE_FORBIDDEN", "Accès refusé.");
      return {
        userId: ownerId,
        storeId,
        role,
        storeName: "Test",
        sessionId: randomUUID(),
        deviceId: randomUUID(),
      };
    }),
  };
  const binding = {
    id: bindingId,
    storeId,
    ownerId,
    conversationId,
    allowedSender: "manager@example.test",
    recipient: "fl-private@unit.resend.app",
    createdAt: "2026-10-20T12:00:00Z",
    revokedAt: null,
  };
  const intake: EmailIntakeStore = {
    createBinding: vi.fn(async () => binding),
    revokeBinding: vi.fn(async () => {}),
    admit: vi.fn(async () => null),
    list: vi.fn(async () => ({
      bindings: [binding],
      receipts: [],
      nextCursor: null,
    })),
  };
  const bytes = Buffer.alloc(32, 12),
    secret = `whsec_${bytes.toString("base64")}`;
  const target = {
    receiptId: randomUUID(),
    fileId: randomUUID(),
    conversationId,
  };
  const manifest = {
    schemaVersion: 1 as const,
    storeId,
    ownerId,
    ...target,
    providerEmailId: randomUUID(),
    providerAttachmentId: randomUUID(),
    filename: "sources.zip",
    declaredMimeType: "application/zip",
    sizeBytes: 3,
    checksum: `sha256:${"a".repeat(64)}`,
    retainedAt: "2026-10-20T12:00:00Z",
    manifestHash: `sha256:${"b".repeat(64)}`,
  };
  const download = {
    manifest,
    url: "https://unit.private.blob.vercel-storage.com/private-original?signature=test-only",
    expiresAt: "2026-10-20T12:02:00Z",
  };
  const originals = {
    receipt: vi.fn(async () => ({
      id: target.receiptId,
      storeId,
      ownerId,
      conversationId,
      bindingId,
      providerEmailId: manifest.providerEmailId,
      sender: binding.allowedSender,
      subject: "Sources",
      receivedAt: binding.createdAt,
      updatedAt: binding.createdAt,
      version: 2,
      status: "AWAITING_CONFIRMATION" as const,
      files: [
        {
          id: target.fileId,
          providerAttachmentId: manifest.providerAttachmentId,
          filename: manifest.filename,
          mediaType: manifest.declaredMimeType,
          status: "PENDING" as const,
          sourceDocumentId: null,
        },
      ],
    })),
    manifest: vi.fn(async (_input: unknown, check?: () => Promise<void>) => {
      await check?.();
      return manifest;
    }),
    download: vi.fn(async (_input: unknown, check?: () => Promise<void>) => {
      await check?.();
      return download;
    }),
  };
  const config = parseEnvironment({
    NODE_ENV: "test",
    ...(webhook
      ? {
          RESEND_API_KEY: "re_test_unused_only",
          RESEND_RECEIVING_DOMAIN: "unit.resend.app",
          RESEND_RECEIVING_WEBHOOK_SECRET: secret,
        }
      : {}),
  });
  const app = buildApp(config, {
    auth,
    emailIntake: enabled ? intake : undefined,
    emailOriginalAccess: originals,
    database: {
      getDb: vi.fn(),
      checkHealth: async () => "connected",
      close: async () => {},
    },
  });
  return {
    app,
    intake,
    auth,
    binding,
    scope: { storeId, ownerId, conversationId },
    bytes,
    secret,
    target,
    manifest,
    download,
    originals,
    headers: { authorization: "Bearer valid", "x-store-id": storeId },
    role: (v: typeof role) => {
      role = v;
    },
    revoke: () => {
      revoked = true;
    },
  };
}
it("reads an old receipt directly with no-store even while receiving is disabled, and rechecks the session", async () => {
  const f = fixture(false);
  const url = `/api/v1/intake/email/receipts/${f.target.receiptId}?conversationId=${f.scope.conversationId}`;
  try {
    expect((await f.app.inject({ url })).statusCode).toBe(401);
    const response = await f.app.inject({ url, headers: f.headers });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toMatchObject({
      id: f.target.receiptId,
      files: [{ status: "PENDING" }],
    });
    f.role("USER");
    expect((await f.app.inject({ url, headers: f.headers })).statusCode).toBe(
      403,
    );
    f.role("MANAGER");
    const normal = f.originals.receipt.getMockImplementation()!;
    f.originals.receipt.mockImplementationOnce(async () => {
      const receipt = await normal();
      f.revoke();
      return receipt;
    });
    expect((await f.app.inject({ url, headers: f.headers })).statusCode).toBe(
      403,
    );
  } finally {
    await f.app.close();
  }
});
it("keeps receiving disabled by default and authenticates private configuration", async () => {
  const f = fixture(false);
  try {
    expect(
      (await f.app.inject({ url: "/api/v1/intake/email/status" })).statusCode,
    ).toBe(401);
    const status = await f.app.inject({
      url: "/api/v1/intake/email/status",
      headers: f.headers,
    });
    expect(status.json()).toEqual({ enabled: false });
    expect(status.headers["cache-control"]).toBe("private, no-store");
    const configure = await f.app.inject({
      method: "POST",
      url: "/api/v1/intake/email/bindings",
      headers: f.headers,
      payload: {
        id: f.binding.id,
        conversationId: f.scope.conversationId,
        allowedSender: f.binding.allowedSender,
      },
    });
    expect(configure.statusCode).toBe(503);
    expect(configure.json().code).toBe("EMAIL_INTAKE_NOT_CONFIGURED");
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/v1/intake/resend",
          payload: { type: "email.received" },
        })
      ).statusCode,
    ).toBe(404);
  } finally {
    await f.app.close();
  }
});
it("binds setup, list and revoke to the current authenticated actor without accepting authority from the body", async () => {
  const f = fixture();
  try {
    const body = {
      id: f.binding.id,
      conversationId: f.scope.conversationId,
      allowedSender: f.binding.allowedSender,
    };
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/v1/intake/email/bindings",
          headers: f.headers,
          payload: { ...body, ownerId: randomUUID() },
        })
      ).statusCode,
    ).toBe(400);
    expect(f.intake.createBinding).not.toHaveBeenCalled();
    const created = await f.app.inject({
      method: "POST",
      url: "/api/v1/intake/email/bindings",
      headers: f.headers,
      payload: body,
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toEqual(f.binding);
    expect(f.intake.createBinding).toHaveBeenCalledExactlyOnceWith(
      { storeId: f.scope.storeId, ownerId: f.scope.ownerId },
      body,
    );
    const list = await f.app.inject({
      url: `/api/v1/intake/email/conversations/${f.scope.conversationId}`,
      headers: f.headers,
    });
    expect(list.statusCode).toBe(200);
    expect(list.headers["cache-control"]).toBe("private, no-store");
    expect(f.intake.list).toHaveBeenCalledExactlyOnceWith(f.scope, undefined);
    expect(
      (
        await f.app.inject({
          method: "DELETE",
          url: `/api/v1/intake/email/bindings/${f.binding.id}?conversationId=${f.scope.conversationId}`,
          headers: f.headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(f.intake.revokeBinding).toHaveBeenCalledExactlyOnceWith(
      f.scope,
      f.binding.id,
    );
  } finally {
    await f.app.close();
  }
});
it("refuses changed roles and rechecks authorization before disclosing a private recipient", async () => {
  const f = fixture();
  try {
    f.role("USER");
    expect(
      (
        await f.app.inject({
          url: "/api/v1/intake/email/status",
          headers: f.headers,
        })
      ).statusCode,
    ).toBe(403);
    f.role("MANAGER");
    vi.mocked(f.intake.createBinding).mockImplementation(async () => {
      f.revoke();
      return f.binding;
    });
    const result = await f.app.inject({
      method: "POST",
      url: "/api/v1/intake/email/bindings",
      headers: f.headers,
      payload: {
        id: f.binding.id,
        conversationId: f.scope.conversationId,
        allowedSender: f.binding.allowedSender,
      },
    });
    expect(result.statusCode).toBe(403);
    expect(result.body).not.toContain(f.binding.recipient);
  } finally {
    await f.app.close();
  }
});
it("registers only the configured signed webhook in the actual application and keeps private GET routes authenticated", async () => {
  const f = fixture(true, true);
  try {
    const id = `msg_${randomUUID()}`,
      timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify(
      {
        type: "email.received",
        created_at: new Date().toISOString(),
        data: {
          email_id: randomUUID(),
          from: f.binding.allowedSender,
          to: [f.binding.recipient],
          message_id: "<unit@example.test>",
          subject: "Fichier",
          attachments: [],
        },
      },
      null,
      2,
    );
    const signature = createHmac("sha256", f.bytes)
      .update(`${id}.${timestamp}.${body}`)
      .digest("base64");
    const result = await f.app.inject({
      method: "POST",
      url: "/api/v1/intake/resend",
      payload: body,
      headers: {
        "content-type": "application/json",
        "svix-id": id,
        "svix-timestamp": timestamp,
        "svix-signature": `v1,${signature}`,
      },
    });
    expect(result.statusCode).toBe(200);
    expect(f.intake.admit).toHaveBeenCalledTimes(1);
    expect(
      (
        await f.app.inject({
          url: `/api/v1/intake/email/conversations/${f.scope.conversationId}`,
        })
      ).statusCode,
    ).toBe(401);
    expect((await f.app.inject({ url: "/health" })).statusCode).toBe(200);
  } finally {
    await f.app.close();
  }
});
it("rejects partial or unsafe receiving configuration without exposing secrets", () => {
  const secret = "whsec_test_only_long_secret";
  for (const env of [
    { RESEND_RECEIVING_DOMAIN: "unit.resend.app" },
    { RESEND_RECEIVING_WEBHOOK_SECRET: secret },
    {
      RESEND_RECEIVING_DOMAIN: "localhost",
      RESEND_RECEIVING_WEBHOOK_SECRET: secret,
      RESEND_API_KEY: "re_test_unused_only",
    },
  ]) {
    expect(() => parseEnvironment({ NODE_ENV: "test", ...env })).toThrow(
      /Invalid environment:/,
    );
    try {
      parseEnvironment({ NODE_ENV: "test", ...env });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  }
});
it("requires durable execution keys before production email activation", () => {
  expect(() =>
    parseEnvironment({
      NODE_ENV: "production",
      MONGODB_URI: "mongodb://127.0.0.1:1",
      RESEND_RECEIVING_DOMAIN: "unit.resend.app",
      RESEND_RECEIVING_WEBHOOK_SECRET: "whsec_test_only_long_secret",
      RESEND_API_KEY: "re_test_unused_only",
    }),
  ).toThrow("Invalid environment: INNGEST_EVENT_KEY, INNGEST_SIGNING_KEY");
});
it("authenticates private original routes, binds scope to the principal and prevents response caching", async () => {
  const f = fixture();
  const path = `/api/v1/intake/email/${f.target.receiptId}/files/${f.target.fileId}`;
  try {
    expect(
      (
        await f.app.inject({
          url: `${path}/original-manifest?conversationId=${f.scope.conversationId}`,
        })
      ).statusCode,
    ).toBe(401);
    for (const operation of ["manifest", "download"] as const) {
      const response = await f.app.inject({
        url: `${path}/original-${operation}?conversationId=${f.scope.conversationId}`,
        headers: f.headers,
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.json()).toEqual(
        operation === "manifest" ? f.manifest : f.download,
      );
      expect(f.originals[operation]).toHaveBeenCalledWith(
        { ...f.target, storeId: f.scope.storeId, ownerId: f.scope.ownerId },
        expect.any(Function),
      );
    }
    const invalid = await f.app.inject({
      url: `${path}/original-download?conversationId=${f.scope.conversationId}&objectKey=foreign`,
      headers: f.headers,
    });
    expect(invalid.statusCode).toBe(400);
  } finally {
    await f.app.close();
  }
});
it("withholds an original capability after authorization changes", async () => {
  const f = fixture();
  f.originals.download.mockImplementationOnce(async (_input, check) => {
    f.revoke();
    await check?.();
    return f.download;
  });
  try {
    const response = await f.app.inject({
      url: `/api/v1/intake/email/${f.target.receiptId}/files/${f.target.fileId}/original-download?conversationId=${f.scope.conversationId}`,
      headers: f.headers,
    });
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain("signature=test-only");
  } finally {
    await f.app.close();
  }
});
