import {
  commercialMechanismSchema,
  commercialPurchaseConditionSchema,
  type CommercialMechanism,
} from "@fl-copilot/domain";

const number = "(\\d+(?:[,.]\\d{1,2})?)";
const units = "(kg|pièce|piece|unité conditionnée|unite conditionnee|pack|lot)";
const money = `${number}\\s*€\\s*/\\s*${units}`;
function decimal(raw: string) {
  return Number(raw.replace(",", "."));
}
function unit(raw: string): "KG" | "PIECE" | "PACK" | "LOT" {
  if (raw === "kg") return "KG";
  if (raw === "pièce" || raw === "piece") return "PIECE";
  if (raw === "lot") return "LOT";
  return "PACK";
}
function text(raw: string | null | undefined) {
  return (raw ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("fr-FR")
    .replace(/\s+/g, " ")
    .trim();
}

/** Literal supported forms only. Caller must provide source-anchored fields.
 * No label-based guessing, effective-price calculation or human validation. */
export function normalizeCommercialMechanisms(input: {
  sellingPrice?: string | null;
  priceOperator?: string | null;
  customerMechanism?: string | null;
  purchasePrice?: string | null;
  supplierCondition?: string | null;
}) {
  const issues: string[] = [];
  const literalPrice = (raw: string | null | undefined) =>
    text(raw)
      .replace(/^moins de\s+/, "< ")
      .replace(/€\s+(?:le|la)\s+(kg|pièce|piece)$/, "€/$1");
  const selling = literalPrice(input.sellingPrice);
  let customer = text(input.customerMechanism);
  const explicitThreshold = customer.match(
    new RegExp(
      `^pvc à partir de ${number} ${units} : ${money.replace("\\s*/\\s*", "\\s+(?:le|la)\\s+")}$`,
    ),
  );
  if (explicitThreshold && selling) {
    customer = `${selling} ; ${explicitThreshold[3]} €/${explicitThreshold[4]} à partir de ${explicitThreshold[1]} ${explicitThreshold[2]}`;
  }
  let mechanism: CommercialMechanism | null = null;
  // A compound mechanism must be reviewed rather than silently reduced to price.
  if (customer) {
    const threshold = customer.match(
      new RegExp(
        `^${money} ; ${money} (?:à partir de|a partir de|dès|des) ${number} ${units}$`,
      ),
    );
    const card = customer.match(
      new RegExp(
        `^${number}\\s*(%|€) (?:sur (?:la )?carte|avantage carte|carte)$`,
      ),
    );
    const lot = customer.match(
      new RegExp(
        `^lot de (\\d+) (pièces|pieces|packs|unités conditionnées)(?: (?:pour|à) ${number}\\s*€)?$`,
      ),
    );
    const base = selling.match(new RegExp(`^${money}$`));
    if (
      threshold &&
      decimal(threshold[5]!) > 0 &&
      threshold[2] === threshold[4] &&
      (!selling ||
        (base &&
          decimal(base[1]!) === decimal(threshold[1]!) &&
          unit(base[2]!) === unit(threshold[2]!)))
    ) {
      mechanism = {
        type: "THRESHOLD_PRICE",
        basePrice: decimal(threshold[1]!),
        thresholdPrice: decimal(threshold[3]!),
        thresholdQuantity: decimal(threshold[5]!),
        thresholdUnit: unit(threshold[6]!),
        priceUnit: unit(threshold[2]!),
      };
    } else if (card && (card[2] !== "%" || decimal(card[1]!) <= 100)) {
      mechanism = {
        type: "CARD_BENEFIT",
        benefitType: card[2] === "%" ? "PERCENT" : "AMOUNT",
        value: decimal(card[1]!),
        scope: null,
      };
    } else if (lot && Number(lot[1]) > 0 && !selling) {
      mechanism = {
        type: "LOT",
        lotQuantity: Number(lot[1]),
        totalPrice: lot[3] ? decimal(lot[3]) : null,
        unitPrice: null,
        unit: lot[2] === "pièces" || lot[2] === "pieces" ? "PIECE" : "PACK",
      };
    } else issues.push("CUSTOMER_MECHANISM_TO_CONFIRM");
  } else if (selling) {
    const match = selling.match(new RegExp(`^(<|<=|≤|=)?\\s*${money}$`));
    const operator = text(input.priceOperator).replace(/^moins de$/, "<");
    if (
      match &&
      (!operator || ["<", "<=", "≤", "="].includes(operator)) &&
      (!match[1] ||
        !operator ||
        match[1].replace("≤", "<=") === operator.replace("≤", "<="))
    ) {
      const op = operator || match[1];
      const values = {
        amount: decimal(match[2]!),
        currency: "EUR" as const,
        unit: unit(match[3]!),
      };
      mechanism =
        op && op !== "="
          ? {
              type: "PRICE_CEILING",
              ...values,
              operator: op === "<" ? "LESS_THAN" : "LESS_THAN_OR_EQUAL",
            }
          : { type: "FIXED_PRICE", ...values };
    } else issues.push("SELLING_PRICE_TO_CONFIRM");
  } else if (input.priceOperator) issues.push("SELLING_PRICE_TO_CONFIRM");
  const purchase = literalPrice(input.purchasePrice);
  const supplier = text(input.supplierCondition);
  const purchaseMatch = purchase.match(new RegExp(`^${money}$`));
  const discount = supplier.match(
    new RegExp(`^remise fournisseur ${number}\\s*%$`),
  );
  if (purchase && !purchaseMatch) issues.push("PURCHASE_PRICE_TO_CONFIRM");
  if (supplier && (!discount || decimal(discount[1]!) > 100))
    issues.push("SUPPLIER_CONDITION_TO_CONFIRM");
  const conditionResult = commercialPurchaseConditionSchema.safeParse({
    purchasePrice: purchaseMatch ? decimal(purchaseMatch[1]!) : null,
    unit: purchaseMatch ? unit(purchaseMatch[2]!) : null,
    supplierDiscountPct:
      discount && decimal(discount[1]!) <= 100 ? decimal(discount[1]!) : null,
    minimumPurchaseQuantity: null,
    rawLabel: input.supplierCondition ?? null,
  });
  const mechanismResult = commercialMechanismSchema.safeParse(mechanism);
  if (mechanism && !mechanismResult.success)
    issues.push("CUSTOMER_MECHANISM_TO_CONFIRM");
  if (!conditionResult.success) issues.push("SUPPLIER_CONDITION_TO_CONFIRM");
  return {
    status: "TO_VALIDATE" as const,
    mechanism: mechanismResult.success ? mechanismResult.data : null,
    purchaseCondition:
      (purchase || supplier) && conditionResult.success
        ? conditionResult.data
        : null,
    raw: { ...input },
    issues,
  };
}

/** Recomputable projection: never edits the cached AI draft or source citations. */
export function normalizeCommercialDraftMechanisms(draft: {
  blocks: Array<{
    kind: string;
    sourceBlockIndex: number;
    fields: Array<{
      name: string;
      rawValue: string | null;
      validationStatus: "TO_VALIDATE";
    }>;
  }>;
}) {
  return draft.blocks
    .filter((block) => block.kind === "OFFER")
    .map((block) => {
      const field = (name: string) =>
        block.fields.find((item) => item.name === name)?.rawValue ?? null;
      const selling = field("sellingPrice");
      const purchase = field("purchasePrice");
      const salesUnit = field("salesUnit");
      // Only an explicit price field plus explicit unit may form a price candidate.
      const withUnit = (value: string | null) =>
        value && salesUnit && /^\d+(?:[,.]\d{1,2})?\s*€$/.test(value.trim())
          ? `${value}/${salesUnit.replace(/^(?:le|la)\s+/, "")}`
          : value;
      return {
        sourceBlockIndex: block.sourceBlockIndex,
        ...normalizeCommercialMechanisms({
          sellingPrice: withUnit(selling),
          priceOperator: field("priceOperator"),
          customerMechanism: field("customerMechanism"),
          purchasePrice: purchase,
          supplierCondition: field("supplierCondition"),
        }),
      };
    });
}
