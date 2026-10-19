import { it, expect } from "vitest";
import { wastePurchaseCost } from "./waste-purchase-cost";
it("retains Today's exact known/estimated policy without inventing zero or replacing cost with selling value", () => {
  expect(wastePurchaseCost({ waste: {}, availability: {} })).toEqual({
    value: null,
    status: "UNAVAILABLE",
  });
  expect(
    wastePurchaseCost({
      waste: { purchaseValueKnown: "0" },
      availability: { wastePurchaseValueKnown: { status: "AVAILABLE" } },
    }),
  ).toEqual({ value: "0", status: "AVAILABLE" });
  expect(
    wastePurchaseCost({
      waste: { purchaseValueKnown: "3.25", purchaseValueEstimated: "2.25" },
      availability: {
        wastePurchaseValueKnown: { status: "AVAILABLE" },
        wastePurchaseValueEstimated: { status: "AVAILABLE" },
      },
    }),
  ).toEqual({ value: "5.50", status: "AVAILABLE" });
  expect(
    wastePurchaseCost({
      waste: { purchaseValueEstimated: "2.25" },
      availability: { wastePurchaseValueEstimated: { status: "AVAILABLE" } },
    }),
  ).toEqual({ value: "2.25", status: "PARTIAL" });
});
