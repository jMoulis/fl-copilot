import { expect, it } from "vitest";
import { resolveCopilotComparison } from "./copilot-comparison-period";
it("aligns the actual October chat's N-1 with ISO weekdays, including a truncated month", () => {
  const input = {
    currentPeriod: { start: "2026-10-01", end: "2026-10-30" },
    referencePeriod: { start: "2025-10-01", end: "2025-10-30" },
  };
  expect(resolveCopilotComparison(input).referencePeriod).toEqual({
    start: "2025-10-02",
    end: "2025-10-31",
  });
  expect(resolveCopilotComparison(resolveCopilotComparison(input))).toEqual(
    resolveCopilotComparison(input),
  );
  expect(
    resolveCopilotComparison({ ...input, referenceMode: "CUSTOM" }),
  ).toEqual({ ...input, referenceMode: "CUSTOM" });
});
it("keeps independent references and refuses an unavailable ISO week instead of silently using civil dates", () => {
  const custom = {
    currentPeriod: { start: "2026-10-01", end: "2026-10-30" },
    referencePeriod: { start: "2026-09-01", end: "2026-09-30" },
  };
  expect(resolveCopilotComparison(custom)).toEqual(custom);
  expect(() =>
    resolveCopilotComparison({
      currentPeriod: { start: "2026-12-28", end: "2027-01-03" },
      referencePeriod: null,
      referenceMode: "ISO_YEAR",
    }),
  ).toThrow("COPILOT_ISO_REFERENCE_UNAVAILABLE");
});
