import type {
  ProductSubstitution,
  ProductIdentifier,
} from "@fl-copilot/domain";
export const substitutionState = (e: ProductSubstitution) =>
  ({
    PROPOSED: "Proposée",
    VALIDATED: "Validée",
    LEARNING: "En apprentissage",
    REJECTED: "Rejetée",
  })[e.status];
export const substitutionPercent = (n: number | null) =>
  n === null
    ? "Indisponible"
    : n > 0 && n < 0.01
      ? "Moins de 1 %"
      : `${Math.round(n * 100)} %`;
export const substitutionSyncState = (s: string) =>
  ({
    SYNCED: "Synchronisée",
    PENDING: "À synchroniser",
    CONFLICT: "Conflit à comparer",
    ERROR: "Envoi à reprendre",
  })[s] ?? "À synchroniser";
export type SubstitutionFormValues = {
  need: string;
  usage: string;
  price: string;
  packaging: string;
};
export function validateSubstitutionForm(v: SubstitutionFormValues) {
  const errors: Partial<Record<keyof SubstitutionFormValues, string>> = {},
    values = {
      need: 0,
      usage: 0,
      price: null as number | null,
      packaging: null as number | null,
    };
  for (const key of ["need", "usage", "price", "packaging"] as const) {
    const text = v[key].trim();
    if (!text && (key === "price" || key === "packaging")) continue;
    if (
      !/^\d+(?:[.,]\d+)?$/.test(text) ||
      Number(text.replace(",", ".")) > 100
    ) {
      errors[key] = "Saisissez un pourcentage de 0 à 100.";
      continue;
    }
    values[key] = Number(text.replace(",", ".")) / 100;
  }
  return { values, errors };
}
// Shift the canonical decimal text instead of multiplying into a floating-point display artifact.
function inputPercent(n: number) {
  const [coefficient, exponent = "0"] = String(n).split("e"),
    [whole, fraction = ""] = coefficient!.split("."),
    digits = whole! + fraction,
    index = whole!.length + Number(exponent) + 2;
  const raw =
    index <= 0
      ? "0." + "0".repeat(-index) + digits
      : index >= digits.length
        ? digits + "0".repeat(index - digits.length)
        : digits.slice(0, index) + "." + digits.slice(index);
  const [a, b = ""] = raw.split(".");
  const decimals = b.replace(/0+$/, "");
  return (
    (a!.replace(/^0+(?=\d)/, "") || "0") + (decimals ? "." + decimals : "")
  );
}
export function substitutionFormValues(
  e: ProductSubstitution,
): SubstitutionFormValues {
  return {
    need: inputPercent(e.needCompatibility),
    usage: inputPercent(e.usageCompatibility),
    price:
      e.priceCompatibility === null ? "" : inputPercent(e.priceCompatibility),
    packaging:
      e.packagingCompatibility === null
        ? ""
        : inputPercent(e.packagingCompatibility),
  };
}
export function selectSubstitutions<T extends { entity: ProductSubstitution }>(
  rows: T[],
  storeId: string,
  productId: string,
  incoming: boolean,
  includeRejected: boolean,
) {
  return rows.filter(
    (r) =>
      r.entity.storeId === storeId &&
      (incoming
        ? r.entity.substituteProductId === productId
        : r.entity.sourceProductId === productId) &&
      (includeRejected || r.entity.status !== "REJECTED"),
  );
}

export function substitutionIdentifierLabels(
  ids: Pick<ProductIdentifier, "productId" | "type" | "value" | "status">[],
) {
  const labels: Record<string, string> = {};
  for (const i of ids) {
    const text = `${i.type} : ${i.value}${i.status === "VALIDATED" ? "" : " (à vérifier)"}`;
    labels[i.productId] = [labels[i.productId], text]
      .filter(Boolean)
      .join(" · ");
  }
  return labels;
}
