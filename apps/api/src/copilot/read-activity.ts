import type { CopilotActivity } from "@fl-copilot/sync-contracts";
/** Map server-owned tool keys to a bounded public vocabulary; never echo arguments. */
export function readActivityStage(key: string): CopilotActivity["stage"] {
  const parsed: unknown = JSON.parse(key);
  const args = Array.isArray(parsed) ? parsed : [];
  const kind = args[0];
  if (kind === "period")
    return args[1] && typeof args[1] === "object" && args[1].referencePeriod
      ? "COMPARISON"
      : "ANALYTICS";
  if (kind === "price-scenario") return "ANALYTICS";
  if (kind === "implantation-scenario") return "ANALYTICS";
  if (kind === "analytics-query") return "ANALYTICS";
  if (kind === "recommendation-decisions") return "CONTEXT";
  if (kind === "action-execution-preview") return "PROPOSAL";
  if (kind === "action-executions") return "CONTEXT";
  if (kind === "execution-links") return "CONTEXT";
  if (kind === "execution-link-preview") return "PROPOSAL";
  if (kind === "recommendation-context") return "CONTEXT";
  if (kind === "recommendation-tracking") return "PROPOSAL";
  if (kind === "action-review" || kind === "declared-action-review")
    return "COMPARISON";
  if (kind === "daily") return "COMPARISON";
  if (
    kind === "products" ||
    kind === "product-search" ||
    kind === "substitutes" ||
    kind === "need-catalogue" ||
    kind === "need-memberships"
  )
    return "PRODUCTS";
  if (
    kind === "product-batch-preview" ||
    kind === "product-classification-preview"
  )
    return "PROPOSAL";
  if (kind === "store-conflict") return "PROPOSAL";
  if (kind === "receipt-recovery") return "PROPOSAL";
  if (kind === "receipt-correction") return "PROPOSAL";
  if (kind === "receipt-publication") return "PROPOSAL";
  if (kind === "identity-review") return "PROPOSAL";
  if (kind === "reference-preview") return "PROPOSAL";
  if (kind === "plan-validation") return "PROPOSAL";
  if (kind === "preparation-preview") return "PROPOSAL";
  if (kind === "store-layout-scenario") return "PROPOSAL";
  if (kind === "store-layout-edit") return "PROPOSAL";
  if (kind === "operations-preview") return "PROPOSAL";
  if (kind === "need-preview") return "PROPOSAL";
  if (kind === "catalogue-preview" || kind === "execution-preview")
    return "PROPOSAL";
  if (kind === "information-request") return "INFORMATION";
  if (
    [
      "commercial-plan",
      "document-comparison",
      "reference-inspection",
      "commercial-preparation",
      "plan-readiness",
      "documents",
      "pdf",
      "offers",
      "waste-documents",
      "waste-receipt",
    ].includes(kind)
  )
    return "DOCUMENTS";
  return "CONTEXT";
}
