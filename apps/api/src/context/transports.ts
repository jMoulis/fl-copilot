import { z } from "zod";
import type { Db } from "mongodb";
import {
  nearbyTransportInputSchema,
  nearbyTransportResultSchema,
  type NearbyTransportResult,
} from "@fl-copilot/domain";
import { ContextProviderCache } from "./provider-cache.js";
import { AuthError } from "../auth/service.js";
export const transportReferenceUrl =
  "https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/arrets-lignes/records";
export const transportSourceUrl =
  "https://me-deplacer.iledefrance-mobilites.fr/infos-trafic";
export const geocodeUrl = "https://data.geopf.fr/geocodage/search";
export async function boundedJson(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw Error("TRANSPORT_EMPTY_BODY");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_500_000) throw Error("TRANSPORT_TOO_LARGE");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks))) as unknown;
}
const representation = {
  accept: "application/json",
  respectExpires: false,
  decode: boundedJson,
};
const geocodes = z.object({
  features: z
    .array(
      z.object({
        geometry: z.object({
          coordinates: z.tuple([
            z.number().min(-180).max(180),
            z.number().min(-90).max(90),
          ]),
        }),
        properties: z.object({
          id: z.string().max(150),
          label: z.string().max(240),
          postcode: z.string(),
          score: z.number().finite(),
          type: z.string(),
        }),
      }),
    )
    .max(5),
});
const records = z.object({
  total_count: z.number().int().nonnegative(),
  results: z
    .array(
      z.object({
        id: z.string().regex(/^IDFM:C\d{5}$/),
        shortname: z.string().min(1).max(100),
        mode: z.string().max(50),
        stop_id: z.string().min(1).max(100),
        stop_name: z.string().min(1).max(140),
        pointgeo: z.object({
          lat: z.number().min(-90).max(90),
          lon: z.number().min(-180).max(180),
        }),
      }),
    )
    .max(100),
});
export function distanceMetres(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const rad = (v: number) => (v * Math.PI) / 180;
  const dlat = rad(b.latitude - a.latitude),
    dlon = rad(b.longitude - a.longitude);
  return (
    6371000 *
    2 *
    Math.asin(
      Math.min(
        1,
        Math.sqrt(
          Math.sin(dlat / 2) ** 2 +
            Math.cos(rad(a.latitude)) *
              Math.cos(rad(b.latitude)) *
              Math.sin(dlon / 2) ** 2,
        ),
      ),
    )
  );
}
export async function discoverNearbyTransports(
  db: Db,
  storeId: string,
  raw: unknown,
  fetcher: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): Promise<NearbyTransportResult> {
  const input = nearbyTransportInputSchema.parse(raw),
    cache = new ContextProviderCache(db, fetcher, now);
  let location: NearbyTransportResult["location"] = input.point
    ? {
        ...input.point,
        label: "Position enregistrée du magasin",
        source: "STORE_GPS",
      }
    : null;
  let candidates: NearbyTransportResult["candidates"] = [];
  if (input.address) {
    const url = `${geocodeUrl}?${new URLSearchParams({ q: input.address, postcode: input.postalCode, limit: "5", autocomplete: "0" })}`;
    const r = await cache.read(url, geocodes, 86400000, representation);
    if (!r.data || r.failed)
      throw new AuthError(
        503,
        "TRANSPORT_GEOCODE_UNAVAILABLE",
        "La recherche d’adresse est indisponible. Ta saisie est conservée.",
      );
    candidates = r.data.features
      .filter(
        (f) =>
          f.properties.postcode === input.postalCode &&
          f.properties.score >= 0.6 &&
          ["housenumber", "street"].includes(f.properties.type),
      )
      .map((f) => ({
        id: f.properties.id,
        label: f.properties.label,
        longitude: f.geometry.coordinates[0],
        latitude: f.geometry.coordinates[1],
      }));
    const chosen = input.candidateId
      ? candidates.find((c) => c.id === input.candidateId)
      : candidates.length === 1
        ? candidates[0]
        : undefined;
    if (chosen)
      location = {
        latitude: chosen.latitude,
        longitude: chosen.longitude,
        label: chosen.label,
        source: "ADDRESS",
      };
  }
  if (!location)
    return nearbyTransportResultSchema.parse({
      storeId,
      retrievedAt: now().toISOString(),
      location: null,
      candidates,
      lines: [],
      partial: false,
    });
  const lines = new Map<string, NearbyTransportResult["lines"][number]>();
  let partial = false;
  for (let offset = 0; offset < 500; offset += 100) {
    const url = `${transportReferenceUrl}?${new URLSearchParams({ where: `within_distance(pointgeo, GEOM'POINT(${location.longitude.toFixed(6)} ${location.latitude.toFixed(6)})', ${input.radiusMetres}m)`, limit: "100", offset: String(offset) })}`;
    const r = await cache.read(url, records, 86400000, representation);
    if (!r.data || r.failed)
      throw new AuthError(
        503,
        "TRANSPORT_REFERENCE_UNAVAILABLE",
        "Les arrêts proches ne peuvent pas être recherchés maintenant. La sélection enregistrée est conservée.",
      );
    for (const row of r.data.results) {
      const distance = distanceMetres(location, {
        latitude: row.pointgeo.lat,
        longitude: row.pointgeo.lon,
      });
      if (distance > input.radiusMetres) continue;
      const candidate = {
        id: row.id,
        name: row.shortname,
        mode: row.mode,
        stopId: row.stop_id,
        stopName: row.stop_name,
        distanceMetres: Math.round(distance),
        enabled: true,
      };
      const prior = lines.get(row.id);
      if (!prior || candidate.distanceMetres < prior.distanceMetres)
        lines.set(row.id, candidate);
    }
    if (offset + r.data.results.length >= r.data.total_count) break;
    if (!r.data.results.length) throw Error("TRANSPORT_REFERENCE_TRUNCATED");
    if (offset === 400) partial = true;
  }
  const all = [...lines.values()].sort(
    (a, b) => a.distanceMetres - b.distanceMetres || a.id.localeCompare(b.id),
  );
  return nearbyTransportResultSchema.parse({
    storeId,
    retrievedAt: now().toISOString(),
    location,
    candidates,
    partial: partial || all.length > 32,
    lines: all.slice(0, 32).map((l, i) => ({ ...l, enabled: i < 16 })),
  });
}
