import { it, expect } from "vitest";
import {
  storeTransportsSchema,
  nearbyTransportInputSchema,
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
