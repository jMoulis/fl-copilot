import type { ImplantationScenarioInput } from "../packages/domain/src/implantation-scenario";
export function implantationFixture(): ImplantationScenarioInput {
  return {
    space: { widthMm: 6000, depthMm: 5000, maxHeightMm: 1800 },
    expectedCounts: { TG: 1, ISLAND: 1 },
    fixtures: [
      {
        id: "tg",
        label: "TG fruits",
        kind: "TG",
        xMm: 0,
        yMm: 0,
        widthMm: 1200,
        depthMm: 800,
        rotation: 0,
        heightMm: 1400,
        maxLoadKg: 100,
        loadKg: 60,
      },
      {
        id: "island",
        label: "Îlot légumes",
        kind: "ISLAND",
        xMm: 2500,
        yMm: 0,
        widthMm: 2000,
        depthMm: 1000,
        rotation: 90,
        heightMm: 1000,
        maxLoadKg: 200,
        loadKg: 150,
      },
    ],
    obstacles: [
      {
        id: "column",
        label: "Poteau",
        xMm: 5000,
        yMm: 0,
        widthMm: 300,
        depthMm: 300,
      },
    ],
    reservedAreas: [
      {
        id: "aisle",
        label: "Allée centrale",
        kind: "PASSAGE",
        xMm: 0,
        yMm: 2500,
        widthMm: 6000,
        depthMm: 1500,
        minimumWidthMm: 1500,
      },
    ],
  };
}
