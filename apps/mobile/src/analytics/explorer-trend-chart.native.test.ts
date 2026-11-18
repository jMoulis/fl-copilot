import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ExplorerPeriod } from "@fl-copilot/analytics-core";
import { ExplorerTrendChart } from "./explorer-trend-chart";
import {
  backExplorerView,
  drillExplorerView,
  explorerViewSchema,
  initialExplorerView,
  type ExplorerView,
} from "./explorer-state";
vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
}));
let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  await act(() => tree?.unmount());
  tree = undefined;
  vi.unstubAllGlobals();
});
const plot = () => tree!.root.findByProps({ testID: "explorer-chart-plot" });
const detail = () =>
  tree!.root
    .findAll(
      (n) =>
        String(n.type) === "Pressable" &&
        n.props.accessibilityRole === "button",
    )
    .at(-1)!;
async function select(fraction: number) {
  await act(() =>
    plot().props.onLayout({ nativeEvent: { layout: { width: 300 } } }),
  );
  await act(() =>
    plot().props.onPress({ nativeEvent: { locationX: 300 * fraction } }),
  );
}
it.each([
  ["SUM", "30,00", "Cumul"],
  ["AVERAGE", "15,00", "Moyenne"],
] as const)(
  "preserves clipped %s buckets, selects before drilling, and restores the selected bucket on return",
  async (aggregation, amount, meaning) => {
    const period: ExplorerPeriod = {
      kind: "range",
      current: { start: "2026-01-15", end: "2026-04-04" },
      reference: null,
      aggregation,
      basis: "DEPARTMENT",
    };
    let view = explorerViewSchema.parse({
      ...initialExplorerView("2026-01-15"),
      frame: { ...initialExplorerView("2026-01-15").frame, period },
    });
    let drilled: ExplorerView | undefined;
    const onDrill = vi.fn((date: string) => {
      drilled = drillExplorerView(view, date);
    });
    const points = [
      {
        businessDate: "2026-01-05",
        value: "1000",
        status: "AVAILABLE" as const,
      },
      { businessDate: "2026-01-15", value: "10", status: "AVAILABLE" as const },
      { businessDate: "2026-01-16", value: "20", status: "AVAILABLE" as const },
      { businessDate: "2026-04-04", value: "0", status: "AVAILABLE" as const },
    ];
    await act(() => {
      tree = create(
        createElement(ExplorerTrendChart, {
          period,
          points,
          onDrill,
          onSelect: (chartDate) => {
            view = { ...view, frame: { ...view.frame, chartDate } };
          },
        }),
      );
    });
    expect(plot().props.accessibilityLabel).toContain("15/01/2026");
    expect(plot().props.accessibilityLabel).toContain("31/01/2026");
    expect(plot().props.accessibilityLabel).toContain(meaning);
    expect(plot().props.accessibilityLabel).toContain(amount);
    await select(0.3);
    expect(plot().props.accessibilityLabel).toContain("sans donnée");
    await select(0.99);
    expect(plot().props.accessibilityLabel).toContain("04/04/2026");
    expect(plot().props.accessibilityLabel).toContain("0,00");
    expect(plot().props.accessibilityLabel).not.toContain("sans donnée");
    expect(onDrill).not.toHaveBeenCalled();
    await act(() => detail().props.onPress());
    expect(onDrill).toHaveBeenCalledExactlyOnceWith("2026-04-01");
    expect(drilled!.frame.period).toMatchObject({
      current: { start: "2026-04-01", end: "2026-04-04" },
      aggregation,
    });
    const restored = backExplorerView(drilled!);
    expect(restored.frame.chartDate).toBe("2026-04-01");
    await act(() => tree!.unmount());
    await act(() => {
      tree = create(
        createElement(ExplorerTrendChart, {
          period,
          points,
          selectedDate: restored.frame.chartDate,
          onDrill,
        }),
      );
    });
    expect(plot().props.accessibilityValue.now).toBe(4);
  },
);
it("allows accessible stepping through a whole year without navigation until the explicit action", async () => {
  const onDrill = vi.fn();
  await act(() => {
    tree = create(
      createElement(ExplorerTrendChart, {
        period: { kind: "year", year: 2026 },
        points: [
          { businessDate: "2026-01-01", value: "42", status: "AVAILABLE" },
        ],
        onDrill,
      }),
    );
  });
  expect(plot().props.accessibilityValue.max).toBe(12);
  await act(() =>
    plot().props.onAccessibilityAction({
      nativeEvent: { actionName: "increment" },
    }),
  );
  expect(plot().props.accessibilityLabel).toContain("01/02/2026");
  expect(onDrill).not.toHaveBeenCalled();
  await act(() => detail().props.onPress());
  expect(onDrill).toHaveBeenCalledExactlyOnceWith("2026-02-01");
});
it.each([
  ["10", "-5"],
  ["-10", "-5"],
  ["10", "5"],
  ["0", "0"],
] as const)(
  "keeps signed values %s / %s and unknown days distinct in a bounded full-width chart",
  async (first, second) => {
    await act(() => {
      tree = create(
        createElement(ExplorerTrendChart, {
          period: { kind: "week", year: 2026, week: 45 },
          points: [
            { businessDate: "2026-11-02", value: first, status: "AVAILABLE" },
            { businessDate: "2026-11-03", value: second, status: "PARTIAL" },
            { businessDate: "2026-11-04", value: null, status: "UNAVAILABLE" },
          ],
          onDrill: vi.fn(),
        }),
      );
    });
    const marks = ["02", "03"].map(
      (day) =>
        tree!.root
          .findByProps({ testID: `chart-bin:2026-11-${day}` })
          .findByProps({ testID: "chart-mark" }).props.style,
    );
    for (const m of marks) {
      expect(m.top).toBeGreaterThanOrEqual(0);
      expect(m.top + m.height).toBeLessThanOrEqual(152);
    }
    if (Number(first) > 0 && Number(second) < 0) {
      expect(marks[0].top + marks[0].height).toBeCloseTo(marks[1].top);
      expect(marks[0].height / marks[1].height).toBeCloseTo(2);
    }
    expect(
      tree!.root
        .findByProps({ testID: "chart-bin:2026-11-04" })
        .findAllByProps({ testID: "chart-mark" }),
    ).toHaveLength(0);
    await select(1.5 / 7);
    expect(plot().props.accessibilityLabel).toContain("Données incomplètes");
    await select(2.5 / 7);
    expect(plot().props.accessibilityLabel).toContain("sans donnée");
  },
);
