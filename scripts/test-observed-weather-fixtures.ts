/** Controlled test data only; never imported into a store. */
import { observedWeatherContextSchema } from "../packages/domain/src/index";
export function observedWeatherContextFixture() {
  const measurement = (value: string) => ({
    sourceValue: value,
    analysisValue: value,
    quality: "VALIDATED",
    qualityCode: "1",
  });
  const station = {
    id: "92073001",
    name: "SURESNES",
    latitude: 48.870667,
    longitude: 2.2345,
    altitudeM: "28",
  };
  return observedWeatherContextSchema.parse({
    status: "AVAILABLE",
    provider: "Météo-France",
    sourceUrl:
      "https://www.data.gouv.fr/datasets/donnees-climatologiques-de-base-quotidiennes",
    retrievedAt: "2026-10-09T08:00:00.000Z",
    validUntil: "2026-10-10T08:00:00.000Z",
    issue: null,
    selection: "AUTO_DEPARTMENT_NEAREST",
    publicationDatesKnown: false,
    reference: { station, distanceKm: 7.56 },
    days: [
      {
        producerDate: "2026-10-08",
        station,
        measurements: {
          TN: measurement("9.0"),
          TX: measurement("18.0"),
          RR: measurement("0.0"),
        },
        sourceRow: 2,
        temperatureUnit: "C",
        rainfallUnit: "mm",
        temperatureWindow: "PRODUCER_DAILY_EXTREMA",
        rainfallWindow: {
          from: "2026-10-08T06:00:00.000Z",
          to: "2026-10-09T06:00:00.000Z",
          dateAttribution: "PRODUCER_DATE",
        },
        sourceUrl:
          "https://meteofrance.s3.sbg.io.cloud.ovh.net/data/synchro_ftp/BASE/QUOT/Q_92_latest-2025-2026_RR-T-Vent.csv.gz",
        sourceSha256: "a".repeat(64),
        sourceRetrievedAt: "2026-10-09T08:00:00.000Z",
      },
    ],
  });
}
