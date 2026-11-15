import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "./index";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each([false, true])(
  "bounds a suspended push registration and permits retry (body suspended: %s)",
  async (stalledBody) => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetch = vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return stalledBody
        ? Promise.resolve({
            ok: true,
            status: 200,
            json: () => new Promise(() => {}),
          })
        : new Promise(() => {});
    });
    vi.stubGlobal("fetch", fetch);
    const api = new ApiClient("https://fixture.invalid"),
      storeId = "33333333-3333-4333-8333-333333333333",
      deviceId = "11111111-1111-4111-8111-111111111111",
      token = "ExpoPushToken[aaaaaaaaaaaaaaaaaaaaaa]",
      channels = { chat: false, email: true, documents: false };
    let outcome: unknown;
    const request = api
      .updateDevicePushToken("access", deviceId, storeId, token, channels)
      .then(
        (value) => {
          outcome = value;
        },
        (error: unknown) => {
          outcome = error;
        },
      );
    await vi.advanceTimersByTimeAsync(30_000);
    expect(outcome).toMatchObject({
      status: 0,
      response: { code: "SYNC_REQUEST_TIMEOUT", retryable: true },
    });
    await request;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    fetch.mockImplementationOnce(async (_url, init) => {
      expect(_url).toBe(
        `https://fixture.invalid/api/v1/devices/${deviceId}/push-token`,
      );
      expect(init.method).toBe("PUT");
      expect(new Headers(init.headers).get("authorization")).toBe(
        "Bearer access",
      );
      expect(new Headers(init.headers).get("x-store-id")).toBe(storeId);
      expect(JSON.parse(init.body as string)).toEqual({
        storeId,
        pushToken: token,
        channels,
      });
      return Response.json({ enabled: true });
    });
    await expect(
      api.updateDevicePushToken("access", deviceId, storeId, token, channels),
    ).resolves.toEqual({ enabled: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  },
);
