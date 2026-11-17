import { expect, it } from "vitest";
import { nationalNewsForPeriod, journalContextSchema } from "./journal-context";
import { journalContextFixture } from "../../../scripts/test-journal-context-fixtures";
function fixture() {
  const context = journalContextFixture();
  const source = { ...context.sources[0]! };
  source.kind = "NATIONAL_SOCIAL";
  source.firstCapturedAt = "2026-11-17T07:15:00.000Z";
  source.history = [];
  source.payload = {
    consumption: null,
    items: [
      {
        title: "Appel national",
        summary: "Annonce",
        sourceUrl: "https://www.cgt.fr/appel",
        publishedAt: "2026-11-16T10:00:00.000Z",
        periodLabel: "Date à vérifier",
        startDate: null,
        endDate: null,
      },
    ],
  };
  context.national = [source];
  return context;
}
it("keeps old journal contracts readable and caps the cross-source selection at three", () => {
  expect(journalContextSchema.safeParse(journalContextFixture()).success).toBe(
    true,
  );
  const c = fixture();
  const item = c.national![0]!.payload!.items[0]!;
  c.national![0]!.payload!.items = Array.from({ length: 8 }, (_, i) => ({
    ...item,
    sourceUrl: `https://www.cgt.fr/${i}`,
  }));
  expect(
    nationalNewsForPeriod(c, "2026-11-17", "2026-11-24", "2026-11-17"),
  ).toHaveLength(3);
});
it("does not confuse recent publication with dated event, backfill past knowledge, or keep undated news forever", () => {
  const c = fixture();
  expect(
    nationalNewsForPeriod(c, "2026-11-17", "2026-11-24", "2026-11-17")[0]!
      .dated,
  ).toBe(false);
  expect(
    nationalNewsForPeriod(c, "2026-11-16", "2026-11-16", "2026-11-17"),
  ).toEqual([]);
  expect(
    nationalNewsForPeriod(c, "2026-12-01", "2026-12-08", "2026-12-01"),
  ).toEqual([]);
});
