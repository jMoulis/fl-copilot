import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { compareJMinus7, type FormulaStatus } from "@fl-copilot/analytics-core";
import { DashboardMetric } from "../components/dashboard";
import { applyExplorerLink } from "../analytics/explorer-link";
import { initialExplorerView } from "../analytics/explorer-state";
import { TodayContent } from "./today-overview";
import type { TodayKpi, TodaySummary } from "./today-summary";

const runtime = vi.hoisted(() => ({
  navigate: vi.fn(),
  width: 390,
  fontScale: 1,
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
  router: { navigate: runtime.navigate, push: vi.fn() },
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000001",
}));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Icon" }));
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
  runtime.width = 390;
  runtime.fontScale = 1;
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
async function render(kpis: TodayKpi[]) {
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
  };
  await act(() => {
    rendered = create(createElement(TodayContent, { summary }));
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
