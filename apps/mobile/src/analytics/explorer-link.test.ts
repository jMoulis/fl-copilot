import { it, expect } from "vitest";
import { explorerHref, applyExplorerLink } from "./explorer-link";
import {
  initialExplorerView,
  backExplorerView,
  changeExplorerGranularity,
  drillExplorerWeek,
  drillExplorerScope,
  explorerViewSchema,
} from "./explorer-state";
const requestId = "00000000-0000-4000-8000-000000000001",
  productId = "00000000-0000-4000-8000-000000000002";
it("opens an explicit native selection and restores the previous period, filters, page and both scroll axes", () => {
  let parent = initialExplorerView("2026-10-15");
  parent = {
    ...parent,
    frame: {
      ...parent.frame,
      filters: { category: "FRUIT", nature: "BULK", productId: null },
      scroll: 432,
      chartScroll: 151,
      detailsOffset: 20,
    },
  };
  const href = explorerHref({
    requestId,
    period: { kind: "day", date: "2026-10-15" },
    metric: "waste",
  });
  expect(href.pathname).toBe("/(tabs)/analytics");
  const next = applyExplorerLink(parent, href.params.selection);
  expect(next.metric).toBe("waste");
  expect(next.frame.filters.productId).toBeNull();
  expect(backExplorerView(next).frame).toEqual(parent.frame);
  const exact = applyExplorerLink(next, href.params.selection);
  expect(exact).toBe(next);
  const product = applyExplorerLink(
    parent,
    explorerHref({
      requestId,
      filters: { category: null, nature: null, productId },
    }).params.selection,
  );
  expect(product.frame.period).toEqual(parent.frame.period);
  expect(product.frame.filters.productId).toBe(productId);
});
it("refuses arbitrary navigation, store overrides, repeated URL values and malformed dates without modifying saved context", () => {
  const parent = initialExplorerView("2026-10-15"),
    raw = explorerHref({ requestId }).params.selection;
  for (const bad of [
    [raw],
    raw.repeat(100),
    "{",
    JSON.stringify({ ...JSON.parse(raw), storeId: productId }),
    JSON.stringify({ ...JSON.parse(raw), callback: "https://example.com" }),
    JSON.stringify({
      ...JSON.parse(raw),
      period: { kind: "week", year: 2021, week: 53 },
    }),
  ])
    expect(() => applyExplorerLink(parent, bad)).toThrow();
  expect(parent.history).toEqual([]);
});
it("supports month to complete cross-year ISO week to scope and exact back, with backward-compatible cached defaults", () => {
  let month = changeExplorerGranularity(
    initialExplorerView("2021-01-01"),
    "month",
  );
  month = {
    ...month,
    frame: {
      ...month.frame,
      scroll: 81,
      chartScroll: 300,
      filters: { category: "FRUIT", nature: null, productId: null },
    },
  };
  const week = drillExplorerWeek(month, { kind: "week", year: 2020, week: 53 });
  expect(week.frame.anchor).toBe("2021-01-01");
  expect(week.frame.filters).toEqual(month.frame.filters);
  const product = drillExplorerScope(week, {
    ...week.frame.filters,
    productId,
  });
  expect(backExplorerView(backExplorerView(product))).toEqual(month);
  expect(() =>
    drillExplorerWeek(month, { kind: "week", year: 2022, week: 1 }),
  ).toThrow("OUTSIDE");
  const legacy = JSON.parse(JSON.stringify(month));
  delete legacy.frame.filters;
  delete legacy.frame.chartScroll;
  delete legacy.frame.detailsOffset;
  expect(explorerViewSchema.parse(legacy).frame).toMatchObject({
    filters: { category: null, nature: null, productId: null },
    chartScroll: 0,
    detailsOffset: 0,
  });
});
