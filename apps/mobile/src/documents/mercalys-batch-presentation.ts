import {
  normalizeProductLabel,
  type MercalysBatchItem,
} from "@fl-copilot/domain";
export interface BatchPublicationSummary {
  checksum: string;
  source_type: string;
  published_count: number;
  remaining_count: number;
}
export function matchingBatchPublication(
  item: MercalysBatchItem,
  publications: readonly BatchPublicationSummary[],
) {
  const result = item.result;
  const sourceType =
    result.status === "REVIEW" || result.status === "DUPLICATE"
      ? result.sourceType
      : undefined;
  const matches = publications.filter(
    (p) =>
      p.checksum === item.checksum &&
      (!sourceType || p.source_type === sourceType),
  );
  return matches.length === 1 ? matches[0] : undefined;
}
export function batchPublicationLabel(
  item: MercalysBatchItem,
  publications: readonly BatchPublicationSummary[],
) {
  const publication = matchingBatchPublication(item, publications);
  if (!publication) return undefined;
  return `✓ Publié · ${publication.published_count} ligne${publication.published_count > 1 ? "s" : ""}${publication.remaining_count ? ` · ${publication.remaining_count} ligne${publication.remaining_count > 1 ? "s" : ""} non publiée${publication.remaining_count > 1 ? "s" : ""}` : ""}`;
}
export type BatchItemFilter = "ALL" | "REVIEW" | "PUBLISHED" | "QUEUED";
export function filterBatchItems(
  items: readonly MercalysBatchItem[],
  publications: readonly BatchPublicationSummary[],
  query: string,
  filter: BatchItemFilter,
) {
  const term = normalizeProductLabel(query);
  return items.filter((item) => {
    const r = item.result,
      p = matchingBatchPublication(item, publications);
    const fullyPublished = p && p.remaining_count === 0;
    const review =
      r.status === "FAILED" ||
      (p?.remaining_count ?? 0) > 0 ||
      (!fullyPublished &&
        r.status === "REVIEW" &&
        (r.productReviewCount > 0 || r.errorCount > 0 || r.overlap));
    return (
      (!term || normalizeProductLabel(item.filename).includes(term)) &&
      (filter === "ALL" ||
        (filter === "REVIEW" && review) ||
        (filter === "PUBLISHED" && p && p.published_count > 0) ||
        (filter === "QUEUED" && r.status === "QUEUED"))
    );
  });
}
