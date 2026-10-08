import {
  commercialAiPageOutputSchema,
  type CommercialAiPageOutput,
  type CommercialEvidence,
  type CommercialPdfPage,
} from "@fl-copilot/domain";

function normalized(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("fr-FR");
}
export function commercialLiteralContains(text: string, fragment: string) {
  const haystack = normalized(text);
  const needle = normalized(fragment);
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    const before = haystack[index - 1] ?? "";
    const after = haystack[index + needle.length] ?? "";
    const wordBefore = /^\p{L}/u.test(needle) && /[\p{L}\p{N}]/u.test(before);
    const wordAfter = /\p{L}$/u.test(needle) && /[\p{L}\p{N}]/u.test(after);
    const digitBefore = /^\p{N}/u.test(needle) && /[\p{N}.,/:-]/u.test(before);
    const digitAfter = /\p{N}$/u.test(needle) && /[\p{N}.,/:-]/u.test(after);
    if (!wordBefore && !wordAfter && !digitBefore && !digitAfter) return true;
    index = haystack.indexOf(needle, index + 1);
  }
  return false;
}
function supported(
  ref: CommercialEvidence,
  pages: ReadonlyMap<number, CommercialPdfPage>,
) {
  const page = pages.get(ref.pageNumber);
  if (
    !page ||
    new Set(ref.spanIndices).size !== ref.spanIndices.length ||
    ref.spanIndices.some((id, i) => i > 0 && id < ref.spanIndices[i - 1]!)
  )
    return false;
  const spans = ref.spanIndices.map((index) =>
    page.spans.find((span) => span.index === index),
  );
  if (spans.some((span) => !span)) return false;
  return commercialLiteralContains(
    spans.map((span) => span!.text).join(" "),
    ref.quote,
  );
}
export function anchorCommercialAiDraft(
  output: unknown,
  targetPage: number,
  sourcePages: readonly CommercialPdfPage[],
) {
  const raw = commercialAiPageOutputSchema.parse(output);
  const pages = new Map(sourcePages.map((page) => [page.pageNumber, page]));
  const issues: Array<{
    blockIndex: number;
    fieldName: string | null;
    code: "UNSUPPORTED_BLOCK" | "UNSUPPORTED_FIELD" | "DUPLICATE_FIELD";
  }> = [];
  const blocks = raw.blocks.flatMap((block, blockIndex) => {
    if (
      !block.evidence.some((ref) => ref.pageNumber === targetPage) ||
      !block.evidence.every((ref) => supported(ref, pages))
    ) {
      issues.push({ blockIndex, fieldName: null, code: "UNSUPPORTED_BLOCK" });
      return [];
    }
    const fieldCounts = new Map<string, number>();
    for (const field of block.fields)
      fieldCounts.set(field.name, (fieldCounts.get(field.name) ?? 0) + 1);
    const fields = block.fields.map((field) => {
      const duplicate =
        field.name !== "productIdentifier" &&
        (fieldCounts.get(field.name) ?? 0) > 1;
      const evidenceSupported = field.evidence.every((ref) =>
        supported(ref, pages),
      );
      const rawSupported =
        field.rawValue === null ||
        (field.evidence.length > 0 &&
          commercialLiteralContains(
            field.evidence.map((ref) => ref.quote).join(" "),
            field.rawValue,
          ));
      if (duplicate || !evidenceSupported || !rawSupported) {
        issues.push({
          blockIndex,
          fieldName: field.name,
          code: duplicate ? "DUPLICATE_FIELD" : "UNSUPPORTED_FIELD",
        });
        return {
          ...field,
          rawValue: null,
          confidence: 0,
          evidence: [],
          validationStatus: "TO_VALIDATE" as const,
        };
      }
      return {
        ...field,
        confidence: field.rawValue === null ? 0 : field.confidence,
        validationStatus: "TO_VALIDATE" as const,
      };
    });
    const label = commercialLiteralContains(
      block.evidence.map((ref) => ref.quote).join(" "),
      block.label,
    )
      ? block.label
      : block.evidence[0]!.quote.slice(0, 240);
    return [
      {
        ...block,
        label,
        sourceBlockIndex: blockIndex,
        fields,
        validationStatus: "TO_VALIDATE" as const,
      },
    ];
  });
  const dates = new Set([
    "documentDate",
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
  const warnings = [...raw.warnings];
  if (
    blocks.some((block) =>
      block.fields.some(
        (field) =>
          dates.has(field.name) &&
          field.rawValue &&
          !/\b(?:19|20)\d{2}\b/.test(field.rawValue),
      ),
    ) &&
    !warnings.includes("UNCERTAIN_DATE")
  )
    warnings.push("UNCERTAIN_DATE");
  return { blocks, warnings, issues };
}
export function selectCommercialAiContext(
  target: CommercialPdfPage,
  pages: readonly CommercialPdfPage[],
  maxCharacters = 160_000,
) {
  const selected: CommercialPdfPage[] = [];
  let size = 0;
  for (const page of [
    target,
    ...pages.filter((p) => p.pageNumber === 1),
    ...pages.filter((p) => Math.abs(p.pageNumber - target.pageNumber) === 1),
  ]) {
    if (selected.some((item) => item.pageNumber === page.pageNumber)) continue;
    const input = commercialAiPageInput(page);
    const nextSize = JSON.stringify(input).length;
    if (size + nextSize > maxCharacters) {
      if (page === target) throw new Error("COMMERCIAL_AI_PAGE_SIZE_LIMIT");
      continue;
    }
    selected.push(page);
    size += nextSize;
  }
  return selected;
}
export function commercialAiPageInput(page: CommercialPdfPage) {
  return {
    pageNumber: page.pageNumber,
    width: page.width,
    height: page.height,
    spans: page.spans.map((span) => ({
      index: span.index,
      text: span.text,
      x: Math.round(span.transform[4]! * 100) / 100,
      y: Math.round(span.transform[5]! * 100) / 100,
      width: Math.round(span.width * 100) / 100,
      height: Math.round(span.height * 100) / 100,
    })),
  };
}
export type AnchoredCommercialDraft = ReturnType<
  typeof anchorCommercialAiDraft
>;
export type { CommercialAiPageOutput };
