import type { StoreTransports } from "../packages/domain/src/index";
export function storeTransportsFixture(): StoreTransports {
  return {
    city: "Asnières-sur-Seine",
    postalCode: "92600",
    address: "6 rue de l’Eglise",
    location: {
      latitude: 48.910648,
      longitude: 2.293091,
      label: "6 Rue de l’Eglise 92600 Asnières-sur-Seine",
      source: "ADDRESS",
    },
    radiusMetres: 800,
    detectedAt: "2026-11-13T10:00:00.000Z",
    partial: false,
    lines: [
      {
        id: "IDFM:C01383",
        name: "13",
        mode: "Metro",
        stopId: "IDFM:463207",
        stopName: "Les Agnettes",
        distanceMetres: 450,
        enabled: true,
      },
    ],
  };
}
