import { afterEach, it, expect, vi } from "vitest";
import type { Db } from "mongodb";
import {
  normalizeTraffic,
  readTransportContext,
  primTrafficBase,
} from "./transport-traffic";
import { ContextProviderCache } from "./provider-cache";
import { storeContextFixture } from "../../../../scripts/test-store-context-fixtures";
import { storeTransportsFixture } from "../../../../scripts/test-store-transports-fixtures";
export const response = () => ({
  line_reports: [
    {
      line: {
        id: "line:IDFM:C01383",
        links: [{ type: "disruption", id: "work" }],
      },
      pt_objects: [],
    },
  ],
  disruptions: [
    {
      id: "work",
      messages: [{ text: "<p>Travaux : service interrompu le soir.</p>" }],
      severity: { effect: "NO_SERVICE" },
      updated_at: "20261113T090000",
      application_periods: [
        { begin: "20261114T220000", end: "20261115T020000" },
      ],
      application_patterns: [
        {
          application_period: { begin: "20261114", end: "20261115" },
          week_pattern: { saturday: true, sunday: true, monday: false },
          time_slots: [{ begin: "220000", end: "020000" }],
        },
      ],
    },
  ],
});
afterEach(() => vi.restoreAllMocks());
it("keeps exact linked messages and planned local periods without inventing store impact or all-day closure", () => {
  const r = normalizeTraffic(response(), "IDFM:C01383");
  expect(r.disruptions[0]).toMatchObject({
    message: "Travaux : service interrompu le soir.",
    applicationPeriods: [{ begin: "20261114T220000", end: "20261115T020000" }],
  });
  expect(r.disruptions[0]?.schedule).toContain("22:00–02:00");
  expect(r.disruptions[0]?.schedule).toContain("samedi, dimanche");
  expect(r.disruptions[0]?.schedule).not.toContain("monday");
  expect(() => normalizeTraffic(response(), "IDFM:C00000")).toThrow();
  const nested = {
    ...response(),
    line_reports: [
      {
        line: { id: "line:IDFM:C01383" },
        pt_objects: [
          { stop_area: { links: [{ id: "work", type: "disruption" }] } },
        ],
      },
    ],
  };
  expect(normalizeTraffic(nested, "IDFM:C01383").disruptions[0]?.id).toBe(
    "work",
  );
  const missing = response();
  missing.disruptions = [];
  expect(() => normalizeTraffic(missing, "IDFM:C01383")).toThrow();
  expect(
    normalizeTraffic(
      {
        line_reports: [],
        disruptions: [],
        pagination: { total_result: 0, items_on_page: 0 },
      },
      "IDFM:C01383",
    ),
  ).toEqual({ disruptions: [], partial: false });
});
it("does not query PRIM when scope is missing, moved, disabled or no key is configured", async () => {
  const fetcher = vi.fn(),
    settings = {
      ...storeContextFixture(),
      transports: storeTransportsFixture(),
    };
  expect(
    await readTransportContext(
      {} as Db,
      settings,
      "2026-11-15",
      undefined,
      fetcher,
    ),
  ).toMatchObject({ status: "NOT_CONFIGURED", issue: "MISSING_API_KEY" });
  expect(
    await readTransportContext(
      {} as Db,
      { ...settings, city: "Paris" },
      "2026-11-15",
      "secret",
      fetcher,
    ),
  ).toMatchObject({ issue: "LOCATION_CHANGED" });
  expect(
    await readTransportContext(
      {} as Db,
      { ...settings, transports: { ...settings.transports, lines: [] } },
      "2026-11-15",
      "secret",
      fetcher,
    ),
  ).toMatchObject({ issue: "NO_SELECTED_LINES" });
  expect(fetcher).not.toHaveBeenCalled();
});
it("contains the key in the PRIM header only, archives normalized data and retains snapshots after outage", async () => {
  const rows: Record<string, unknown>[] = [];
  const db = {
    collection: () => ({
      findOne: async () => null,
      updateOne: async (
        q: Record<string, unknown>,
        u: { $setOnInsert?: Record<string, unknown> },
      ) => {
        if (u.$setOnInsert && !rows.some((r) => r.url === q.url))
          rows.push(u.$setOnInsert);
        return { modifiedCount: 1 };
      },
      find: () => ({
        sort: () => ({
          limit: () => ({
            toArray: async () => rows.filter((r) => r.snapshotOf).reverse(),
          }),
        }),
      }),
    }),
  } as unknown as Db;
  const settings = {
    ...storeContextFixture(),
    transports: storeTransportsFixture(),
  };
  const fetcher = vi.fn(async (input, init) => {
    expect(String(input)).toMatch(new RegExp(`^${primTrafficBase}`));
    expect(new Headers(init?.headers).get("apikey")).toBe("private-test-key");
    expect(init?.redirect).toBe("error");
    return Response.json(response());
  }) as unknown as typeof fetch;
  const first = await readTransportContext(
    db,
    settings,
    "2026-11-15",
    "private-test-key",
    fetcher,
    () => new Date("2026-11-13T10:00:00Z"),
  );
  expect(first).toMatchObject({ status: "AVAILABLE" });
  expect(JSON.stringify(first)).not.toContain("private-test-key");
  expect(JSON.stringify(rows)).not.toContain("private-test-key");
  vi.spyOn(ContextProviderCache.prototype, "read").mockResolvedValue({
    data: null,
    retrievedAt: null,
    validUntil: null,
    failed: true,
  });
  const last = await readTransportContext(
    db,
    settings,
    "2026-11-15",
    "private-test-key",
    fetcher,
  );
  expect(last).toMatchObject({ status: "STALE" });
});
