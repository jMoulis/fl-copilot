import { afterEach, it, expect, vi } from "vitest";
import { ApiClient, ApiClientError } from "./index";
afterEach(() => vi.unstubAllGlobals());
it.each([false, true])(
  "negotiates shared store layouts independently of private chat and week plans (%s)",
  async (enabled) => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response(
          JSON.stringify({
            code: "UNAVAILABLE",
            messageFr: "Indisponible",
            retryable: false,
          }),
          { status: 503 },
        );
      }),
    );
    const api = new ApiClient("https://test.invalid"),
      store = "00000000-0000-4000-8000-000000000001";
    const pull: Parameters<ApiClient["pullSync"]> = ["token", store];
    pull[27] = enabled;
    const boot: Parameters<ApiClient["bootstrapSync"]> = ["token", store];
    boot[26] = enabled;
    await expect(api.pullSync(...pull)).rejects.toBeInstanceOf(ApiClientError);
    await expect(api.bootstrapSync(...boot)).rejects.toBeInstanceOf(
      ApiClientError,
    );
    for (const u of urls) {
      const q = new URL(u).searchParams;
      expect(q.get("storeLayouts")).toBe(enabled ? "true" : null);
      for (const key of ["copilotHistory", "commercialPlans", "storeContext"])
        expect(q.get(key)).toBeNull();
    }
  },
);

it.each([false, true])(
  "negotiates allocation snapshots independently (%s)",
  async (enabled) => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response(
          JSON.stringify({
            code: "UNAVAILABLE",
            messageFr: "Indisponible",
            retryable: false,
          }),
          { status: 503 },
        );
      }),
    );
    const api = new ApiClient("https://test.invalid"),
      store = "00000000-0000-4000-8000-000000000001";
    const pull: Parameters<ApiClient["pullSync"]> = ["token", store];
    pull[28] = enabled;
    const boot: Parameters<ApiClient["bootstrapSync"]> = ["token", store];
    boot[27] = enabled;
    await expect(api.pullSync(...pull)).rejects.toBeInstanceOf(ApiClientError);
    await expect(api.bootstrapSync(...boot)).rejects.toBeInstanceOf(
      ApiClientError,
    );
    for (const u of urls) {
      const q = new URL(u).searchParams;
      expect(q.get("physicalAllocations")).toBe(enabled ? "true" : null);
      for (const key of ["storeLayouts", "copilotHistory", "commercialPlans"])
        expect(q.get(key)).toBeNull();
    }
  },
);
