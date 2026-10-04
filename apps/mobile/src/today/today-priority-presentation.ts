import type { TodayPriority } from "./today-summary";

export function priorityPresentation(priority: TodayPriority) {
  if (priority.type === "WASTE_SPIKE") {
    return {
      title: `Contrôler la casse — ${priority.productLabel}`,
      reason: "La casse augmente par rapport à J-7.",
      action: "Vérifier le stock, la maturité et la rotation aujourd’hui.",
      metricLabel: "Casse au PA",
    };
  }
  if (priority.type === "SALES_DROP") {
    return {
      title: `Vérifier les ventes — ${priority.productLabel}`,
      reason: "Les ventes reculent par rapport à J-7.",
      action: "Contrôler la disponibilité, le prix et la mise en avant.",
      metricLabel: "Ventes",
    };
  }
  if (priority.type === "MARGIN_DROP") {
    return {
      title: `Examiner la marge — ${priority.productLabel}`,
      reason: "La marge baisse par rapport à J-7.",
      action: "Vérifier le prix de vente et le coût d’achat.",
      metricLabel: "Marge",
    };
  }
  return {
    title: `Vérifier les données — ${priority.productLabel}`,
    reason:
      "Les données disponibles sont insuffisantes pour une lecture fiable.",
    action: "Contrôler les imports et l’association du produit.",
    metricLabel: "Qualité des données",
  };
}

export function priorityFact(priority: TodayPriority) {
  const current = formatCurrency(priority.currentValue);
  const variation = formatSignedPercentage(priority.percentageDifference);
  if (current && variation) return `${current} · ${variation} vs J-7`;
  if (current) return current;
  return `Qualité des données : ${formatQualityScore(priority.dataQualityScore)}`;
}

export function formatCurrency(value: string | null) {
  if (value === null) return null;
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(Number(value));
}

export function formatSignedCurrency(value: string) {
  const amount = Number(value);
  const formatted = formatCurrency(String(Math.abs(amount))) ?? "";
  return `${amount >= 0 ? "+" : "−"}${formatted}`;
}

export function formatSignedPercentage(value: string | null) {
  if (value === null) return null;
  const percentage = Number(value);
  return `${percentage >= 0 ? "+" : "−"}${Math.abs(percentage).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}

export function formatBusinessDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

export function formatQualityScore(value: number) {
  return `${Math.round(value * 100)} %`;
}

export function jMinus7(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 7);
  return date.toISOString().slice(0, 10);
}
