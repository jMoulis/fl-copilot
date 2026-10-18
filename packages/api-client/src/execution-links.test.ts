import { afterEach, expect, it, vi } from "vitest";
import { ApiClient, ApiClientError } from "./index";
afterEach(() => vi.unstubAllGlobals());
it.each([false, true])(
  "negotiates execution links independently of older private decisions on bootstrap and pull (%s)",
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
    pull[19] = true;
    pull[23] = true;
    pull[24] = enabled;
    const bootstrap: Parameters<ApiClient["bootstrapSync"]> = [
      "test-token",
      store,
    ];
    bootstrap[18] = true;
    bootstrap[22] = true;
    bootstrap[23] = enabled;
    await expect(api.pullSync(...pull)).rejects.toBeInstanceOf(ApiClientError);
    await expect(api.bootstrapSync(...bootstrap)).rejects.toBeInstanceOf(
      ApiClientError,
    );
    expect(urls).toHaveLength(2);
    for (const url of urls) {
      const q = new URL(url).searchParams;
      expect(q.get("copilotHistory")).toBe("true");
      expect(q.get("copilotDecisions")).toBe("true");
      expect(q.get("copilotExecutionLinks")).toBe(enabled ? "true" : null);
    }
  },
);
