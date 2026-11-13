import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "./index";
import type { WeeklyContext } from "@fl-copilot/sync-contracts";
afterEach(() => vi.unstubAllGlobals());
it.each([false, true])(
  "requests visual weather only when supported, while accepting older responses (%s)",
  async (enabled) => {
    const meta = {
      status: "UNAVAILABLE" as const,
      retrievedAt: null,
      validUntil: null,
      issue: "PROVIDER_UNAVAILABLE" as const,
    };
    const context: WeeklyContext = {
      storeId: "00000000-0000-4000-8000-000000000001",
      settingsFingerprint: "test-settings",
      weekStart: "2026-10-05",
      weekEnd: "2026-10-11",
      retrievedAt: "2026-10-09T08:00:00Z",
      locationLabel: "Test",
      weather: {
        ...meta,
        provider: "MET Norway",
        sourceUrl:
          "https://api.met.no/weatherapi/locationforecast/2.0/documentation",
        issuedAt: null,
        days: [],
      },
      publicHolidays: {
        ...meta,
        provider: "calendrier.api.gouv.fr",
        sourceUrl: "https://calendrier.api.gouv.fr/jours-feries/",
        days: [],
      },
      schoolHolidays: {
        ...meta,
        provider: "Ministère de l’Éducation nationale",
        sourceUrl:
          "https://data.education.gouv.fr/explore/dataset/fr-en-calendrier-scolaire/",
        zone: null,
        periods: [],
      },
    };
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify(context), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetcher);
    const result = await new ApiClient("https://test.invalid").weeklyContext(
      "token",
      context.storeId,
      context.weekStart,
      enabled,
      enabled,
    );
    expect(result).toEqual(context);
    const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    const headers = new Headers(init.headers);
    expect(headers.get("x-context-weather-symbols")).toBe(enabled ? "1" : null);
    expect(headers.get("x-context-economy")).toBe(enabled ? "1" : null);
    expect(headers.get("x-store-id")).toBe(context.storeId);
  },
);
