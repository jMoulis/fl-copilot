import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { compareJMinus7, type FormulaStatus } from "@fl-copilot/analytics-core";
import { DashboardMetric } from "../components/dashboard";
import { applyExplorerLink } from "../analytics/explorer-link";
import { initialExplorerView } from "../analytics/explorer-state";
import { TodayContent } from "./today-overview";
import type { TodayKpi, TodaySummary } from "./today-summary";
import { colors } from "../design/tokens";
import { TodayNativeContent } from "./today-native-overview";

const runtime = vi.hoisted(() => ({
  navigate: vi.fn(),
  push: vi.fn(),
  width: 390,
  fontScale: 1,
  library: vi.fn(),
}));
vi.mock("react-native", () => ({
  Text: "Text",
  View: "View",
  Pressable: "Pressable",
  useWindowDimensions: () => ({
    width: runtime.width,
    fontScale: runtime.fontScale,
  }),
}));
vi.mock("expo-router", () => ({
  router: { navigate: runtime.navigate, push: runtime.push },
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000001",
}));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Icon" }));
vi.mock("../products/linked-product-visual", () => ({
  LinkedProductVisual: "ProductThumbnail",
}));
vi.mock("../products/use-visual-library", () => ({
  useVisualLibrary: runtime.library,
}));
vi.mock("../components/ui", () => ({
  StatusBadge: () => null,
  SectionCard: ({ children }: { children: React.ReactNode }) => children,
  InlineAlert: () => null,
  SecondaryButton: () => null,
}));

let rendered: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (String(args[0]).includes("react-test-renderer is deprecated")) return;
    original(...args);
  });
  runtime.navigate.mockReset();
  runtime.push.mockReset();
  runtime.width = 390;
  runtime.fontScale = 1;
  runtime.library.mockReset().mockReturnValue({
    context: { storeId: "store-a" },
    state: null,
    readUri: vi.fn(),
  });
});
afterEach(async () => {
  await act(() => rendered?.unmount());
  rendered = undefined;
  vi.unstubAllGlobals();
});
function kpi(
  id: TodayKpi["id"],
  value: string | null,
  status: FormulaStatus,
): TodayKpi {
  return {
    id,
    value,
    status,
    label:
      id === "sales" ? "Ventes" : id === "margin" ? "Marge" : "Casse au PA",
    comparison: compareJMinus7({
      kpiId: id,
      current: { businessDate: "2026-10-23", value, status },
      history: [
        { businessDate: "2026-10-16", value: "10", status: "AVAILABLE" },
      ],
    }),
  };
}
async function render(
  kpis: TodayKpi[],
  patch: Partial<TodaySummary> = {},
  native = false,
) {
  const summary: TodaySummary = {
    businessDate: "2026-10-23",
    computedAt: "2026-10-23T13:00:00Z",
    origin: "LOCAL",
    productCount: 3,
    kpis,
    priorities: [],
    movements: [],
    tensions: [],
    dataQuality: {
      unresolvedProductCount: 0,
      incompleteKpiLabels: [],
      alertMessage: null,
    },
    ...patch,
  };
  await act(() => {
    rendered = create(
      createElement(native ? TodayNativeContent : TodayContent, { summary }),
    );
  });
}
function text() {
  return rendered!.root
    .findAllByType("Text" as never)
    .map((n) => n.children.filter((c) => typeof c === "string").join(""));
}

it("qualifies a partial known zero on the card and for VoiceOver without making a full or favourable comparison", async () => {
  await render([kpi("sales", "0", "PARTIAL")]);
  expect(text()).toContain("0,00 €");
  expect(text()).toContain("Cumul partiel");
  expect(text().some((label) => label.includes("Comparaison partielle"))).toBe(
    true,
  );
  const metric = rendered!.root.findByType(DashboardMetric);
  expect(metric.props.tone).toBe("neutral");
  const button = rendered!.root
    .findAllByType("Pressable" as never)
    .find((n) => String(n.props.accessibilityLabel).startsWith("Ventes :"))!;
  expect(button.props.accessibilityLabel).toContain("cumul partiel");
  await act(() => button.props.onPress());
  const href = runtime.navigate.mock.calls[0][0];
  const opened = applyExplorerLink(
    initialExplorerView("2026-10-01"),
    href.params.selection,
  );
  expect(opened.metric).toBe("sales");
  expect(opened.frame.period).toEqual({ kind: "day", date: "2026-10-23" });
});

it("keeps missing values unavailable and complete values free of a partial label", async () => {
  await render([
    kpi("sales", null, "UNAVAILABLE"),
    kpi("margin", "20", "AVAILABLE"),
  ]);
  expect(text()).toContain("Indisponible");
  expect(text()).toContain("20,00 €");
  expect(text()).not.toContain("Cumul partiel");
  expect(rendered!.root.findAllByType(DashboardMetric)[1].props.tone).toBe(
    "positive",
  );
});

it("stacks the secondary metrics at large text sizes without truncating labels or values", async () => {
  runtime.fontScale = 1.6;
  await render([
    kpi("sales", "1000", "AVAILABLE"),
    kpi("margin", "200", "AVAILABLE"),
    kpi("waste", null, "UNAVAILABLE"),
  ]);
  for (const metric of rendered!.root.findAllByType(DashboardMetric)) {
    expect(metric.props.compact).toBe(false);
    expect(metric.parent!.props.style.width).toBe("100%");
  }
});

it("shares one visual library across three priorities and five movements, with short headings, readable ranks and scoped links", async () => {
  const priorities: TodaySummary["priorities"] = Array.from(
    { length: 3 },
    (_, i) => ({
      id: `priority-${i}`,
      rank: i + 1,
      type: "MARGIN_DROP",
      productId: `product-${i}`,
      productLabel: `BANANE BIO ${i}`,
      currentValue: "20",
      referenceValue: "100",
      absoluteDifference: "-80",
      percentageDifference: "-80",
      dataQualityScore: 1,
      status: "ACTIVE",
      incompleteMetricLabels: [],
    }),
  );
  const movements: TodaySummary["movements"] = Array.from(
    { length: 5 },
    (_, i) => ({
      id: `movement-${i}`,
      productId: `product-${i}`,
      productLabel: `POMME ${i}`,
      metric: "WASTE",
      absoluteDifference: "-20",
      percentageDifference: "-50",
    }),
  );
  await render([], { priorities, movements }, true);
  expect(runtime.library).toHaveBeenCalledTimes(1);
  const visuals = runtime.library.mock.results[0].value;
  const thumbnails = rendered!.root.findAllByType("ProductThumbnail" as never);
  expect(thumbnails).toHaveLength(8);
  thumbnails.forEach((n, i) => {
    expect(n.props.storeId).toBe("store-a");
    expect(n.props.visuals).toBe(visuals);
    expect(n.props.productId).toBe(`product-${i < 3 ? i : i - 3}`);
    expect(n.props.size).toBe(i < 3 ? 56 : 44);
  });
  expect(text().filter((s) => s === "Examiner la marge")).toHaveLength(3);
  const rank = rendered!.root
    .findAllByType("Text" as never)
    .find((n) => n.children[0] === "1")!;
  expect(rank.props.className).toContain("text-on-accent");
  const buttons = rendered!.root.findAllByType("Pressable" as never);
  const priority = buttons.find((n) =>
    String(n.props.accessibilityLabel).startsWith("1. Examiner la marge"),
  )!;
  expect(priority.props.accessibilityLabel).toContain("BANANE BIO 0");
  await act(() => priority.props.onPress());
  expect(runtime.push).toHaveBeenLastCalledWith({
    pathname: "/(tabs)/priority/[id]",
    params: { id: "priority-0" },
  });
  const movement = buttons.find((n) =>
    String(n.props.accessibilityLabel).startsWith("POMME 0."),
  )!;
  await act(() => movement.props.onPress());
  expect(runtime.push).toHaveBeenLastCalledWith("/(tabs)/products/product-0");
  const trends = rendered!.root
    .findAllByType("Icon" as never)
    .filter((n) => n.props.name === "trending-down");
  expect(trends).toHaveLength(5);
  expect(trends.every((n) => n.props.color === colors.positive)).toBe(true);
});

it("does not mount a visual observer for an empty overview", async () => {
  await render([], {}, true);
  expect(runtime.library).not.toHaveBeenCalled();
  expect(
    rendered!.root.findAllByType("ProductThumbnail" as never),
  ).toHaveLength(0);
});
