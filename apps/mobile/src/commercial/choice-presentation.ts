import type { CommercialMechanism } from "@fl-copilot/domain";
import type { CommercialOfferChoice } from "@fl-copilot/sync-contracts";
import { formatFrenchCalendarDate } from "@/dates/calendar";
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
            : `Lot de ${m.lotQuantity} ${unit(m.unit)}${m.totalPrice !== null ? ` · ${number(m.totalPrice)} € le lot` : m.unitPrice !== null ? ` · ${number(m.unitPrice)} € par unité` : ""}`;
  return price;
}
export function commercialChoiceSummary(choice: CommercialOfferChoice) {
  const price = commercialMechanismDescription(choice.mechanism);
  return `${choice.status === "RETAINED" ? "Retenue" : "Retirée"} · ${choice.rawProductLabel}\n${formatFrenchCalendarDate(choice.saleStart)} – ${formatFrenchCalendarDate(choice.saleEnd)}\n${price}`;
}
export function commercialChoiceError(code: string | undefined | null) {
  const messages: Record<string, string> = {
    COMMERCIAL_CHOICE_DUPLICATE:
      "Cette offre est déjà retenue pour ce produit et cette période dans le document. Consultez le choix existant.",
    COMMERCIAL_CHOICE_UNIT_MISMATCH:
      "L’unité du prix ne correspond pas au produit associé. Vérifiez le produit et l’unité de l’offre.",
    COMMERCIAL_CHOICE_PRODUCT_INVALID:
      "Choisissez un produit actif du magasin.",
    COMMERCIAL_CHOICE_SOURCE_INVALID:
      "L’extrait source ne correspond plus à ce choix. Ouvrez le PDF original.",
    COMMERCIAL_CHOICE_RESOLVE_REQUIRED:
      "Comparez les choix dans Synchronisation avant de modifier cette offre.",
    COMMERCIAL_CHOICE_SYNCING:
      "Une synchronisation de ce choix est en cours. Réessayez lorsqu’elle est terminée.",
    COMMERCIAL_CHOICE_REVISION_INVALID:
      "Le choix a changé depuis l’ouverture. Revenez au document et rouvrez l’offre.",
  };
  return (
    messages[code ?? ""] ??
    "Le choix n’a pas pu être enregistré. Vérifiez les informations signalées ou rouvrez l’offre."
  );
}
