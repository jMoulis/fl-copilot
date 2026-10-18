import { afterEach, expect, it, vi } from "vitest";
import { ApiClient, ApiClientError } from "./index";
afterEach(() => vi.unstubAllGlobals());
it.each([false, true])(
  "advertises source-record update support only when enabled (%s)",
  async (enabled) => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response(
          JSON.stringify({
            code: "TEST_UNAVAILABLE",
            messageFr: "Indisponible",
            retryable: false,
          }),
          { status: 503 },
        );
      }),
    );
    const api = new ApiClient("https://test.invalid"),
      store = "00000000-0000-4000-8000-000000000001";
    const pull: Parameters<ApiClient["pullSync"]> = ["test-token", store];
    pull[20] = true;
    pull[22] = enabled;
    await expect(api.pullSync(...pull)).rejects.toBeInstanceOf(ApiClientError);
    const bootstrap: Parameters<ApiClient["bootstrapSync"]> = [
      "test-token",
      store,
    ];
    bootstrap[19] = true;
    bootstrap[21] = enabled;
    await expect(api.bootstrapSync(...bootstrap)).rejects.toBeInstanceOf(
      ApiClientError,
    );
    expect(urls).toHaveLength(2);
    for (const url of urls) {
      const query = new URL(url).searchParams;
      expect(query.get("mercalysPublications")).toBe("true");
      expect(query.get("mercalysRecordUpdates")).toBe(enabled ? "true" : null);
    }
  },
);
