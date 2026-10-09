import { randomUUID } from "node:crypto";
import type { StoreContextSettings } from "../packages/domain/src/index";
export function storeContextFixture(): StoreContextSettings {
  const storeId = randomUUID(),
    now = "2026-10-09T08:00:00.000Z";
  return {
    id: storeId,
    storeId,
    city: "Asnières-sur-Seine",
    postalCode: "92600",
    country: "FR",
    timezone: "Europe/Paris",
    schoolZone: "C",
    locationMode: "CITY",
    position: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}
