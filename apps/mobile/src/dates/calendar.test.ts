import { describe, it, expect } from "vitest";
import {
  calendarDate,
  calendarCells,
  shiftCalendarMonth,
  formatFrenchCalendarDate,
  isoCalendarDate,
} from "./calendar";
describe("French calendar-only dates", () => {
  it("displays day/month/year without converting the selected date through a device timezone", () => {
    expect(formatFrenchCalendarDate("2026-10-07")).toBe("07/10/2026");
    expect(isoCalendarDate(calendarDate("2026-10-07")!)).toBe("2026-10-07");
    expect(calendarDate("2026-10-07")!.getUTCHours()).toBe(12);
  });
  it("rejects invalid dates and handles leap years", () => {
    expect(calendarDate("2026-02-29")).toBeNull();
    expect(calendarDate("2026-04-31")).toBeNull();
    expect(calendarDate("07/10/2026")).toBeNull();
    expect(calendarDate("2024-02-29")).not.toBeNull();
    expect(formatFrenchCalendarDate("")).toBe("Choisir une date");
  });
  it("navigates year boundaries without skipping a month", () => {
    expect(shiftCalendarMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftCalendarMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftCalendarMonth("0099-12", 1)).toBe("0100-01");
  });
  it("lays out Monday-first whole weeks with every day present exactly once", () => {
    const october = calendarCells("2026-10");
    expect(october.slice(0, 4)).toEqual([null, null, null, "2026-10-01"]);
    expect(october.filter(Boolean)).toHaveLength(31);
    expect(october.length % 7).toBe(0);
    expect(calendarCells("2024-02").filter(Boolean)).toHaveLength(29);
    expect(calendarCells("2026-02").slice(0, 7)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      "2026-02-01",
    ]);
    expect(calendarCells("9999-12").filter(Boolean)).toHaveLength(31);
  });
});
