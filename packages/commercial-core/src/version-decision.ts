import {
  commercialVersionDecisionSchema,
  type CommercialVersionDecision,
} from "@fl-copilot/domain";
import { commercialUuidFromText } from "./offer-choice";
import {
  compareCommercialDocumentVersions,
  type CommercialComparisonPage,
} from "./document-version-comparison";
export function commercialVersionDecisionId(
  storeId: string,
  beforeId: string,
  afterId: string,
  digest: (text: string) => Promise<string>,
) {
  return commercialUuidFromText(
    JSON.stringify([
      "fl-copilot/version-decision.v1",
      storeId.toLowerCase(),
      ...[beforeId.toLowerCase(), afterId.toLowerCase()].sort(),
    ]),
    digest,
  );
}
export function commercialVersionDecisionSameIdentity(
  a: CommercialVersionDecision,
  b: CommercialVersionDecision,
) {
  return (
    a.id === b.id &&
    a.storeId === b.storeId &&
    a.createdAt === b.createdAt &&
    JSON.stringify(a.before) === JSON.stringify(b.before) &&
    JSON.stringify(a.after) === JSON.stringify(b.after)
  );
}
export function commercialVersionDecisionSourcesValid(
  input: CommercialVersionDecision,
  pages: readonly CommercialComparisonPage[],
) {
  const d = commercialVersionDecisionSchema.parse(input);
  const selected = (s: CommercialVersionDecision["before"]) =>
    pages.filter((p) => s.readingIds.includes(p.id));
  const before = selected(d.before),
    after = selected(d.after);
  for (const [s, rows] of [
    [d.before, before],
    [d.after, after],
  ] as const) {
    if (
      rows.length !== s.readingIds.length ||
      rows.length !== rows[0]?.pageCount ||
      new Set(rows.map((p) => p.pageNumber)).size !== rows.length ||
      rows.some(
        (p) =>
          p.storeId !== d.storeId ||
          p.sourceDocumentId !== s.documentId ||
          p.checksum !== s.checksum,
      )
    )
      return false;
  }
  try {
    const c = compareCommercialDocumentVersions({
      storeId: d.storeId,
      beforeDocumentId: d.before.documentId,
      afterDocumentId: d.after.documentId,
      before,
      after,
    });
    return (
      c.beforeCoverage.complete && c.afterCoverage.complete && !c.sameBinary
    );
  } catch {
    return false;
  }
}
export function commercialVersionDecisionSummary(d: CommercialVersionDecision) {
  return `${d.preference === "KEEP_PREVIOUS" ? "Ancien PDF conservé comme référence" : "PDF corrigé préféré comme référence"} · ${d.before.checksum.slice(-8)} → ${d.after.checksum.slice(-8)}${d.note ? ` · ${d.note}` : ""}`;
}

export function commercialVersionDecisionSameOriginalPair(
  a: CommercialVersionDecision,
  b: CommercialVersionDecision,
) {
  const originals = (d: CommercialVersionDecision) =>
    [d.before, d.after]
      .map((s) => [s.documentId, s.checksum])
      .sort(([a], [b]) => a!.localeCompare(b!));
  return (
    a.id === b.id &&
    a.storeId === b.storeId &&
    JSON.stringify(originals(a)) === JSON.stringify(originals(b))
  );
}
