import { commercialLiteralContains } from "./ai-draft-evidence";
import {
  commercialVisualPageOutputSchema,
  type CommercialPdfPage,
  type CommercialVisualEvidence,
} from "@fl-copilot/domain";
function literal(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("fr-FR");
}
function contextualDateSupported(value: string, quotes: string) {
  const match = literal(value).match(
    /^(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche) (\d{1,2}) (janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)(?: ((?:19|20)\d{2}))?$/,
  );
  return (
    !!match &&
    new RegExp(`\\b${match[1]}\\s+${match[2]}(?![\\d/:]|[.,]\\d)`).test(
      literal(quotes),
    ) &&
    commercialLiteralContains(quotes, match[3]!) &&
    (!match[4] || commercialLiteralContains(quotes, match[4]))
  );
}
const dateFields = new Set([
  "saleStart",
  "saleEnd",
  "preorderStart",
  "preorderDeadline",
  "deliveryStart",
  "deliveryEnd",
  "executionDeadline",
  "communicationStart",
  "communicationEnd",
]);
export function anchorCommercialVisualReading(
  output: unknown,
  targetPage: number,
  pages: readonly CommercialPdfPage[],
) {
  const parsed = commercialVisualPageOutputSchema.parse(output);
  const known = new Map(pages.map((p) => [p.pageNumber, literal(p.text)]));
  if (!known.has(targetPage)) throw Error("VISUAL_TARGET_PAGE_INVALID");
  const evidence = (refs: CommercialVisualEvidence[], value?: string | null) =>
    refs.map((ref) => {
      const text = known.get(ref.pageNumber);
      if (text === undefined) throw Error("VISUAL_REFERENCE_PAGE_INVALID");
      if (
        ref.region &&
        (ref.region.right <= ref.region.left ||
          ref.region.bottom <= ref.region.top)
      )
        throw Error("VISUAL_REFERENCE_REGION_INVALID");
      const supported =
        commercialLiteralContains(text, ref.quote) &&
        (!value || commercialLiteralContains(ref.quote, value));
      // Bounding boxes are proposed locations, not deterministic proof of image text.
      return {
        ...ref,
        verification: supported
          ? ("TEXT_SUPPORTED" as const)
          : ("VISUAL_TO_VERIFY" as const),
      };
    });
  let unsupportedFields = false;
  const fields = (items: (typeof parsed.operations)[number]["fields"]) =>
    items.map((field) => {
      const quotes = field.evidence.map((ref) => ref.quote).join(" ");
      const valueSupported =
        field.rawValue === null ||
        commercialLiteralContains(quotes, field.rawValue) ||
        (dateFields.has(field.name) &&
          contextualDateSupported(field.rawValue, quotes));
      if (!valueSupported) unsupportedFields = true;
      return {
        ...field,
        rawValue: valueSupported ? field.rawValue : null,
        confidence:
          valueSupported && field.rawValue !== null ? field.confidence : 0,
        evidence: evidence(field.evidence, field.rawValue),
        validationStatus: "TO_VALIDATE" as const,
      };
    });
  const item = (entry: (typeof parsed.tgIdeas)[number]) => {
    if (!entry.evidence.some((ref) => ref.pageNumber === targetPage))
      throw Error("VISUAL_TARGET_ANCHOR_MISSING");
    return {
      ...entry,
      fields: fields(entry.fields),
      evidence: evidence(entry.evidence),
      validationStatus: "TO_VALIDATE" as const,
    };
  };
  const anchored = {
    operations: parsed.operations.map((operation) => {
      if (!operation.evidence.some((ref) => ref.pageNumber === targetPage))
        throw Error("VISUAL_TARGET_ANCHOR_MISSING");
      return {
        ...operation,
        fields: fields(operation.fields),
        evidence: evidence(operation.evidence),
        items: operation.items.map(item),
        validationStatus: "TO_VALIDATE" as const,
      };
    }),
    tgIdeas: parsed.tgIdeas.map(item),
    otherInformation: parsed.otherInformation.map(item),
    warnings: parsed.warnings,
  };
  if (unsupportedFields)
    anchored.warnings = [
      "Des valeurs sans citation cohérente ont été retirées ; vérifiez les références concernées.",
      ...anchored.warnings,
    ].slice(0, 30);
  return anchored;
}
