import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { copilotChartSchema } from "@fl-copilot/domain";
import { AssistantAnswer } from "./assistant-answer";
import { AnswerChart } from "./answer-chart";
vi.mock("react-native", () => ({
  StyleSheet: { create: (value: unknown) => value },
  View: "View",
  Text: "Text",
  ScrollView: "ScrollView",
  Pressable: "Pressable",
}));
let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      original(...args);
  });
});
afterEach(async () => {
  await act(() => tree?.unmount());
  tree = undefined;
  vi.unstubAllGlobals();
});
it.each(["BARS", "LINE"])(
  "shows zero, a missing gap and a negative amount with touch/scroll/source access (%s)",
  async (type) => {
    const chart = copilotChartSchema.parse({
      version: 1,
      type,
      title: "CA",
      unit: "EUR",
      labels: ["Jour A", "Jour B", "Jour C"],
      series: [
        {
          label: "Actuel",
          period: { start: "2026-10-01", end: "2026-10-03" },
          points: [
            { value: "0", status: "AVAILABLE" },
            { value: null, status: "UNAVAILABLE" },
            { value: "-5", status: "PARTIAL" },
          ],
        },
      ],
    });
    const source = vi.fn();
    await act(() => {
      tree = create(createElement(AnswerChart, { chart, onSource: source }));
    });
    const buttons = tree!.root.findAll(
      (n) => typeof n.type === "string" && String(n.type) === "Pressable",
    );
    expect(buttons[0]!.props.accessibilityLabel).toContain("0,00");
    expect(buttons[1]!.props.accessibilityLabel).toContain("Sans donnée");
    await act(() => buttons[2]!.props.onPress());
    expect(JSON.stringify(tree!.toJSON())).toContain("-5,00");
    expect(tree!.root.findByType("ScrollView" as never).props.horizontal).toBe(
      true,
    );
    await act(() => buttons[3]!.props.onPress());
    expect(source).toHaveBeenCalledTimes(1);
  },
);

vi.mock("expo-router", () => ({ router: { navigate: vi.fn() } }));
vi.mock("expo-crypto", () => ({ randomUUID: vi.fn() }));
vi.mock("../components/ui", () => ({
  BottomSheet: "BottomSheet",
  SecondaryButton: "Button",
}));
it("restores a chart from a persisted answer and opens its existing source sheet without a fetch", async () => {
  const source = {
    label: "CA net",
    sourceId: "query-chart",
    sourceType: "KPI",
    value: null,
    analyticsContext: {
      schemaVersion: 1,
      period: {
        kind: "range",
        current: { start: "2026-10-01", end: "2026-10-01" },
        reference: null,
        aggregation: "SUM",
        basis: "OBSERVED_PRODUCTS",
      },
      metric: "sales",
      filters: { category: null, nature: null, productId: null },
    },
    chart: {
      version: 1,
      type: "LINE",
      title: "Évolution du CA",
      unit: "EUR",
      labels: ["2026-10-01"],
      series: [
        {
          label: "Actuel",
          period: { start: "2026-10-01", end: "2026-10-01" },
          points: [{ value: "12", status: "AVAILABLE" }],
        },
      ],
    },
  };
  const text = JSON.parse(
    JSON.stringify(
      `Voici le graphique.\n\n[Graphique](copilot-source:${encodeURIComponent(JSON.stringify(source))})`,
    ),
  );
  await act(() => {
    tree = create(createElement(AssistantAnswer, { text }));
  });
  const chart = tree!.root.findByType(AnswerChart);
  expect(chart.props.chart.title).toBe("Évolution du CA");
  expect(tree!.root.findByType("BottomSheet" as never).props.visible).toBe(
    false,
  );
  await act(() => chart.props.onSource());
  expect(tree!.root.findByType("BottomSheet" as never).props.visible).toBe(
    true,
  );
  expect(JSON.stringify(tree!.toJSON())).not.toContain("Valeur non disponible");
});
