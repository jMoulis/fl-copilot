import type { ExplorerPeriod } from "@fl-copilot/analytics-core";
import type { ExplorerView } from "../analytics/explorer-state";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { VisualTestDatabase } from "../../../../scripts/test-visual-sqlite";
import { runLocalMigrations } from "../db/migrations";
import {
  ExplorerViewRepository,
  initialExplorerView,
  drillExplorerView,
  shiftExplorerView,
  backExplorerView,
} from "../analytics/explorer-state";
import { applyExplorerLink } from "../analytics/explorer-link";
import {
  productPerformanceView,
  productDetailHref,
  productPerformanceHref,
  applyProductPerformanceLink,
} from "./product-performance-context";
import { tradingToday } from "../dates/calendar";
it.each(["day", "week", "month", "year", "range"] as const)(
  "preserves the exact %s period, metric and comparison through Explorer → product → Explorer without changing the caller",
  (kind) => {
    const id = randomUUID(),
      original = initialExplorerView("2026-10-15");
    const period: ExplorerPeriod =
      kind === "day"
        ? { kind, date: "2026-10-15" }
        : kind === "week"
          ? { kind, year: 2026, week: 42 }
          : kind === "month"
            ? { kind, year: 2026, month: 10 }
            : kind === "year"
              ? { kind, year: 2026 }
              : {
                  kind,
                  current: { start: "2026-10-01", end: "2026-10-15" },
                  reference: { start: "2025-10-01", end: "2025-10-15" },
                  aggregation: "AVERAGE",
                  basis: "OBSERVED_PRODUCTS",
                };
    const input: ExplorerView = {
      ...original,
      metric: "margin",
      frame: {
        ...original.frame,
        period,
        filters: { category: "FRUIT", nature: "BULK", productId: null },
        chartScroll: 180,
        detailsOffset: 30,
        scroll: 600,
      },
    };
    const snapshot = JSON.stringify(input);
    const view = productPerformanceView(id, "2026-10-15", input);
    const link = productDetailHref(id, randomUUID(), view);
    expect(link.pathname).toBe("/(tabs)/products/[id]");
    expect(link.params.id).toBe(id);
    const opened = applyProductPerformanceLink(
      id,
      productPerformanceView(id, "2026-10-20"),
      link.params.selection,
    );
    expect(opened.frame.period).toEqual(period);
    expect(opened.metric).toBe("margin");
    expect(opened.frame.filters).toMatchObject({
      category: null,
      nature: null,
      productId: id,
    });
    const returned = applyExplorerLink(
      initialExplorerView("2026-10-20"),
      productPerformanceHref(id, randomUUID(), opened).params.selection,
    );
    expect(returned.frame.period).toEqual(period);
    expect(returned.frame.filters).toEqual(opened.frame.filters);
    expect(returned.metric).toBe("margin");
    expect(JSON.stringify(input)).toBe(snapshot);
  },
);
it("refuses a foreign, malformed, oversized or authority-bearing product link", () => {
  const a = randomUUID(),
    b = randomUUID(),
    view = productPerformanceView(a, "2026-10-15");
  expect(() =>
    applyProductPerformanceLink(
      a,
      view,
      productDetailHref(b, randomUUID(), view).params.selection,
    ),
  ).toThrow("PRODUCT_PERFORMANCE_LINK_INVALID");
  const raw = JSON.parse(
    productDetailHref(a, randomUUID(), view).params.selection,
  );
  for (const value of [
    { ...raw, storeId: randomUUID() },
    { ...raw, callback: "publish" },
    ["not-a-link"],
    "x".repeat(17000),
    JSON.stringify({ ...raw, filters: { ...raw.filters, category: "FRUIT" } }),
  ])
    expect(() =>
      applyProductPerformanceLink(
        a,
        view,
        typeof value === "object" && !Array.isArray(value)
          ? JSON.stringify(value)
          : value,
      ),
    ).toThrow();
  expect(() => productPerformanceView("not-a-uuid", "2026-10-15")).toThrow();
});
it("retains independent product contexts across file-backed offline restart, isolates owners/stores and leaves the main Explorer untouched", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-product-context-")),
    path = join(dir, "local.db"),
    storeId = randomUUID(),
    ownerId = randomUUID(),
    productId = randomUUID(),
    otherId = randomUUID();
  let db = new VisualTestDatabase(new DatabaseSync(path));
  try {
    await runLocalMigrations(db);
    const main = new ExplorerViewRepository(db, { storeId, ownerId }),
      product = new ExplorerViewRepository(db, { storeId, ownerId, productId });
    const general = initialExplorerView("2026-10-20");
    await main.save(general);
    const detail = productPerformanceView(productId, "2026-10-15");
    detail.metric = "waste";
    detail.frame.chartScroll = 174;
    await product.save(detail);
    await expect(
      product.save(productPerformanceView(otherId, "2026-10-15")),
    ).rejects.toThrow("PRODUCT_PERFORMANCE_SCOPE_INVALID");
    db.raw.close();
    db = new VisualTestDatabase(new DatabaseSync(path));
    await runLocalMigrations(db);
    expect(
      await new ExplorerViewRepository(db, {
        storeId,
        ownerId,
        productId,
      }).read(),
    ).toEqual(detail);
    expect(
      await new ExplorerViewRepository(db, { storeId, ownerId }).read(),
    ).toEqual(general);
    expect(
      await new ExplorerViewRepository(db, {
        storeId,
        ownerId,
        productId: otherId,
      }).read(),
    ).toBeNull();
    expect(
      await new ExplorerViewRepository(db, {
        storeId,
        ownerId: randomUUID(),
        productId,
      }).read(),
    ).toBeNull();
    expect(
      await new ExplorerViewRepository(db, {
        storeId: randomUUID(),
        ownerId,
        productId,
      }).read(),
    ).toBeNull();
    expect(
      await db.getFirstAsync("SELECT COUNT(*) n FROM sync_outbox"),
    ).toEqual({ n: 0 });
  } finally {
    db.raw.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("keeps product filters through ISO shifts and drill-back without leaking a chart offset to a different period", () => {
  const id = randomUUID(),
    view = productPerformanceView(id, "2026-12-31");
  view.frame.chartScroll = 210;
  const next = shiftExplorerView(view, 1);
  expect(next.frame.period).toEqual({ kind: "week", year: 2027, week: 1 });
  expect(next.frame.filters.productId).toBe(id);
  expect(next.frame.chartScroll).toBe(0);
  const drill = drillExplorerView(view, "2026-12-31");
  expect(drill.frame.filters.productId).toBe(id);
  expect(backExplorerView(drill)).toEqual(view);
});
it("uses the Paris trading date at midnight and year boundaries for both presentations", () => {
  expect(tradingToday(new Date("2026-10-19T22:30:00Z"))).toBe("2026-10-20");
  expect(tradingToday(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
});
