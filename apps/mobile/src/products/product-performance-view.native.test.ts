import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  compareExplorerPeriod,
  type ExplorerPeriod,
} from "@fl-copilot/analytics-core";
import { emptyExplorerFilters } from "@fl-copilot/domain";
import {
  initialExplorerView,
  type ExplorerView,
} from "../analytics/explorer-state";
import {
  ProductPerformanceView,
  type ProductPerformanceData,
} from "./product-performance-view";

vi.mock("react-native", () => ({
  Text: "Text",
  View: "View",
  Pressable: "Pressable",
}));
vi.mock("../components/dashboard", () => ({
  IconButton: "IconButton",
  SegmentedControl: "SegmentedControl",
}));
vi.mock("../components/ui", () => ({
  BottomSheet: ({
    visible,
    children,
  }: {
    visible: boolean;
    children: ReactNode;
  }) => (visible ? children : null),
  InlineAlert: "Alert",
  SecondaryButton: "Button",
}));
vi.mock("../analytics/explorer-trend-chart", () => ({
  ExplorerTrendChart: "Chart",
}));
let rendered: ReactTestRenderer | undefined;
const actions = {
  onMetric: vi.fn(),
  onShift: vi.fn(),
  onExplore: vi.fn(),
  onScroll: vi.fn(),
  onRefresh: vi.fn(),
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      original(...args);
  });
  Object.values(actions).forEach((fn) => fn.mockReset());
});
afterEach(async () => {
  await act(async () => rendered?.unmount());
  rendered = undefined;
  vi.unstubAllGlobals();
});
function canonical(
  period: ExplorerPeriod,
  metric: "sales" | "margin" | "waste",
  value: string | null,
) {
  return {
    ...compareExplorerPeriod({
      period,
      today: "2026-11-15",
      kpiId: metric,
      points:
        value === null
          ? []
          : [{ businessDate: "2026-11-02", value, status: "PARTIAL" }],
    }),
    filters: emptyExplorerFilters(),
    details: null,
    detailsUnavailable: false,
  };
}
async function mount(view: ExplorerView, data: ProductPerformanceData) {
  await act(async () => {
    rendered = create(
      createElement(ProductPerformanceView, { view, data, ...actions }),
    );
  });
}
function control(type: string, label: string) {
  return rendered!.root
    .findAllByType(type as never)
    .find((n) => (n.props.label ?? n.props.accessibilityLabel) === label)!;
}
function text() {
  return rendered!.root
    .findAllByType("Text" as never)
    .map((n) =>
      n.children
        .filter((c) => typeof c === "string" || typeof c === "number")
        .join(""),
    )
    .join("\n");
}

it("keeps the inherited week, canonical chart points, scroll and explicit drill navigation", async () => {
  const view = initialExplorerView("2026-11-02");
  view.frame.chartScroll = 137;
  const sales = canonical(view.frame.period, "sales", "12.50");
  await mount(view, { sales });
  const chart = rendered!.root.findByType("Chart" as never);
  expect(chart.props.period).toEqual(view.frame.period);
  expect(chart.props.points).toEqual(sales.points);
  expect(chart.props.scrollOffset).toBe(137);
  await act(async () => {
    chart.props.onChartScroll(205);
    chart.props.onDrill("2026-11-02");
  });
  expect(actions.onScroll).toHaveBeenCalledExactlyOnceWith(205);
  expect(actions.onExplore).toHaveBeenCalledExactlyOnceWith({
    kind: "day",
    date: "2026-11-02",
  });
  await act(async () =>
    control("IconButton", "Période précédente").props.onPress(),
  );
  expect(actions.onShift).toHaveBeenCalledExactlyOnceWith(-1);
});

it("shows a real zero separately from missing secondary data and keeps coverage behind the information control", async () => {
  const view = initialExplorerView("2026-11-02");
  await mount(view, {
    sales: canonical(view.frame.period, "sales", "0"),
    margin: canonical(view.frame.period, "margin", "0"),
    waste: canonical(view.frame.period, "waste", null),
  });
  expect(text()).toContain("0,00");
  expect(text()).toContain("Indisponible");
  expect(text()).toContain("Cumul partiel");
  expect(text()).not.toContain("0 jours complets");
  await act(async () =>
    control("IconButton", "Comprendre les chiffres du produit").props.onPress(),
  );
  expect(text()).toContain("0 jours complets · 1 partiel · 6 sans donnée");
  expect(text()).toContain("Les jours sans donnée ne valent pas zéro");
  await act(async () =>
    control("Button", "Fermer les explications").props.onPress(),
  );
  expect(text()).not.toContain("0 jours complets");
});

it("preserves source averages and fixed range guards instead of presenting them as movable totals", async () => {
  const view = initialExplorerView("2026-11-02");
  view.frame.period = {
    kind: "range",
    current: { start: "2026-11-02", end: "2026-11-03" },
    reference: null,
    aggregation: "AVERAGE",
    basis: "OBSERVED_PRODUCTS",
  };
  await mount(view, { sales: canonical(view.frame.period, "sales", "5") });
  expect(text()).toContain("Moyenne journalière, pas un cumul.");
  expect(control("IconButton", "Période précédente").props.disabled).toBe(true);
  expect(control("IconButton", "Période suivante").props.disabled).toBe(true);
  await act(async () =>
    control("SegmentedControl", "Chiffres du produit").props.onChange(
      "wasteCost",
    ),
  );
  expect(actions.onMetric).toHaveBeenCalledExactlyOnceWith("wasteCost");
});
