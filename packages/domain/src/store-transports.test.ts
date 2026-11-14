import { it, expect } from "vitest";
import {
  storeTransportsSchema,
  nearbyTransportInputSchema,
  transportAlertType,
  filterTransportAlerts,
  transportAlertSelectionSchema,
  type TransportContext,
} from "./store-transports";
import {
  preserveStoreContextExtensions,
  legacyStoreContext,
} from "./store-context-settings";

import { storeTransportsFixture } from "../../../scripts/test-store-transports-fixtures";
it("keeps one bounded declared shop location, distinct selected lines and explicit disabled tracking", () => {
  const s = storeTransportsFixture();
  expect(storeTransportsSchema.safeParse(s).success).toBe(true);
  expect(
    storeTransportsSchema.safeParse({ ...s, lines: [s.lines[0], s.lines[0]] })
      .success,
  ).toBe(false);
  expect(
    storeTransportsSchema.safeParse({
      ...s,
      lines: [{ ...s.lines[0], id: "https://evil.invalid" }],
    }).success,
  ).toBe(false);
  expect(
    storeTransportsSchema.safeParse({ ...s, radiusMetres: 100 }).success,
  ).toBe(false);
  expect(storeTransportsSchema.safeParse({ ...s, address: null }).success).toBe(
    false,
  );
  expect(
    nearbyTransportInputSchema.safeParse({
      address: "6 rue du test",
      postalCode: "92600",
      point: { latitude: 48, longitude: 2 },
      radiusMetres: 800,
    }).success,
  ).toBe(false);
});
it("preserves old-writer omission, permits explicit removal and projects only negotiated fields", () => {
  const old = {
      id: "11111111-1111-4111-8111-111111111111",
      storeId: "11111111-1111-4111-8111-111111111111",
      city: "Asnières-sur-Seine",
      postalCode: "92600",
      country: "FR" as const,
      timezone: "Europe/Paris" as const,
      schoolZone: "C" as const,
      locationMode: "CITY" as const,
      position: null,
      version: 1,
      createdAt: "2026-11-13T10:00:00.000Z",
      updatedAt: "2026-11-13T10:00:00.000Z",
    },
    current = { ...old, transports: storeTransportsFixture() };
  expect(preserveStoreContextExtensions(old, current).transports).toEqual(
    current.transports,
  );
  expect(
    preserveStoreContextExtensions({ ...old, transports: null }, current)
      .transports,
  ).toBeNull();
  expect(legacyStoreContext(current, true, false)).not.toHaveProperty(
    "transports",
  );
  expect(legacyStoreContext(current, false, true).transports).toEqual(
    current.transports,
  );
});

it("maps provider effects without guessing causes, filters captured history and preserves originals", () => {
  const effects = [
    "NO_SERVICE",
    "REDUCED_SERVICE",
    "SIGNIFICANT_DELAYS",
    "DETOUR",
    "MODIFIED_SERVICE",
    "ADDITIONAL_SERVICE",
    "OTHER_EFFECT",
    "UNKNOWN_EFFECT",
    null,
    "FUTURE_CODE",
  ];
  expect(effects.map(transportAlertType)).toEqual([
    "INTERRUPTION",
    "REDUCED_SERVICE",
    "DELAYS",
    "DETOUR",
    "SERVICE_CHANGE",
    "SERVICE_CHANGE",
    "INFORMATION",
    "INFORMATION",
    "INFORMATION",
    "INFORMATION",
  ]);
  const disruptions = effects.map((effect, i) => ({
    id: String(i),
    effect,
    message: "message",
    applicationPeriods: [],
    schedule: null,
    updatedAt: null,
  }));
  const context: TransportContext = {
    status: "AVAILABLE",
    issue: null,
    radiusMetres: 800,
    lines: [
      {
        id: "IDFM:C01383",
        name: "Metro 13",
        stopName: "Test",
        distanceMetres: 50,
        status: "AVAILABLE",
        retrievedAt: null,
        validUntil: null,
        capturedAt: "2026-11-14T07:00:00.000Z",
        disruptions,
        partial: false,
        history: [
          {
            capturedAt: "2026-11-13T07:00:00.000Z",
            disruptions,
            partial: false,
          },
        ],
      },
    ],
  };
  const before = JSON.stringify(context);
  const filtered = filterTransportAlerts(context, ["DELAYS"]);
  expect(filtered).toMatchObject({
    lines: [
      {
        disruptions: [{ effect: "SIGNIFICANT_DELAYS" }],
        partial: true,
        history: [
          { disruptions: [{ effect: "SIGNIFICANT_DELAYS" }], partial: true },
        ],
      },
    ],
  });
  expect(
    typeof filtered !== "string" && filtered.lines[0]!.disruptions,
  ).toHaveLength(1);
  expect(filterTransportAlerts(context, [])).toMatchObject({
    status: "AVAILABLE",
    lines: [{ disruptions: [], partial: true }],
  });
  expect(filterTransportAlerts(context, null)).toBe(context);
  expect(filterTransportAlerts("NOT_CONFIGURED", ["DELAYS"])).toBe(
    "NOT_CONFIGURED",
  );
  expect(JSON.stringify(context)).toBe(before);
  expect(
    transportAlertSelectionSchema.safeParse(["DELAYS", "DELAYS"]).success,
  ).toBe(false);
  const settings = {
    id: "11111111-1111-4111-8111-111111111111",
    storeId: "11111111-1111-4111-8111-111111111111",
    city: "Test",
    postalCode: "92600",
    country: "FR" as const,
    timezone: "Europe/Paris" as const,
    schoolZone: null,
    locationMode: "CITY" as const,
    position: null,
    version: 1,
    createdAt: "2026-11-14T07:00:00.000Z",
    updatedAt: "2026-11-14T07:00:00.000Z",
  };
  const current = { ...settings, transportAlertTypes: ["DELAYS" as const] };
  expect(
    preserveStoreContextExtensions(settings, current).transportAlertTypes,
  ).toEqual(["DELAYS"]);
  expect(
    preserveStoreContextExtensions(
      { ...settings, transportAlertTypes: [] },
      current,
    ).transportAlertTypes,
  ).toEqual([]);
  expect(legacyStoreContext(current, true, true)).not.toHaveProperty(
    "transportAlertTypes",
  );
  expect(
    legacyStoreContext(current, true, true, true).transportAlertTypes,
  ).toEqual(["DELAYS"]);
});
