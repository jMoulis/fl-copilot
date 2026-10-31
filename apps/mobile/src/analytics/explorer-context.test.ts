import { createElement, useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  compareExplorerPeriod,
  type DatedKpiValue,
} from "@fl-copilot/analytics-core";
import { emptyExplorerFilters } from "@fl-copilot/domain";
import { ExplorerContent } from "./explorer-view";
import {
  initialExplorerView,
  explorerViewSchema,
  drillExplorerScope,
  backExplorerView,
  type ExplorerView,
} from "./explorer-state";

vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
}));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Icon" }));
vi.mock("../products/linked-product-visual", () => ({
  LinkedProductVisual: () => null,
}));
vi.mock("../components/date-selector", () => ({ DateSelector: () => null }));
vi.mock("./explorer-trend-chart", () => ({
  ExplorerTrendChart: (props: unknown) =>
    createElement("Chart", props as Record<string, unknown>),
}));
vi.mock("../components/ui", () => ({
  BottomSheet: () => null,
  InlineAlert: ({ title, message }: { title: string; message: string }) =>
    createElement("Alert", { title, message }, message),
  SecondaryButton: ({ label, onPress }: { label: string; onPress(): void }) =>
    createElement("Button", { accessibilityLabel: label, onPress }, label),
  StatusBadge: () => null,
}));

let rendered: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (String(args[0]).includes("react-test-renderer is deprecated")) return;
    original(...args);
  });
});
afterEach(async () => {
  await act(() => rendered?.unmount());
  rendered = undefined;
  vi.unstubAllGlobals();
});

const productId = "00000000-0000-4000-8000-000000000002";
const source = explorerViewSchema.parse({
  ...initialExplorerView("2026-10-15"),
  metric: "wasteCost",
  frame: {
    ...initialExplorerView("2026-10-15").frame,
    period: {
      kind: "range",
      current: { start: "2026-10-01", end: "2026-10-20" },
      reference: { start: "2025-10-01", end: "2025-10-20" },
      universe: { start: "2026-10-01", end: "2026-10-20" },
      aggregation: "AVERAGE",
      basis: "OBSERVED_PRODUCTS",
    },
    filters: {
      category: "FRUIT",
      nature: "BULK",
      productId,
      productIds: [productId],
      labelContains: "poire",
    },
    scroll: 375,
    chartScroll: 120,
    detailsOffset: 20,
  },
});
function analysis(view: ExplorerView, points: DatedKpiValue[]) {
  return {
    ...compareExplorerPeriod({
      period: view.frame.period,
      today: "2026-10-23",
      kpiId: view.metric,
      points,
    }),
    filters: view.frame.filters,
    details: null,
    detailsUnavailable: false,
  };
}
const handlers = () => ({
  onMetric: vi.fn(),
  onFilters: vi.fn(),
  onClearFilters: vi.fn(),
  onGranularity: vi.fn(),
  onShift: vi.fn(),
  onPick: vi.fn(),
  onDrill: vi.fn(),
  onBack: vi.fn(),
  onRefresh: vi.fn(),
  onWeek: vi.fn(),
  onChartScroll: vi.fn(),
});
function button(label: string) {
  return rendered!.root.findByProps({ accessibilityLabel: label });
}
function labels() {
  return rendered!.root
    .findAllByType("Text" as never)
    .map((node) => node.children.filter((c) => typeof c === "string").join(""));
}

it("keeps active filters visible and editable even before amounts arrive", async () => {
  const callbacks = handlers();
  await act(() => {
    rendered = create(
      createElement(ExplorerContent, {
        ...callbacks,
        view: source,
        syncStatus: "offline",
      }),
    );
  });
  expect(labels()).toContain("Filtres actifs");
  expect(
    labels().some((t) => t.includes("Fruits · Vrac") && t.includes("poire")),
  ).toBe(true);
  await act(() => button("Modifier les filtres actifs").props.onPress());
  expect(callbacks.onFilters).toHaveBeenCalledOnce();
  expect(button("Afficher tous les produits pour cette période")).toBeDefined();
});

it("clears every filter without changing the source period/basis or metric, and restores the exact previous context", async () => {
  let latest = source;
  function Harness() {
    const [view, setView] = useState(source);
    latest = view;
    return createElement(ExplorerContent, {
      ...handlers(),
      view,
      data: analysis(view, []),
      syncStatus: "offline",
      onClearFilters: () =>
        setView(drillExplorerScope(view, emptyExplorerFilters())),
      onBack: () => setView(backExplorerView(view)),
    });
  }
  await act(() => {
    rendered = create(createElement(Harness));
  });
  await act(() =>
    button("Afficher tous les produits pour cette période").props.onPress(),
  );
  expect(latest.frame.filters).toEqual(emptyExplorerFilters());
  expect(latest.frame.period).toEqual(source.frame.period);
  expect(latest.metric).toBe("wasteCost");
  expect(latest.frame).toMatchObject({
    scroll: 0,
    chartScroll: 0,
    detailsOffset: 0,
  });
  expect(labels()).not.toContain("Filtres actifs");
  await act(() => button("Retour à l’analyse précédente").props.onPress());
  expect(latest).toEqual(source);
});

it("exposes all four monetary choices above the result, including the selected purchase-cost waste measure", async () => {
  const callbacks = handlers();
  await act(() => {
    rendered = create(
      createElement(ExplorerContent, {
        ...callbacks,
        view: source,
        data: analysis(source, []),
        syncStatus: "synced",
      }),
    );
  });
  const selected = button("Indicateur : Casse PA");
  expect(selected.props.accessibilityState.checked).toBe(true);
  await act(() => button("Indicateur : Casse PV").props.onPress());
  expect(callbacks.onMetric).toHaveBeenCalledWith("waste");
  const texts = labels();
  expect(texts.indexOf("Casse PA")).toBeLessThan(
    texts.indexOf("Casse au prix d’achat"),
  );
});

it.each([null, "0"])(
  "removes a wholly empty plot but keeps recorded zero values (%s)",
  async (value) => {
    const view = initialExplorerView("2026-10-15");
    const points: DatedKpiValue[] = [
      {
        businessDate: "2026-10-15",
        value,
        status: value === null ? "UNAVAILABLE" : "AVAILABLE",
      },
    ];
    await act(() => {
      rendered = create(
        createElement(ExplorerContent, {
          ...handlers(),
          view,
          data: analysis(view, points),
          syncStatus: "synced",
        }),
      );
    });
    expect(rendered!.root.findAllByType("Chart" as never)).toHaveLength(
      value === null ? 0 : 1,
    );
    expect(labels()).not.toContain("Filtres actifs");
  },
);

it("keeps the full-department shortcut and truthful empty explanation for a filtered calendar period", async () => {
  const view = {
    ...initialExplorerView("2026-10-15"),
    frame: {
      ...initialExplorerView("2026-10-15").frame,
      filters: source.frame.filters,
    },
  };
  await act(() => {
    rendered = create(
      createElement(ExplorerContent, {
        ...handlers(),
        view,
        data: analysis(view, []),
        syncStatus: "synced",
      }),
    );
  });
  expect(button("Afficher tout le rayon pour cette période")).toBeDefined();
  expect(
    rendered!.root.findAllByType("Alert" as never)[0]!.props.message,
  ).toContain("cette sélection");
});

it("preserves product ordering through drill/back and reads legacy frames without options", () => {
  const start = initialExplorerView("2026-10-23");
  const list = {
    trend: "DOWN" as const,
    sort: "DIFFERENCE" as const,
    direction: "ASC" as const,
  };
  const changed = explorerViewSchema.parse({
    ...start,
    frame: { ...start.frame, productList: list, detailsOffset: 20 },
  });
  const child = drillExplorerScope(changed, {
    ...changed.frame.filters,
    productId: "00000000-0000-4000-8000-000000000002",
  });
  expect(child.frame.productList).toEqual(list);
  expect(child.frame.detailsOffset).toBe(0);
  expect(backExplorerView(child)).toEqual(changed);
  expect(explorerViewSchema.parse(start).frame.productList).toBeUndefined();
  expect(
    explorerViewSchema.safeParse({
      ...changed,
      frame: { ...changed.frame, productList: { ...list, sort: "arbitrary" } },
    }).success,
  ).toBe(false);
});
