import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ExplorerPeriod } from "@fl-copilot/analytics-core";
import { ExplorerTrendChart } from "./explorer-trend-chart";
import {
  drillExplorerView,
  explorerViewSchema,
  initialExplorerView,
  type ExplorerView,
} from "./explorer-state";

vi.mock("react-native", () => ({
  ScrollView: "ScrollView",
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
}));
let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const error = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      error(...args);
  });
});
afterEach(async () => {
  await act(() => tree?.unmount());
  tree = undefined;
  vi.unstubAllGlobals();
});
function columns() {
  return tree!.root.findAll(
    (n) =>
      String(n.type) === "Pressable" && n.props.accessibilityRole === "button",
  );
}

it.each([
  ["SUM", "30,00", "cumul"],
  ["AVERAGE", "15,00", "moyenne"],
] as const)(
  "announces the clipped aggregate period and %s meaning, with the same scoped drill and missing/zero distinction",
  async (aggregation, amount, meaning) => {
    const period: ExplorerPeriod = {
      kind: "range",
      current: { start: "2026-01-15", end: "2026-04-04" },
      reference: null,
      aggregation,
      basis: "DEPARTMENT",
    };
    const view = explorerViewSchema.parse({
      ...initialExplorerView("2026-01-15"),
      frame: { ...initialExplorerView("2026-01-15").frame, period },
    });
    let drilled: ExplorerView | undefined;
    await act(() => {
      tree = create(
        createElement(ExplorerTrendChart, {
          period,
          points: [
            { businessDate: "2026-01-05", value: "1000", status: "AVAILABLE" },
            { businessDate: "2026-01-15", value: "10", status: "AVAILABLE" },
            { businessDate: "2026-01-16", value: "20", status: "AVAILABLE" },
            { businessDate: "2026-04-04", value: "0", status: "AVAILABLE" },
          ],
          onDrill: (date) => {
            drilled = drillExplorerView(view, date);
          },
        }),
      );
    });
    const bars = columns();
    expect(bars).toHaveLength(4);
    const january = bars[0]!.props.accessibilityLabel as string;
    expect(january).toContain("15/01/2026");
    expect(january).toContain("31/01/2026");
    expect(january).toContain(meaning);
    expect(
      january.match(/(-?[\d\s]+,\d{2})\s*€/u)?.[1]?.replace(/\s/g, ""),
    ).toBe(amount);
    expect(january).toContain("données incomplètes");
    expect(bars[1]!.props.accessibilityLabel).toContain("sans donnée");
    expect(bars[1]!.props.accessibilityLabel).not.toMatch(/0(?:,00)?\s*€/u);
    const april = bars[3]!.props.accessibilityLabel as string;
    expect(april).toContain("01/04/2026");
    expect(april).toContain("04/04/2026");
    expect(april).toMatch(/0(?:,00)?\s*€/u);
    expect(april).not.toContain("sans donnée");
    await act(() => bars[3]!.props.onPress());
    expect(drilled!.frame.period).toMatchObject({
      current: { start: "2026-04-01", end: "2026-04-04" },
      aggregation,
    });
    expect(drilled!.history.at(-1)).toEqual(view.frame);
  },
);
it("announces a year column as a full month without changing its monthly destination", async () => {
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
  const january = columns()[0]!;
  expect(january.props.accessibilityLabel).toContain("01/01/2026");
  expect(january.props.accessibilityLabel).toContain("31/01/2026");
  await act(() => january.props.onPress());
  expect(onDrill).toHaveBeenCalledExactlyOnceWith("2026-01-01");
});

it.each([
  ["10", "-5"],
  ["-10", "-5"],
  ["10", "5"],
  ["0", "0"],
] as const)(
  "draws %s and %s on the correct side of one zero line without changing drill values",
  async (first, second) => {
    const onDrill = vi.fn();
    await act(() => {
      tree = create(
        createElement(ExplorerTrendChart, {
          period: { kind: "week", year: 2026, week: 45 },
          points: [
            { businessDate: "2026-11-02", value: first, status: "AVAILABLE" },
            { businessDate: "2026-11-03", value: second, status: "PARTIAL" },
            { businessDate: "2026-11-04", value: null, status: "UNAVAILABLE" },
          ],
          onDrill,
        }),
      );
    });
    const bars = columns();
    const geometry = (index: number) => {
      const views = bars[index]!.findAll((n) => String(n.type) === "View");
      const mark = views.find(
        (n) => n.props.style?.backgroundColor && n.props.style?.height >= 2,
      )!;
      const baseline = views.find((n) => n.props.style?.height === 1)!;
      expect(mark).toBeDefined();
      const oldPlot = views.find((n) => n.props.style?.borderBottomWidth === 1);
      const zero = (baseline?.props.style.top ??
        oldPlot?.props.style.height) as number;
      const height = mark.props.style.height as number;
      const top = (mark.props.style.top ?? zero - height) as number;
      expect(top).toBeGreaterThanOrEqual(0);
      expect(top + height).toBeLessThanOrEqual(132);
      return { top, height, zero };
    };
    const a = geometry(0),
      b = geometry(1);
    expect(a.zero).toBe(b.zero);
    for (const [value, g] of [
      [first, a],
      [second, b],
    ] as const) {
      if (Number(value) > 0) expect(g.top + g.height).toBeCloseTo(g.zero);
      if (Number(value) < 0) expect(g.top).toBeCloseTo(g.zero);
    }
    if (first === "10" && second === "-5")
      expect(a.height / b.height).toBeCloseTo(2);
    expect(bars[1]!.props.accessibilityLabel).toContain("données incomplètes");
    expect(bars[2]!.props.accessibilityLabel).toContain("sans donnée");
    expect(
      bars[2]!.findAll(
        (n) =>
          String(n.type) === "View" &&
          n.props.style?.backgroundColor &&
          n.props.style?.height >= 2,
      ),
    ).toHaveLength(0);
    if (first === "0")
      expect(bars[0]!.props.accessibilityLabel).toMatch(/0(?:,00)?\s*€/u);
    await act(() => bars[1]!.props.onPress());
    expect(onDrill).toHaveBeenCalledExactlyOnceWith("2026-11-03");
  },
);
