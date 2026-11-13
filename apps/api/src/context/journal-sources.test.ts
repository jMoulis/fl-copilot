import { readFileSync } from "node:fs";
import { it, expect } from "vitest";
import {
  parseConsumption,
  parseWorks,
  parseAgenda,
  explicitFrenchDates,
  boundedHtml,
} from "./journal-sources";
const fixture = (name: string) =>
  readFileSync(
    new URL(
      `../../../../scripts/fixtures/journal/${name}.html`,
      import.meta.url,
    ),
    "utf8",
  );
it("reads the actual FranceAgriMer consumption month independently from its November capture", () => {
  const r = parseConsumption(fixture("franceagrimer-consumption-2026-11-13"));
  expect(r.consumption?.period).toBe("2026-09");
  expect(r.consumption?.reportUrl).toContain("2026-11/NCO-NOT-FL-2026-10.pdf");
  expect(r.consumption?.editionLabel).toContain("Octobre 2026");
  expect(r.consumption?.groups).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        group: "VEGETABLES",
        quantityKgPerHousehold: 6.08,
        quantityAnnualPercent: -3.4,
        averagePriceEurPerKg: 3.2,
        priceAnnualPercent: 13.5,
      }),
      expect.objectContaining({
        group: "FRUITS",
        quantityKgPerHousehold: 6.59,
        quantityAnnualPercent: 2.9,
        averagePriceEurPerKg: 3.18,
        priceAnnualPercent: 3.4,
      }),
    ]),
  );
  for (const s of [
    "<p>Aucun résultat</p>",
    fixture("franceagrimer-consumption-2026-11-13").replace("6,08", "inconnue"),
    fixture("franceagrimer-consumption-2026-11-13").replace(
      "septembre",
      "inconnu",
    ),
  ])
    expect(() => parseConsumption(s)).toThrow();
});
it("retains official works excerpts without inferring all-day closures or retrospective shop impact", () => {
  const r = parseWorks(fixture("asnieres-works-2026-11-12"));
  expect(r.items).toHaveLength(2);
  expect(r.items[0]?.summary).toContain("21h à 5h30");
  expect(r.items[0]?.startDate).toBeNull();
  expect(() => parseWorks("<p>Travaux</p>")).toThrow();
});
it("qualifies real municipal agenda dates, rejects foreign source links and does not infer missing years", () => {
  const html = fixture("asnieres-agenda-2026-11-13");
  const r = parseAgenda(html);
  expect(r.items).toHaveLength(2);
  expect(r.items.at(-1)).toMatchObject({
    startDate: "2026-11-13",
    endDate: "2026-11-15",
  });
  expect(() =>
    parseAgenda(html.replace('href="/agenda/', 'href="https://evil.invalid/')),
  ).toThrow();
  expect(explicitFrenchDates("23 au 26 novembre")).toEqual({
    startDate: null,
    endDate: null,
  });
  expect(explicitFrenchDates("31 février 2026").startDate).toBeNull();
});
it("bounds source streams and rejects non-HTML instead of interpreting login/API error content", async () => {
  await expect(
    boundedHtml(
      new Response("{}", { headers: { "content-type": "application/json" } }),
    ),
  ).rejects.toThrow();
  await expect(
    boundedHtml(
      new Response("x".repeat(1_500_001), {
        headers: { "content-type": "text/html" },
      }),
    ),
  ).rejects.toThrow();
  expect(
    await boundedHtml(
      new Response("<p>Été</p>", { headers: { "content-type": "text/html" } }),
    ),
  ).toBe("<p>Été</p>");
});
