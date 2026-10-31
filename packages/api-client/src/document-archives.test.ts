import { afterEach, it, expect, vi } from "vitest";
import { ApiClient, ApiClientError } from "./index";
afterEach(() => vi.unstubAllGlobals());
it.each([false, true])(
  "negotiates archive metadata separately from business sources (%s)",
  async (enabled) => {
    let url = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        url = input;
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
      args: Parameters<ApiClient["pullSync"]> = [
        "test-token",
        "00000000-0000-4000-8000-000000000001",
      ];
    args[33] = enabled;
    await expect(api.pullSync(...args)).rejects.toBeInstanceOf(ApiClientError);
    const query = new URL(url).searchParams;
    expect(query.get("documentArchives")).toBe(enabled ? "true" : null);
    expect(query.get("documentArchiveHistory")).toBeNull();
    expect(query.get("commercialVisual")).toBeNull();
  },
);
it("requests bounded archive-only history through the authenticated canonical pull endpoint", async () => {
  let url = "";
  let headers: Record<string, string> = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit) => {
      url = input;
      headers = init.headers as Record<string, string>;
      return new Response(
        JSON.stringify({
          documentArchives: true,
          changes: [],
          nextCursor: "cursor-next",
          hasMore: false,
          serverTime: "2026-10-31T08:00:00.000Z",
        }),
        { status: 200 },
      );
    }),
  );
  const store = "00000000-0000-4000-8000-000000000001";
  const result = await new ApiClient(
    "https://test.invalid",
  ).documentArchiveHistory("test-token", store, "cursor-before");
  const request = new URL(url);
  expect(request.pathname).toBe("/api/v1/sync/pull");
  expect(request.searchParams.get("documentArchiveHistory")).toBe("true");
  expect(request.searchParams.get("documentArchives")).toBe("true");
  expect(request.searchParams.get("limit")).toBe("100");
  expect(request.searchParams.get("cursor")).toBe("cursor-before");
  expect(headers.authorization).toBe("Bearer test-token");
  expect(headers["x-store-id"]).toBe(store);
  expect(result.documentArchives).toBe(true);
});
