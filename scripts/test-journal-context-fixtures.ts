import type { JournalContext } from "../packages/domain/src/index";
export function journalContextFixture(): JournalContext {
  return {
    transport: "NOT_CONFIGURED",
    sources: (["WORKS", "AGENDA", "CONSUMPTION"] as const).map((kind) => ({
      kind,
      status: "AVAILABLE",
      provider:
        kind === "CONSUMPTION" ? "FranceAgriMer" : "Ville d’Asnières-sur-Seine",
      sourceUrl:
        kind === "CONSUMPTION"
          ? "https://www.franceagrimer.fr/"
          : "https://asnieres-sur-seine.fr/agenda",
      retrievedAt: "2026-11-13T09:00:00.000Z",
      validUntil: "2026-11-14T09:00:00.000Z",
      firstCapturedAt: "2026-11-13T09:00:00.000Z",
      revision: "a".repeat(64),
      issue: null,
      payload:
        kind === "CONSUMPTION"
          ? {
              items: [],
              consumption: {
                period: "2026-09",
                reportUrl: null,
                editionLabel: null,
                groups: [
                  {
                    group: "FRUITS",
                    quantityKgPerHousehold: 6.59,
                    quantityAnnualPercent: 2.9,
                    averagePriceEurPerKg: 3.18,
                    priceAnnualPercent: 3.4,
                  },
                  {
                    group: "VEGETABLES",
                    quantityKgPerHousehold: 6.08,
                    quantityAnnualPercent: -3.4,
                    averagePriceEurPerKg: 3.2,
                    priceAnnualPercent: 13.5,
                  },
                ],
              },
            }
          : {
              items: [
                {
                  title: "Salon local",
                  summary: "Annonce de la ville",
                  sourceUrl: "https://asnieres-sur-seine.fr/agenda",
                  periodLabel: "13 au 15 novembre 2026",
                  startDate: "2026-11-13",
                  endDate: "2026-11-15",
                },
              ],
              consumption: null,
            },
      history: [],
    })),
  };
}
