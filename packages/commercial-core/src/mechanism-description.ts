import type { CommercialMechanism } from "@fl-copilot/domain";
export function commercialMechanismDescription(m: CommercialMechanism) {
  const unit = (u: string) =>
    ({ KG: "kg", PIECE: "pièce", PACK: "unité conditionnée", LOT: "lot" })[u] ??
    u;
  const number = (value: number) =>
    new Intl.NumberFormat("fr-FR").format(value);
  const price =
    m.type === "FIXED_PRICE"
      ? `${number(m.amount)} €/${unit(m.unit)}`
      : m.type === "PRICE_CEILING"
        ? `${m.operator === "LESS_THAN" ? "Moins de" : "Au plus"} ${number(m.amount)} €/${unit(m.unit)}`
        : m.type === "CARD_BENEFIT"
          ? `${number(m.value)} ${m.benefitType === "PERCENT" ? "%" : "€"} avantage carte`
          : m.type === "THRESHOLD_PRICE"
            ? `${number(m.basePrice)} puis ${number(m.thresholdPrice)} €/${unit(m.priceUnit)} dès ${number(m.thresholdQuantity)} ${unit(m.thresholdUnit)}`
            : `Lot de ${m.lotQuantity} ${unit(m.unit)}${m.totalPrice !== null ? ` · ${number(m.totalPrice)} € le lot` : ""}${m.unitPrice !== null ? ` · ${number(m.unitPrice)} € par unité` : ""}`;
  return price;
}
