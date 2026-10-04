import { describe, expect, it } from "vitest";
import { getKpiDefinition, KPI_REGISTRY } from "./registry";

describe("KPI registry", () => {
  it("registers unique stable identifiers", () => {
    const ids = KPI_REGISTRY.map((definition) => definition.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps official waste bases and known/estimated costs distinct", () => {
    expect(
      getKpiDefinition("waste_purchase_value_known")?.requiredInputs,
    ).toContain("WasteObservation.purchaseValueKnown");
    expect(
      getKpiDefinition("waste_purchase_value_estimated")?.requiredInputs,
    ).toContain("WasteObservation.purchaseValueEstimated");
    expect(getKpiDefinition("waste_sales_value")?.frenchLabel).toBe(
      "Valeur de vente de la casse",
    );
  });

  it("does not activate an unvalidated aggregate margin rate", () => {
    const definition = getKpiDefinition("source_margin_rate");
    expect(definition?.aggregationMethod).toBe("RATIO_OF_SUMS");
    expect(definition?.status).toBe("DISABLED");
  });
});
