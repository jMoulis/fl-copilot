import {
  commercialOfferChoiceSchema,
  type CommercialOfferChoice,
  type CommercialOfferSource,
  type CommercialVisualPageOutput,
} from "@fl-copilot/domain";
import { normalizeCommercialMechanisms } from "./mechanism-normalization";
import { commercialSourceDate, commercialSourceYear } from "./commercial-week";
type Digest = (text: string) => Promise<string>;
export function commercialChoiceIdentityText(
  storeId: string,
  source: CommercialOfferSource,
) {
  return JSON.stringify([
    "fl-copilot/offer-choice.v1",
    storeId.toLowerCase(),
    source.readingId.toLowerCase(),
    source.operationIndex,
    source.itemIndex,
  ]);
}
export async function commercialChoiceId(
  storeId: string,
  source: CommercialOfferSource,
  digest: Digest,
) {
  const raw = (
    await digest(commercialChoiceIdentityText(storeId, source))
  ).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(raw))
    throw Error("COMMERCIAL_CHOICE_DIGEST_INVALID");
  const chars = raw.slice(0, 32).split("");
  chars[12] = "8";
  chars[16] = (8 + (parseInt(chars[16]!, 16) & 3)).toString(16);
  const hex = chars.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function commercialChoiceDuplicateKey(choice: CommercialOfferChoice) {
  const c = commercialOfferChoiceSchema.parse(choice);
  return JSON.stringify([
    c.storeId.toLowerCase(),
    c.source.sourceDocumentId.toLowerCase(),
    c.operationKind,
    c.operationLabel
      .normalize("NFKC")
      .toLocaleLowerCase("fr-FR")
      .replace(/\s+/g, " ")
      .trim(),
    c.productId.toLowerCase(),
    c.saleStart,
    c.saleEnd,
    c.mechanism,
  ]);
}
export function commercialChoiceSameSource(
  a: CommercialOfferChoice,
  b: CommercialOfferChoice,
) {
  return (
    a.id === b.id &&
    a.storeId === b.storeId &&
    JSON.stringify(a.source) === JSON.stringify(b.source) &&
    a.operationKind === b.operationKind &&
    a.operationLabel === b.operationLabel &&
    a.rawProductLabel === b.rawProductLabel &&
    a.createdAt === b.createdAt
  );
}
export function commercialOfferProposal(
  operation: CommercialVisualPageOutput["operations"][number],
  item: CommercialVisualPageOutput["operations"][number]["items"][number],
) {
  function one(name: string, inherited = false) {
    const own = item.fields.filter((f) => f.name === name);
    const fields =
      own.length || !inherited
        ? own
        : operation.fields.filter((f) => f.name === name);
    return fields.length === 1 ? fields[0]!.rawValue : null;
  }
  const year = item.fields.some((f) => f.name === "documentYear")
    ? commercialSourceYear(item)
    : commercialSourceYear(operation);
  const start = one("saleStart", true),
    end = one("saleEnd", true);
  const unit = one("salesUnit");
  const canonicalUnit =
    unit && /^(?:(?:le|la)\s+)?kg$/i.test(unit)
      ? "kg"
      : unit && /^(?:(?:le|la)\s+)?pi[eè]ce$/i.test(unit)
        ? "pièce"
        : unit &&
            /^(?:le|la)\s+(?:filet|ruban|sachet|barquette|pack)\b/i.test(unit)
          ? "unité conditionnée"
          : null;
  const price = one("sellingPrice");
  const sellingPrice =
    price && /^\d+(?:[,.]\d{1,2})?\s*€$/.test(price) && canonicalUnit
      ? `${price}/${canonicalUnit}`
      : price;
  const normalized = normalizeCommercialMechanisms({
    sellingPrice,
    priceOperator: one("priceOperator", true),
    customerMechanism: one("customerMechanism", true),
  });
  const ambiguousMechanism = [
    "sellingPrice",
    "priceOperator",
    "salesUnit",
    "customerMechanism",
  ].some((name) => {
    const own = item.fields.filter((f) => f.name === name),
      fields = own.length
        ? own
        : operation.fields.filter((f) => f.name === name);
    return fields.length > 1 || fields.some((f) => f.rawValue === null);
  });
  return {
    saleStart: start ? (commercialSourceDate(start, year) ?? "") : "",
    saleEnd: end ? (commercialSourceDate(end, year) ?? "") : "",
    mechanism: ambiguousMechanism ? null : normalized.mechanism,
    sourceFields: [...operation.fields, ...item.fields],
  };
}
export function commercialChoiceProductUnitMatches(
  choice: Pick<CommercialOfferChoice, "mechanism">,
  salesUnit: string,
) {
  const m = choice.mechanism;
  const unit =
    m.type === "THRESHOLD_PRICE"
      ? m.priceUnit
      : m.type === "CARD_BENEFIT"
        ? null
        : m.unit;
  return !unit || salesUnit === "UNKNOWN" || unit === salesUnit;
}

export function commercialChoiceWithinWeek(
  choice: CommercialOfferChoice,
  week: { start: string; end: string },
) {
  return choice.saleStart <= week.end && choice.saleEnd >= week.start;
}
