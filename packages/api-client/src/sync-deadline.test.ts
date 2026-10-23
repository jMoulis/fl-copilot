import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "./index";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it.each(["pull", "bootstrap", "refresh", "push"] as const)(
  "bounds a stalled %s request, including its JSON body, and aborts the transport",
  async (operation) => {
    for (const stalledBody of [false, true]) {
      vi.useFakeTimers();
      let signal: AbortSignal | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn((_url: string, init: RequestInit) => {
          signal = init.signal as AbortSignal;
          return stalledBody
            ? Promise.resolve({
                ok: true,
                status: 200,
                json: () => new Promise(() => {}),
              })
            : new Promise(() => {});
        }),
      );
      const api = new ApiClient("https://fixture.invalid");
      const request =
        operation === "pull"
          ? api.pullSync("token", "store")
          : operation === "bootstrap"
            ? api.bootstrapSync("token", "store")
            : operation === "push"
              ? api.pushSync("token", {
                  syncProtocolVersion: 1,
                  appVersion: "0.1.0",
                  deviceId: "device",
                  storeId: "store",
                  commands: [],
                })
              : api.refreshSession("device", "refresh-token");
      const checked = expect(request).rejects.toMatchObject({
        status: 0,
        response: { code: "SYNC_REQUEST_TIMEOUT", retryable: true },
      });
      await vi.advanceTimersByTimeAsync(60_000);
      await checked;
      expect(signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      vi.useRealTimers();
    }
  },
);
it("clears the deadline after a valid response and keeps the authenticated store scope", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer token");
    expect(new Headers(init.headers).get("x-store-id")).toBe("store");
    return new Response(
      JSON.stringify({
        changes: [],
        nextCursor: "next",
        hasMore: false,
        serverTime: "2026-10-23T00:00:00Z",
      }),
    );
  });
  vi.stubGlobal("fetch", fetch);
  expect(
    await new ApiClient("https://fixture.invalid").pullSync("token", "store"),
  ).toMatchObject({ nextCursor: "next" });
  expect(vi.getTimerCount()).toBe(0);
});
