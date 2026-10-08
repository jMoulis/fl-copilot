import type { AnchoredCommercialDraft } from "./ai-draft-evidence";
import { reconcileCommercialDraftPages } from "./offer-reconciliation";
export type SummaryPage = {
  id: string;
  storeId: string;
  sourceDocumentId: string;
  checksum: string;
  pageNumber: number;
  pageCount: number;
  blocks: AnchoredCommercialDraft["blocks"];
  warnings: AnchoredCommercialDraft["warnings"];
  issues: AnchoredCommercialDraft["issues"];
};
export type SummaryDecision = {
  decision: { pageId: string; sourceBlockIndex: number; decision: string };
  state: string;
};
export type SummaryItem = {
  key: string;
  page: SummaryPage;
  block: SummaryPage["blocks"][number];
  section: SummarySection;
};
export type SummarySection =
  | "DRAMAT"
  | "PROSPECTUS"
  | "TG"
  | "BASICS"
  | "OTHER_OPERATIONS"
  | "OFFERS"
  | "DEADLINES"
  | "INFORMATION";
function literal(raw: string) {
  return raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR")
    .replace(/\s+/g, " ")
    .trim();
}
export function commercialSummarySections(
  block: SummaryItem["block"],
): SummarySection[] {
  const sections: SummarySection[] = [];
  const fields = block.fields
    .filter((f) => ["operationName", "operationNature"].includes(f.name))
    .flatMap((f) => (f.rawValue ? [f.rawValue] : []));
  const roleText = literal(
    [...fields, ...(block.kind === "OPERATION" ? [block.label] : [])].join(" "),
  );
  if (/\bdramat(?:isation|ization)?\b/.test(roleText)) sections.push("DRAMAT");
  if (/\bprospectus\b/.test(roleText)) sections.push("PROSPECTUS");
  const tg = literal(
    [
      block.label,
      ...block.fields
        .filter((f) => f.name === "tg")
        .flatMap((f) => (f.rawValue ? [f.rawValue] : [])),
    ].join(" "),
  );
  if (block.kind === "MERCHANDISING" && /^tg\s+(?:speciale|[1-4]\b)/.test(tg))
    sections.push("TG");
  const mechanism = literal(
    block.fields
      .filter((f) => f.name === "customerMechanism")
      .flatMap((f) => (f.rawValue ? [f.rawValue] : []))
      .join(" "),
  );
  if (
    /\b(?:degressif|degressifs|vente en lot|ventes en lots)\b/.test(roleText) ||
    (block.kind === "OFFER" &&
      /\b(?:lot de|a partir de|degressif)\b/.test(mechanism))
  )
    sections.push("BASICS");
  if (sections.length) return sections;
  if (block.kind === "OPERATION") return ["OTHER_OPERATIONS"];
  if (block.kind === "OFFER") return ["OFFERS"];
  if (["PREORDER_WINDOW", "DELIVERY_WINDOW"].includes(block.kind))
    return ["DEADLINES"];
  return ["INFORMATION"];
}
export function commercialSummarySection(block: SummaryItem["block"]) {
  return commercialSummarySections(block)[0]!;
}
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
const materialFields = new Set([
  "productLabel",
  "productIdentifier",
  "sellingPrice",
  "priceOperator",
  "salesUnit",
  "customerMechanism",
  "purchasePrice",
  "supplierCondition",
  "applicabilityCondition",
  ...dates,
]);
function explicitOperator(raw: string) {
  return ["<", "<=", "≤", "=", "moins de"].includes(literal(raw));
}
function explicitDate(raw: string) {
  const french = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/((?:19|20)\d{2})$/);
  const iso = raw.trim().match(/^((?:19|20)\d{2})-(\d{2})-(\d{2})$/);
  if (!french && !iso) return false;
  const year = Number(french?.[3] ?? iso?.[1]),
    month = Number(french?.[2] ?? iso?.[2]),
    day = Number(french?.[1] ?? iso?.[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}
export type SummaryQuestion = {
  key: string;
  reason:
    | "SOURCE_FIELD"
    | "DATE_YEAR"
    | "OFFER_CONFLICT"
    | "PAGE_WARNING"
    | "SYNC_CONFLICT";
  fieldName: string | null;
  itemKeys: string[];
  pageNumbers: number[];
};
/** A source brief, not a store plan or a generated recommendation. Consulting an
 * instruction does not require acknowledging every extracted clause. */
export function buildCommercialDocumentSummary(
  pages: readonly SummaryPage[],
  decisions: readonly SummaryDecision[] = [],
) {
  const ordered = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  if (
    new Set(ordered.map((p) => p.id)).size !== ordered.length ||
    new Set(ordered.map((p) => `${p.sourceDocumentId}:${p.pageNumber}`))
      .size !== ordered.length
  )
    throw Error("COMMERCIAL_SUMMARY_DUPLICATE_PAGE");
  if (
    ordered.some(
      (p) =>
        p.storeId !== ordered[0]?.storeId ||
        p.sourceDocumentId !== ordered[0]?.sourceDocumentId ||
        p.checksum !== ordered[0]?.checksum,
    )
  )
    throw Error("COMMERCIAL_SUMMARY_SOURCE_MISMATCH");
  const items: SummaryItem[] = ordered.flatMap((page) =>
    page.blocks.map((block) => ({
      key: `${page.id}:${block.sourceBlockIndex}`,
      page,
      block,
      section: commercialSummarySection(block),
    })),
  );
  const groups = ordered.length
    ? reconcileCommercialDraftPages({
        storeId: ordered[0]!.storeId,
        sourceDocumentId: ordered[0]!.sourceDocumentId,
        pages: ordered.map((page) => ({
          pageNumber: page.pageNumber,
          draft: {
            blocks: page.blocks,
            issues: page.issues,
            warnings: page.warnings,
          },
        })),
      })
    : [];
  const questions = new Map<string, SummaryQuestion>();
  const add = (
    key: string,
    reason: SummaryQuestion["reason"],
    fieldName: string | null,
    keyItems: SummaryItem[],
    pageNumbers: number[],
  ) => {
    const previous = questions.get(key);
    questions.set(key, {
      key,
      reason,
      fieldName,
      itemKeys: [
        ...new Set([
          ...(previous?.itemKeys ?? []),
          ...keyItems.map((i) => i.key),
        ]),
      ],
      pageNumbers: [
        ...new Set([...(previous?.pageNumbers ?? []), ...pageNumbers]),
      ].sort((a, b) => a - b),
    });
  };
  const itemsByOccurrence = new Map(
    items.map((item) => [
      `${item.page.pageNumber}:${item.block.sourceBlockIndex}`,
      item,
    ]),
  );
  const choicesByItem = new Map<string, SummaryDecision[]>();
  for (const choice of decisions) {
    const key = `${choice.decision.pageId}:${choice.decision.sourceBlockIndex}`;
    choicesByItem.set(key, [...(choicesByItem.get(key) ?? []), choice]);
  }
  const conflictingItems = new Set<string>();
  for (const group of groups) {
    if (!group.conflicts.length) continue;
    const refs = group.variants.flatMap((v) => v.occurrences);
    const affected = refs.flatMap((ref) => {
      const item = itemsByOccurrence.get(
        `${ref.pageNumber}:${ref.sourceBlockIndex}`,
      );
      return item ? [item] : [];
    });
    for (const item of affected) conflictingItems.add(item.key);
    add(
      `offer:${group.key}`,
      "OFFER_CONFLICT",
      null,
      affected,
      affected.map((i) => i.page.pageNumber),
    );
  }
  const reviewed = new Set(
    decisions.map((d) => `${d.decision.pageId}:${d.decision.sourceBlockIndex}`),
  );
  const bulkEligible: SummaryItem[] = [];
  for (const item of items) {
    const choices = choicesByItem.get(item.key) ?? [];
    if (
      choices.some((d) => d.state === "CONFLICT" || d.state === "FAILED") ||
      choices.length > 1
    )
      add(
        `sync:${item.key}`,
        "SYNC_CONFLICT",
        null,
        [item],
        [item.page.pageNumber],
      );
    const issues = item.page.issues.filter(
      (i) => i.blockIndex === item.block.sourceBlockIndex,
    );
    for (const issue of issues.filter(
      (i) => i.fieldName && materialFields.has(i.fieldName),
    ))
      add(
        `field:${issue.fieldName}`,
        "SOURCE_FIELD",
        issue.fieldName,
        [item],
        [item.page.pageNumber],
      );
    for (const field of item.block.fields.filter(
      (f) =>
        materialFields.has(f.name) &&
        (f.rawValue === null || f.confidence < 0.9) &&
        !(
          dates.has(f.name) &&
          f.rawValue &&
          !/\b(?:19|20)\d{2}\b/.test(f.rawValue)
        ),
    ))
      add(
        `field:${field.name}`,
        "SOURCE_FIELD",
        field.name,
        [item],
        [item.page.pageNumber],
      );
    for (const field of item.block.fields.filter(
      (f) =>
        dates.has(f.name) &&
        f.rawValue &&
        /\b(?:19|20)\d{2}\b/.test(f.rawValue) &&
        !explicitDate(f.rawValue),
    ))
      add(
        `field:${field.name}`,
        "SOURCE_FIELD",
        field.name,
        [item],
        [item.page.pageNumber],
      );
    const unclearOperator = item.block.fields.some(
      (f) =>
        f.name === "priceOperator" &&
        f.rawValue &&
        !explicitOperator(f.rawValue),
    );
    if (unclearOperator)
      add(
        "field:priceOperator",
        "SOURCE_FIELD",
        "priceOperator",
        [item],
        [item.page.pageNumber],
      );
    const uncertainDates = item.block.fields.filter(
      (f) =>
        dates.has(f.name) &&
        f.rawValue &&
        !/\b(?:19|20)\d{2}\b/.test(f.rawValue),
    );
    if (uncertainDates.length)
      add("date-year", "DATE_YEAR", null, [item], [item.page.pageNumber]);
    // Batch confirmation is optional transcription acknowledgement only. Keep
    // ambiguous identity/date/operator/applicability out, regardless of confidence.
    const ambiguousPage = item.page.warnings.some(
      (w) => w !== "UNCERTAIN_DATE" && w !== "NO_EXTRACTABLE_TEXT",
    );
    if (
      !reviewed.has(item.key) &&
      !conflictingItems.has(item.key) &&
      !issues.length &&
      !uncertainDates.length &&
      !ambiguousPage &&
      !unclearOperator &&
      item.block.fields.length > 0 &&
      item.block.fields.every(
        (f) =>
          f.rawValue !== null &&
          f.confidence >= 0.9 &&
          f.evidence.length > 0 &&
          (!dates.has(f.name) || explicitDate(f.rawValue)),
      )
    )
      bulkEligible.push(item);
  }
  for (const page of ordered) {
    for (const warning of page.warnings) {
      if (warning === "UNCERTAIN_DATE") {
        if (
          !items.some(
            (i) =>
              i.page.id === page.id &&
              i.block.fields.some(
                (f) =>
                  dates.has(f.name) &&
                  f.rawValue &&
                  !/\b(?:19|20)\d{2}\b/.test(f.rawValue),
              ),
          )
        )
          add("date-year", "DATE_YEAR", null, [], [page.pageNumber]);
      } else
        add(
          `warning:${warning}`,
          "PAGE_WARNING",
          warning,
          items.filter((i) => i.page.id === page.id),
          [page.pageNumber],
        );
    }
    const orphanIssues = page.issues.filter(
      (issue) =>
        !page.blocks.some((b) => b.sourceBlockIndex === issue.blockIndex),
    );
    if (orphanIssues.length)
      add(
        "warning:UNSUPPORTED_BLOCK",
        "PAGE_WARNING",
        "UNSUPPORTED_BLOCK",
        [],
        [page.pageNumber],
      );
  }
  const sections = [] as Array<{ key: SummarySection; items: SummaryItem[] }>;
  for (const section of [
    "DRAMAT",
    "PROSPECTUS",
    "TG",
    "BASICS",
    "OTHER_OPERATIONS",
    "OFFERS",
    "DEADLINES",
    "INFORMATION",
  ] as const)
    sections.push({
      key: section,
      items: items.filter((i) =>
        commercialSummarySections(i.block).includes(section),
      ),
    });
  return {
    items,
    sections,
    questions: [...questions.values()],
    bulkEligible,
    offerCount: items.filter((i) => i.block.kind === "OFFER").length,
    tgCount: sections.find((s) => s.key === "TG")!.items.length,
    sourcePages: ordered.length,
    offerGroups: groups,
  };
}
