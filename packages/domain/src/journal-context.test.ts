import { it, expect } from "vitest";
import {
  journalContextSchema,
  journalItemsForDate,
  journalSourceForDate,
} from "./journal-context";
import { journalContextFixture } from "../../../scripts/test-journal-context-fixtures";
it("does not invent dates, zero events or future historical knowledge across Paris midnight", () => {
  const c = journalContextFixture(),
    source = c.sources[0]!;
  source.history = [
    {
      revision: source.revision!,
      firstCapturedAt: "2026-11-12T23:30:00.000Z",
      payload: source.payload!,
    },
  ];
  expect(
    journalSourceForDate(source, "2026-11-12", "2026-11-14"),
  ).toMatchObject({ payload: null, issue: "HISTORY_UNAVAILABLE" });
  expect(
    journalSourceForDate(source, "2026-11-13", "2026-11-14").payload,
  ).toEqual(source.payload);
  expect(journalItemsForDate(source, "2026-11-12")).toHaveLength(0);
  source.payload!.items[0]!.startDate = null;
  source.payload!.items[0]!.endDate = null;
  expect(journalItemsForDate(source, "2026-11-12")).toHaveLength(1);
});
it("keeps strict legacy-compatible optional contexts and refuses duplicate providers", () => {
  const c = journalContextFixture();
  expect(journalContextSchema.safeParse(c).success).toBe(true);
  c.sources[1] = c.sources[0]!;
  expect(journalContextSchema.safeParse(c).success).toBe(false);
});
