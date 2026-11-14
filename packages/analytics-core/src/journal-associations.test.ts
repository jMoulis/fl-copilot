import { expect, it } from "vitest";
import {
  addContextDays,
  journalAssociationInputSchema,
} from "@fl-copilot/domain";
import {
  describeJournalAssociations,
  spearmanRank,
  weatherDifference,
  type JournalAssociationPair,
} from "./journal-associations";

const sample = (): JournalAssociationPair[] =>
  Array.from({ length: 28 }, (_, i) => ({
    date: addContextDays("2026-10-05", i),
    calendarMatched: true,
    recordedEvent: false,
    salesChange: String(i),
    marginChange: String(27 - i),
    temperatureDelta: String(i),
    rainfallDelta: "0",
  }));
it("ranks increasing, decreasing and average tied ranks without changing decimal source ties", () => {
  expect(spearmanRank(["1", "2", "3"], ["3", "2", "1"])).toBe(-1);
  expect(spearmanRank(["1.00", "1", "2"], ["1", "2", "3"])).toBeCloseTo(
    Math.sqrt(3) / 2,
  );
  expect(
    spearmanRank(
      [
        "100000000000000000001",
        "100000000000000000002",
        "100000000000000000003",
      ],
      ["1", "2", "3"],
    ),
  ).toBe(1);
  expect(weatherDifference("0.3", "0.1")).toBe("0.2");
});
it("does not turn constant data, missing support or invalid inputs into a zero coefficient", () => {
  expect(spearmanRank(["1", "1", "1"], ["1", "2", "3"])).toBeNull();
  expect(spearmanRank(["1", "2"], ["1", "2"])).toBeNull();
  expect(() => spearmanRank(["1"], [])).toThrow();
  expect(() => spearmanRank(["NaN"], ["1"])).toThrow();
  expect(weatherDifference(null, "0")).toBeNull();
});
it("renders all four fixed analyses, independent metrics and week sensitivity", () => {
  const r = describeJournalAssociations(sample());
  expect(r).toHaveLength(4);
  expect(r[0]).toMatchObject({
    status: "ASSOCIATION_OBSERVED",
    pairs: 28,
    weeks: 4,
    rho: 1,
    leaveOneWeekOut: { evaluatedWeeks: 4, min: 1, max: 1, sameDirection: true },
  });
  expect(r[2]?.rho).toBe(-1);
  expect(r[1]).toMatchObject({ status: "UNDEFINED", rho: null });
});
it("flags a direction reversed by removing a week instead of calling the full-sample correlation robust", () => {
  const rows = sample().map((p, i) => ({
    ...p,
    salesChange: String(i < 21 ? 21 - i : 100 + i),
  }));
  expect(describeJournalAssociations(rows)[0]).toMatchObject({
    status: "FRAGILE",
    leaveOneWeekOut: { sameDirection: false, min: -1 },
  });
});
it("keeps disjoint exclusion counts and never imputes missing measurements or mismatched calendars", () => {
  const rows = sample();
  rows[0]!.calendarMatched = false;
  rows[1]!.salesChange = null;
  rows[2]!.temperatureDelta = null;
  const r = describeJournalAssociations(rows)[0]!;
  expect(r.excluded).toEqual({ calendar: 1, business: 1, weather: 1 });
  expect(r.pairs).toBe(25);
  expect(describeJournalAssociations(rows.slice(0, 20))[0]?.status).toBe(
    "INSUFFICIENT_DATA",
  );
});
it("retains the original sample and explicitly recomputes the no-recorded-event variant", () => {
  const rows = sample();
  rows[0]!.recordedEvent = true;
  expect(describeJournalAssociations(rows)[0]).toMatchObject({
    pairs: 28,
    withoutRecordedEvents: { pairs: 27, rho: 1 },
  });
});
it("rejects duplicated dates and excessive windows", () => {
  expect(() =>
    describeJournalAssociations([...sample(), sample()[0]!]),
  ).toThrow("ASSOCIATION_SAMPLE_INVALID");
  const q = {
    startDate: "2026-01-01",
    endDate: "2026-04-04",
    referenceMode: "YEAR_OVER_YEAR",
    familyId: null,
  };
  expect(journalAssociationInputSchema.safeParse(q).success).toBe(false);
  expect(
    journalAssociationInputSchema.safeParse({ ...q, endDate: "2026-02-30" })
      .success,
  ).toBe(false);
});
