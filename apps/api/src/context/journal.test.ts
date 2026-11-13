import { afterEach, it, expect, vi } from "vitest";
import type { Db } from "mongodb";
import { readJournalContext } from "./journal";
import { ContextProviderCache } from "./provider-cache";
import { journalContextFixture } from "../../../../scripts/test-journal-context-fixtures";
import { storeContextFixture } from "../../../../scripts/test-store-context-fixtures";
const fixture = journalContextFixture();
function database() {
  const rows: Record<string, unknown>[] = [];
  return {
    rows,
    db: {
      collection: () => ({
        updateOne: async (
          q: Record<string, unknown>,
          u: { $setOnInsert: Record<string, unknown> },
        ) => {
          if (!rows.some((r) => r.url === q.url)) rows.push(u.$setOnInsert);
        },
        find: (q: Record<string, unknown>) => ({
          sort: () => ({
            limit: (n: number) => ({
              toArray: async () =>
                rows
                  .filter(
                    (r) =>
                      r.snapshotOf === q.snapshotOf &&
                      (!q.firstCapturedAt ||
                        String(r.firstCapturedAt) <
                          (q.firstCapturedAt as { $lt: string }).$lt),
                  )
                  .sort((a, b) =>
                    String(b.firstCapturedAt).localeCompare(
                      String(a.firstCapturedAt),
                    ),
                  )
                  .slice(0, n),
            }),
          }),
        }),
      }),
    } as unknown as Db,
  };
}
afterEach(() => vi.restoreAllMocks());
function provider() {
  return vi
    .spyOn(ContextProviderCache.prototype, "read")
    .mockImplementation(async (url) => ({
      data: fixture.sources[
        url.includes("franceagrimer") ? 2 : url.includes("travaux") ? 0 : 1
      ]!.payload,
      retrievedAt: "2026-11-13T09:00:00.000Z",
      validUntil: "2026-11-14T09:00:00.000Z",
      failed: false,
    }));
}
it("captures immutable revisions once, reuses history and keeps one source failure independent", async () => {
  const { db, rows } = database(),
    read = provider(),
    settings = storeContextFixture(),
    now = new Date("2026-11-13T10:00:00Z");
  const r = await readJournalContext(
    db,
    new ContextProviderCache(db),
    settings,
    "2026-11-15",
    now,
  );
  expect(r.sources.every((s) => s.status === "AVAILABLE")).toBe(true);
  expect(rows).toHaveLength(3);
  await readJournalContext(
    db,
    new ContextProviderCache(db),
    settings,
    "2026-11-15",
    now,
  );
  expect(rows).toHaveLength(3);
  read.mockResolvedValue({
    data: null,
    retrievedAt: null,
    validUntil: null,
    failed: true,
  });
  const stale = await readJournalContext(
    db,
    new ContextProviderCache(db),
    settings,
    "2026-11-15",
    now,
  );
  expect(stale.sources.every((s) => s.status === "STALE" && s.payload)).toBe(
    true,
  );
  expect(stale.sources[0]?.firstCapturedAt).toBe(r.sources[0]?.firstCapturedAt);
});
it("never shows today's mutable announcements as a past week's facts and never invents future consumption", async () => {
  const { db } = database();
  provider();
  const r = await readJournalContext(
    db,
    new ContextProviderCache(db),
    storeContextFixture(),
    "2026-08-30",
    new Date("2026-11-13T10:00:00Z"),
  );
  expect(r.sources[0]).toMatchObject({
    payload: null,
    issue: "HISTORY_UNAVAILABLE",
  });
  expect(r.sources[2]?.payload).toBeNull();
});
it("scopes municipal sources to the supported city/postcode, leaving transport explicitly unconfigured", async () => {
  const { db } = database(),
    read = provider();
  const r = await readJournalContext(
    db,
    new ContextProviderCache(db),
    { ...storeContextFixture(), city: "Paris", postalCode: "75001" },
    "2026-11-15",
    new Date("2026-11-13T10:00:00Z"),
  );
  expect(read).toHaveBeenCalledTimes(1);
  expect(r.sources[0]?.status).toBe("NOT_CONFIGURED");
  expect(r.transport).toBe("NOT_CONFIGURED");
});

it("preserves equal-content captures on different days for within-week historical selection", async () => {
  const { db } = database(),
    read = provider(),
    settings = storeContextFixture();
  await readJournalContext(
    db,
    new ContextProviderCache(db),
    settings,
    "2026-11-15",
    new Date("2026-11-13T10:00:00Z"),
  );
  read.mockImplementation(async (url) => ({
    data: fixture.sources[
      url.includes("franceagrimer") ? 2 : url.includes("travaux") ? 0 : 1
    ]!.payload,
    retrievedAt: "2026-11-14T09:00:00.000Z",
    validUntil: "2026-11-15T09:00:00.000Z",
    failed: false,
  }));
  const result = await readJournalContext(
    db,
    new ContextProviderCache(db),
    settings,
    "2026-11-15",
    new Date("2026-11-14T10:00:00Z"),
  );
  expect(result.sources[0]?.history.map((h) => h.firstCapturedAt)).toEqual([
    "2026-11-14T09:00:00.000Z",
    "2026-11-13T09:00:00.000Z",
  ]);
});
