import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import { compareExplorerPeriod } from "@fl-copilot/analytics-core";
import { emptyExplorerFilters } from "@fl-copilot/domain";
import { ExplorerContent } from "./explorer-view";
import { initialExplorerView } from "./explorer-state";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  Text: "Text",
  View: "View",
}));
vi.mock("../components/ui", () => ({
  BottomSheet: "BottomSheet",
  InlineAlert: "InlineAlert",
  SecondaryButton: "SecondaryButton",
  StatusBadge: "StatusBadge",
}));
vi.mock("../components/dashboard", () => ({
  DetailsDisclosure: "DetailsDisclosure",
  SegmentedControl: "SegmentedControl",
}));
vi.mock("../components/date-selector", () => ({
  DateSelector: "DateSelector",
}));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Icon" }));
vi.mock("./explorer-trend-chart", () => ({
  ExplorerTrendChart: "ExplorerTrendChart",
}));
vi.mock("./explorer-breakdown", () => ({
  explorerScopeLabel: () => "Ensemble du rayon",
}));

it.each([true, false])(
  "shows a usable partial delta or an actionable missing-pair explanation (baseline=%s)",
  async (baseline) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const error = console.error;
    const silence = vi.spyOn(console, "error").mockImplementation((...args) => {
      if (!String(args[0]).includes("react-test-renderer is deprecated"))
        error(...args);
    });
    const period = { kind: "day" as const, date: "2026-10-23" };
    const data = {
      ...compareExplorerPeriod({
        period,
        today: "2026-10-30",
        kpiId: "sales",
        points: [
          { businessDate: "2026-10-23", value: "100", status: "PARTIAL" },
          ...(baseline
            ? [
                {
                  businessDate: "2025-10-24",
                  value: "80",
                  status: "AVAILABLE" as const,
                },
              ]
            : []),
        ],
      }),
      filters: emptyExplorerFilters(),
      details: null,
      detailsUnavailable: false,
    };
    const initial = initialExplorerView(period.date);
    let tree: ReturnType<typeof create> | undefined;
    try {
      await act(() => {
        tree = create(
          createElement(ExplorerContent, {
            view: { ...initial, frame: { ...initial.frame, period } },
            data,
            syncStatus: "synced",
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
          }),
        );
      });
      const text = JSON.stringify(tree!.toJSON());
      expect(text).toContain("100,00");
      if (baseline) {
        expect(text).toContain("Indicatif");
        expect(text).toContain("80,00");
        expect(text).toContain("Données partielles");
        expect(text).not.toContain("Comparaison indisponible");
      } else
        expect(text).toContain(
          "Pas de journée close renseignée des deux côtés",
        );
    } finally {
      await act(() => tree?.unmount());
      silence.mockRestore();
      vi.unstubAllGlobals();
    }
  },
);
