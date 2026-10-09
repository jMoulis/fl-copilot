import { it, expect } from "vitest";
import { reminderInstant, proposedReminderDate } from "./commercial-reminder";
it("schedules the chosen Paris wall clock across DST rather than subtracting 24 hours", () => {
  expect(reminderInstant("2026-03-29", "09:00")).toBe(
    "2026-03-29T07:00:00.000Z",
  );
  expect(reminderInstant("2026-10-25", "09:00")).toBe(
    "2026-10-25T08:00:00.000Z",
  );
  expect(proposedReminderDate("2027-01-01")).toBe("2026-12-31");
  for (const [d, t] of [
    ["2026-02-30", "09:00"],
    ["2026-10-25", "02:30"],
    ["2026-10-25", "25:00"],
  ])
    expect(() => reminderInstant(d!, t!)).toThrow();
});
