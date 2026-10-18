import { afterEach, it, expect, vi } from "vitest";
import { ApiClient, ApiClientError } from "./index";
afterEach(() => vi.unstubAllGlobals());
it.each([false, true])(
  "negotiates actual details independently on bootstrap/pull (%s)",
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
    pull[11] = true;
    pull[25] = enabled;
    const boot: Parameters<ApiClient["bootstrapSync"]> = ["test-token", store];
    boot[10] = true;
    boot[24] = enabled;
    await expect(api.pullSync(...pull)).rejects.toBeInstanceOf(ApiClientError);
    await expect(api.bootstrapSync(...boot)).rejects.toBeInstanceOf(
      ApiClientError,
    );
    for (const url of urls) {
      const q = new URL(url).searchParams;
      expect(q.get("commercialExecution")).toBe("true");
      expect(q.get("commercialExecutionActuals")).toBe(enabled ? "true" : null);
    }
  },
);
