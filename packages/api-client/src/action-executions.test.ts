import { afterEach, it, expect, vi } from "vitest";
import { ApiClient, ApiClientError } from "./index";
afterEach(() => vi.unstubAllGlobals());
it.each([false, true])(
  "negotiates action declarations separately from commercial tasks and links (%s)",
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
    const pull: Parameters<ApiClient["pullSync"]> = ["test-token", store];
    pull[19] = true;
    pull[26] = enabled;
    const boot: Parameters<ApiClient["bootstrapSync"]> = ["test-token", store];
    boot[18] = true;
    boot[25] = enabled;
    await expect(api.pullSync(...pull)).rejects.toBeInstanceOf(ApiClientError);
    await expect(api.bootstrapSync(...boot)).rejects.toBeInstanceOf(
      ApiClientError,
    );
    for (const url of urls) {
      const q = new URL(url).searchParams;
      expect(q.get("copilotHistory")).toBe("true");
      expect(q.get("copilotActionExecutions")).toBe(enabled ? "true" : null);
      expect(q.get("commercialExecution")).toBeNull();
    }
  },
);
