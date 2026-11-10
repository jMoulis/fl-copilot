import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ErrorEvent } from "@sentry/node";
const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  withScope: vi.fn(),
  flush: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  tags: {} as Record<string, string>,
  extra: {} as Record<string, unknown>,
  beforeSend: undefined as
    ((event: ErrorEvent) => ErrorEvent | null) | undefined,
}));
vi.mock("@sentry/node", () => ({
  init: (options: { beforeSend?: typeof sdk.beforeSend }) => {
    sdk.init();
    sdk.beforeSend = options.beforeSend;
  },
  withScope: sdk.withScope,
  captureException: sdk.capture,
  flush: sdk.flush,
  logger: { info: sdk.info, error: sdk.error },
}));
const requestId = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("SENTRY_DSN", "https://public@example.test/1");
  for (const mock of [
    sdk.init,
    sdk.capture,
    sdk.withScope,
    sdk.flush,
    sdk.info,
    sdk.error,
  ])
    mock.mockReset();
  sdk.tags = {};
  sdk.extra = {};
  sdk.beforeSend = undefined;
  sdk.flush.mockResolvedValue(true);
  sdk.withScope.mockImplementation((callback) =>
    callback({
      setTag: (k: string, v: string) => {
        sdk.tags[k] = v;
      },
      setExtra: (k: string, v: unknown) => {
        sdk.extra[k] = v;
      },
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
});
it("keeps the generated request reference after sanitization without retaining private extras", async () => {
  const api = await import("../src/observability");
  const original = new TypeError("PRIVATE_SOURCE original exception");
  api.captureApiError(original, {
    code: "INTERNAL_ERROR",
    method: "GET",
    requestId,
  });
  const event = sdk.beforeSend!({
    type: undefined,
    tags: { ...sdk.tags },
    extra: { ...sdk.extra, document: "PRIVATE_SOURCE" },
  })!;
  expect(event.tags).toMatchObject({
    request_id: requestId,
    error_code: "INTERNAL_ERROR",
    http_method: "GET",
    error_reason: "TYPE_ERROR",
  });
  expect(event.extra).toBeUndefined();
  expect(sdk.capture).toHaveBeenCalledExactlyOnceWith(original);
  expect(original.message).toContain("PRIVATE_SOURCE");
});
it("removes exception/cause prose and frame payloads while keeping technical stack locations", async () => {
  await import("../src/observability");
  const event: ErrorEvent = {
    type: undefined,
    message: "PRIVATE_SOURCE",
    server_name: "PRIVATE_SOURCE",
    user: { email: "PRIVATE_SOURCE" },
    request: { data: "PRIVATE_SOURCE" },
    extra: { source: "PRIVATE_SOURCE" },
    tags: {
      error_code: "INTERNAL_ERROR",
      request_id: requestId,
      source: "PRIVATE_SOURCE",
    },
    exception: {
      values: [
        {
          type: "TypeError",
          value: "PRIVATE_SOURCE",
          mechanism: {
            type: "generic",
            handled: true,
            data: { sql: "PRIVATE_SOURCE" },
          },
          stacktrace: {
            frames: [
              {
                filename: "src/handler.ts",
                lineno: 42,
                colno: 7,
                context_line: "PRIVATE_SOURCE",
                pre_context: ["PRIVATE_SOURCE"],
                post_context: ["PRIVATE_SOURCE"],
                vars: { value: "PRIVATE_SOURCE" },
              },
            ],
          },
        },
        { type: "PRIVATE_SOURCE", value: "PRIVATE_SOURCE linked cause" },
      ],
    },
    threads: {
      values: [
        {
          stacktrace: {
            frames: [
              {
                filename: "src/helper.ts",
                lineno: 6,
                context_line: "PRIVATE_SOURCE",
              },
            ],
          },
        },
      ],
    },
    breadcrumbs: [
      {
        category: "http",
        level: "error",
        timestamp: 1,
        type: "http",
        message: "PRIVATE_SOURCE",
        data: { token: "PRIVATE_SOURCE" },
      },
    ],
  };
  const sanitized = sdk.beforeSend!(event)!;
  expect(JSON.stringify(sanitized)).not.toContain("PRIVATE_SOURCE");
  expect(
    sanitized.exception?.values?.[0]?.stacktrace?.frames?.[0],
  ).toMatchObject({ filename: "src/handler.ts", lineno: 42, colno: 7 });
  expect(sanitized.exception?.values?.[0]?.type).toBe("TypeError");
});
it.each(["info", "error"] as const)(
  "does not propagate a failing %s logger",
  async (level) => {
    const api = await import("../src/observability");
    sdk[level].mockImplementation(() => {
      throw Error("PRIVATE_SOURCE logging failed");
    });
    expect(() =>
      api.logRemoteEvent(level, "API request failed", {
        code: "INTERNAL_ERROR",
      }),
    ).not.toThrow();
  },
);
it("does not propagate scope/capture failures or a rejected flush", async () => {
  const api = await import("../src/observability");
  sdk.capture.mockImplementation(() => {
    throw Error("capture failed");
  });
  expect(() =>
    api.captureApiError(Error("original"), {
      code: "INTERNAL_ERROR",
      method: "GET",
      requestId,
    }),
  ).not.toThrow();
  sdk.withScope.mockImplementation(() => {
    throw Error("scope failed");
  });
  expect(() =>
    api.captureApiError(Error("original"), {
      code: "INTERNAL_ERROR",
      method: "GET",
      requestId,
    }),
  ).not.toThrow();
  sdk.flush.mockRejectedValue(Error("flush failed"));
  await expect(api.flushObservability()).resolves.toBe(false);
});
it("keeps optional monitoring initialization failure from preventing API startup", async () => {
  sdk.init.mockImplementation(() => {
    throw Error("PRIVATE_SOURCE init failed");
  });
  const api = await import("../src/observability");
  expect(() =>
    api.captureApiError(Error("original"), {
      code: "INTERNAL_ERROR",
      method: "GET",
      requestId,
    }),
  ).not.toThrow();
  await expect(api.flushObservability()).resolves.toBe(false);
});
it.each([false, true])(
  "preserves the API error response and reference (monitoring failure: %s)",
  async (broken) => {
    const { buildApp } = await import("../src/build-app");
    const { parseEnvironment } = await import("../src/config");
    if (broken) {
      sdk.error.mockImplementation(() => {
        throw Error("PRIVATE_SOURCE logging failed");
      });
      sdk.withScope.mockImplementation(() => {
        throw Error("PRIVATE_SOURCE scope failed");
      });
    }
    const app = buildApp(parseEnvironment({ NODE_ENV: "test" }), {
      database: {
        getDb: vi.fn(),
        checkHealth: async () => {
          throw Error("PRIVATE_SOURCE database failed");
        },
        close: async () => {},
      },
    });
    try {
      const response = await app.inject({
        url: "/health",
        headers: { "x-request-id": "PRIVATE_SOURCE" },
      });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        code: "INTERNAL_ERROR",
        retryable: true,
        requestId: expect.any(String),
      });
      expect(response.body).not.toContain("PRIVATE_SOURCE");
      if (!broken) expect(sdk.tags.request_id).toBe(response.json().requestId);
    } finally {
      await app.close();
    }
  },
);
it("does not initialize or contact the optional provider when unconfigured", async () => {
  vi.stubEnv("SENTRY_DSN", "");
  const api = await import("../src/observability");
  api.logRemoteEvent("error", "safe", {});
  api.captureApiError(Error("original"), {
    code: "INTERNAL_ERROR",
    method: "GET",
    requestId,
  });
  await expect(api.flushObservability()).resolves.toBe(true);
  expect(sdk.init).not.toHaveBeenCalled();
  expect(sdk.capture).not.toHaveBeenCalled();
  expect(sdk.flush).not.toHaveBeenCalled();
});
