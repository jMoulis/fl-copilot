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
  if (kind === "analytics-query") return "ANALYTICS";
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
  if (kind === "plan-validation") return "PROPOSAL";
  if (kind === "preparation-preview") return "PROPOSAL";
  if (kind === "operations-preview") return "PROPOSAL";
  if (kind === "need-preview") return "PROPOSAL";
  if (kind === "catalogue-preview" || kind === "execution-preview")
    return "PROPOSAL";
  if (kind === "information-request") return "INFORMATION";
  if (
    [
      "commercial-plan",
      "document-comparison",
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
