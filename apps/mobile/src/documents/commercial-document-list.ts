import {
  buildCommercialDocumentSummary,
  type SummaryDecision,
} from "@fl-copilot/commercial-core";
import type { DocumentArchive, LocalSourceDocument } from "@fl-copilot/domain";
import type { CommercialReviewPage } from "@fl-copilot/sync-contracts";
import { commercialPdfUploadPresentation } from "./commercial-pdf-upload";

export type CommercialDocumentFilter =
  "ALL" | "PENDING" | "RESULTS" | "ATTENTION" | "ARCHIVED";
type UploadJobs = Record<
  string,
  { status: string; last_error: string | null } | null
>;
export function commercialDocumentRows(
  documents: LocalSourceDocument[],
  pages: CommercialReviewPage[],
  decisions: SummaryDecision[],
  jobs: UploadJobs,
  archives: readonly DocumentArchive[] = [],
) {
  const grouped = new Map<string, CommercialReviewPage[]>();
  for (const page of pages) {
    const group = grouped.get(page.sourceDocumentId) ?? [];
    group.push(page);
    grouped.set(page.sourceDocumentId, group);
  }
  const known = new Set(documents.map((d) => d.id));
  const sources = [
    ...documents.map((document) => ({ id: document.id, document })),
    ...[...grouped.keys()]
      .filter((id) => !known.has(id))
      .map((id) => ({ id, document: null })),
  ];
  const archivedSources = new Set(
    archives
      .filter((a) => a.targetKind === "COMMERCIAL_DOCUMENT" && a.archived)
      .map((a) => a.id),
  );
  return sources.map(({ id, document }) => {
    const received = grouped.get(id) ?? [],
      job = jobs[id] ?? null;
    return {
      id,
      document,
      archived: archivedSources.has(id),
      pages: received,
      title:
        document?.originalFilename ??
        received[0]?.originalFilename ??
        "Document commercial",
      summary: buildCommercialDocumentSummary(received, decisions),
      upload: document ? commercialPdfUploadPresentation(document, job) : null,
      attention: Boolean(
        document &&
        (document.remoteProcessingStatus === "FAILED" ||
          (document.remoteUploadStatus !== "CONFIRMED" &&
            (["INVALID", "FAILED"].includes(document.remoteUploadStatus) ||
              job?.status === "RETRY" ||
              job?.last_error))),
      ),
    };
  });
}
function searchable(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR")
    .trim();
}
export function commercialDocumentPage(
  rows: ReturnType<typeof commercialDocumentRows>,
  query: string,
  filter: CommercialDocumentFilter,
  requestedPage: number,
) {
  const term = searchable(query);
  const filtered = rows.filter(
    (row) =>
      (filter === "ARCHIVED"
        ? row.archived
        : !row.archived &&
          (filter === "ALL" ||
            (filter === "RESULTS" && row.pages.length > 0) ||
            (filter === "ATTENTION" && row.attention) ||
            (filter === "PENDING" && !row.pages.length && !row.attention))) &&
      searchable(
        [
          row.title,
          row.document?.createdAt ?? "",
          row.document
            ? new Date(row.document.createdAt).toLocaleDateString("fr-FR")
            : "",
        ].join(" "),
      ).includes(term),
  );
  const size = 10,
    count = Math.max(1, Math.ceil(filtered.length / size));
  const page = Math.min(Math.max(0, requestedPage), count - 1);
  return {
    items: filtered.slice(page * size, (page + 1) * size),
    total: filtered.length,
    count,
    page,
  };
}
