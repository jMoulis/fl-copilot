import { readFileSync } from "node:fs";
import { afterEach, it, expect, vi } from "vitest";
import type { Db } from "mongodb";
import { ContextProviderCache } from "./provider-cache";
import {
  discoverNearbyTransports,
  transportReferenceUrl,
  geocodeUrl,
} from "./transports";
const storeId = "22222222-2222-4222-8222-222222222222";
const rows = JSON.parse(
  readFileSync(
    new URL(
      "../../../../scripts/fixtures/idfm-nearby-2026-11-13.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const geocode = JSON.parse(
  readFileSync(
    new URL(
      "../../../../scripts/fixtures/ign-geocode-2026-11-13.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const input = {
  address: null,
  point: { latitude: 48.9181, longitude: 2.2935 },
  postalCode: "92600",
  radiusMetres: 800,
};
afterEach(() => vi.restoreAllMocks());
function mock() {
  return vi
    .spyOn(ContextProviderCache.prototype, "read")
    .mockImplementation(async (url, schema) => ({
      data: schema.parse(url.startsWith(geocodeUrl) ? geocode : rows),
      retrievedAt: "2026-11-13T10:00:00.000Z",
      validUntil: "2026-11-14T10:00:00.000Z",
      failed: false,
    }));
}
it("groups actual IDFM stops by line, picks the nearest stop, bounds distance and does not need a PRIM key", async () => {
  const read = mock();
  const r = await discoverNearbyTransports({} as Db, storeId, input);
  expect(r.location?.source).toBe("STORE_GPS");
  expect(new Set(r.lines.map((l) => l.id)).size).toBe(r.lines.length);
  expect(r.lines.every((l) => l.distanceMetres <= 800)).toBe(true);
  expect(r.lines.length).toBeGreaterThan(0);
  expect(read.mock.calls[0]?.[0]).toContain(transportReferenceUrl);
  expect(read.mock.calls[0]?.[0]).not.toMatch(/apikey|token|authorization/i);
});
it("resolves the actual IGN shop address without substituting a city centre and preserves ambiguous choices", async () => {
  const read = mock();
  const r = await discoverNearbyTransports({} as Db, storeId, {
    ...input,
    address: "6 rue de l’Eglise",
    point: null,
  });
  expect(r.location).toMatchObject({
    source: "ADDRESS",
    latitude: 48.910648,
    longitude: 2.293091,
  });
  const two = structuredClone(geocode);
  two.features.push({
    ...two.features[0],
    properties: {
      ...two.features[0].properties,
      id: "other",
      label: "Autre adresse",
    },
  });
  read.mockImplementation(async (_url, schema) => ({
    data: schema.parse(two),
    retrievedAt: null,
    validUntil: null,
    failed: false,
  }));
  const choice = await discoverNearbyTransports({} as Db, storeId, {
    ...input,
    address: "rue de l’Eglise",
    point: null,
  });
  expect(choice.location).toBeNull();
  expect(choice.candidates).toHaveLength(2);
  expect(choice.lines).toEqual([]);
});
it("does not erase the saved selection on invalid input, failed/empty references or an unknown address", async () => {
  const read = mock();
  for (const patch of [
    { radiusMetres: 0 },
    { radiusMetres: 3000 },
    { address: "unknown" },
  ])
    await expect(
      discoverNearbyTransports({} as Db, storeId, { ...input, ...patch }),
    ).rejects.toThrow();
  read.mockResolvedValue({
    data: null,
    retrievedAt: null,
    validUntil: null,
    failed: true,
  });
  await expect(
    discoverNearbyTransports({} as Db, storeId, input),
  ).rejects.toMatchObject({ publicCode: "TRANSPORT_REFERENCE_UNAVAILABLE" });
});
