import { describe, expect, it } from "vitest";
import {
  formatBusinessDate,
  formatSignedCurrency,
  formatSignedPercentage,
  jMinus7,
  priorityPresentation,
} from "./today-priority-presentation";
import type { TodayPriority } from "./today-summary";

const marginPriority: TodayPriority = {
  id: "candidate:margin",
  rank: 1,
  type: "MARGIN_DROP",
  productId: "product-1",
  productLabel: "BANANE VRAC",
  currentValue: "3.30",
  referenceValue: "46.48",
  absoluteDifference: "-43.18",
  percentageDifference: "-92.90",
  dataQualityScore: 0.6667,
  status: "LOW_QUALITY",
  incompleteMetricLabels: ["Casse au PA"],
};

describe("Today priority presentation", () => {
  it("explains a margin signal without turning it into a decision", () => {
    expect(priorityPresentation(marginPriority)).toEqual({
      title: "Examiner la marge — BANANE VRAC",
      reason: "La marge baisse par rapport à J-7.",
      action: "Vérifier le prix de vente et le coût d’achat.",
      metricLabel: "Marge",
    });
  });

  it("labels exact dates and signed evidence", () => {
    expect(jMinus7("2026-01-03")).toBe("2025-12-27");
    expect(formatBusinessDate("2026-10-03")).toContain("3 octobre 2026");
    expect(formatSignedCurrency("-43.18")).toContain("−43,18");
    expect(formatSignedPercentage("-92.90")).toBe("−92,9 %");
  });
});
