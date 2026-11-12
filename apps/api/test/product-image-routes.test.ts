import { randomUUID } from "node:crypto";
import { it, expect, vi } from "vitest";
import { buildApp } from "../src/build-app";
import { parseEnvironment } from "../src/config";
import type { AuthService } from "../src/auth/service";
import { AuthError } from "../src/auth/service";
import type { ProductImageService } from "../src/products/product-image-service";
it("requires current manager membership on all generation and private preview endpoints", async () => {
  const storeId = randomUUID(),
    productId = randomUUID(),
    requestId = randomUUID(),
    userId = randomUUID();
  let role = "MANAGER";
  const images: ProductImageService = {
    options: vi.fn(async () => ({
      available: true,
      reasonFr: null,
      model: "test",
      estimatedCostUsd: 0.03,
      policyId: "test",
      productVersion: 1,
    })),
    generate: vi.fn(async () => ({
      requestId,
      productId,
      productVersion: 1,
      status: "RUNNING" as const,
      image: null,
    })),
    status: vi.fn(async () => ({
      requestId,
      productId,
      productVersion: 1,
      status: "RUNNING" as const,
      image: null,
    })),
    file: vi.fn(async () => new Uint8Array([1, 2, 3])),
  };
  const auth: AuthService = {
    requestChallenge: vi.fn(),
    verifyChallenge: vi.fn(),
    refreshSession: vi.fn(),
    logout: vi.fn(),
    authorizeStore: vi.fn(async (token, store) => {
      if (token !== "valid" || store !== storeId)
        throw new AuthError(403, "STORE_FORBIDDEN", "Accès refusé");
      return {
        storeId,
        userId,
        role,
        storeName: "Test",
        deviceId: randomUUID(),
        sessionId: randomUUID(),
      };
    }),
  };
  const app = buildApp(parseEnvironment({ NODE_ENV: "test" }), {
    database: {
      getDb: vi.fn(),
      checkHealth: async () => "connected",
      close: async () => {},
    },
    auth,
    productImages: images,
  });
  try {
    const paths = [
      {
        method: "GET" as const,
        url: `/api/v1/product-images/options/${productId}`,
      },
      {
        method: "POST" as const,
        url: "/api/v1/product-images/generate",
        payload: { requestId, productId, productVersion: 1, policyId: "test" },
      },
      { method: "GET" as const, url: `/api/v1/product-images/${requestId}` },
      {
        method: "GET" as const,
        url: `/api/v1/product-images/${requestId}/file`,
      },
    ];
    for (const req of paths) {
      expect((await app.inject(req)).statusCode).toBe(401);
      role = "MEMBER";
      expect(
        (
          await app.inject({
            ...req,
            headers: { authorization: "Bearer valid", "x-store-id": storeId },
          })
        ).statusCode,
      ).toBe(403);
      role = "MANAGER";
      const res = await app.inject({
        ...req,
        headers: { authorization: "Bearer valid", "x-store-id": storeId },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers["cache-control"]).toBe("private, no-store");
    }
    images.status = vi.fn(async () => {
      role = "MEMBER";
      return {
        requestId,
        productId,
        productVersion: 1,
        status: "RUNNING" as const,
        image: null,
      };
    });
    expect(
      (
        await app.inject({
          url: `/api/v1/product-images/${requestId}`,
          headers: { authorization: "Bearer valid", "x-store-id": storeId },
        })
      ).statusCode,
    ).toBe(403);
  } finally {
    await app.close();
  }
});
