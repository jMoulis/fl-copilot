import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildApp } from "../src/build-app.js";
import { parseEnvironment } from "../src/config.js";

const runtime = vi.hoisted(() => ({ keys: [] as (string | undefined)[] }));
vi.mock("resend", async (original) => {
  const module = await original<typeof import("resend")>();
  return {
    ...module,
    Resend: class extends module.Resend {
      constructor(key?: string) {
        super(key);
        runtime.keys.push(key);
      }
    },
  };
});
const receiving = {
  RESEND_RECEIVING_DOMAIN: "unit.resend.app",
  RESEND_RECEIVING_WEBHOOK_SECRET: "whsec_test_only_long_secret",
  INNGEST_EVENT_KEY: "test-event-key",
  INNGEST_SIGNING_KEY: "signkey-test-only",
};
const apps: ReturnType<typeof buildApp>[] = [];
beforeEach(() => {
  runtime.keys.length = 0;
});
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

it.each(["dedicated", "dedicated-only", "legacy"])(
  "uses the %s receiving credential for both metadata and webhook clients without modifying the sending configuration",
  async (mode) => {
    const sendingKey = "re_test_send_only_key",
      receivingKey = "re_test_receiving_only_key";
    const config = parseEnvironment({
      NODE_ENV: "test",
      ...receiving,
      ...(mode !== "dedicated-only" ? { RESEND_API_KEY: sendingKey } : {}),
      ...(mode !== "legacy" ? { RESEND_RECEIVING_API_KEY: receivingKey } : {}),
    });
    const app = buildApp(config, {
      database: {
        getDb: vi.fn(async () => {
          throw Error("No database operation expected");
        }),
        checkHealth: async () => "connected" as const,
        close: async () => {},
      },
    });
    apps.push(app);
    expect(runtime.keys).toEqual([
      mode === "legacy" ? sendingKey : receivingKey,
      mode === "legacy" ? sendingKey : receivingKey,
    ]);
    expect(config.RESEND_API_KEY).toBe(
      mode === "dedicated-only" ? undefined : sendingKey,
    );
    expect((await app.inject({ url: "/health" })).statusCode).toBe(200);
    expect(
      (await app.inject({ url: "/api/v1/intake/email/status" })).statusCode,
    ).toBe(401);
  },
);

it("rejects a partial or malformed receiving-only configuration and exposes names rather than key values", () => {
  for (const env of [
    { RESEND_RECEIVING_API_KEY: "re_private_only_key" },
    { ...receiving, RESEND_RECEIVING_API_KEY: "private_invalid_key" },
  ]) {
    let error: unknown;
    try {
      parseEnvironment({ NODE_ENV: "test", ...env });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("Invalid environment:");
    expect(String(error)).not.toContain(env.RESEND_RECEIVING_API_KEY);
  }
});
