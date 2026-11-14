import { expect, it } from "vitest";
import { personalTaskInstant, personalTaskFieldsSchema } from "./personal-task";
it("accepts early and late Paris times, rejects the spring gap and picks the first autumn occurrence", () => {
  expect(personalTaskInstant("2026-11-14", "04:30")).toBe(
    "2026-11-14T03:30:00.000Z",
  );
  expect(personalTaskInstant("2026-07-14", "23:30")).toBe(
    "2026-07-14T21:30:00.000Z",
  );
  expect(() => personalTaskInstant("2026-03-29", "02:30")).toThrow(
    "n’existe pas",
  );
  expect(personalTaskInstant("2026-10-25", "02:30")).toBe(
    "2026-10-25T00:30:00.000Z",
  );
  expect(() => personalTaskInstant("2026-02-30", "12:00")).toThrow();
  expect(
    personalTaskFieldsSchema.safeParse({
      text: "  ",
      date: "2026-11-14",
      time: null,
      status: "TODO",
    }).success,
  ).toBe(false);
});
