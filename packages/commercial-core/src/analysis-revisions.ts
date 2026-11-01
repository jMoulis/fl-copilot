/** Keep a prior usable analysis visible until every page of a newer reading arrived.
 * Immutable IDs remain available to historical decisions and source references. */
export function currentCommercialAnalysisPages<
  T extends {
    sourceDocumentId: string;
    pageNumber: number;
    pageCount: number;
    analysisRevision?: number;
    status?: string;
  },
>(pages: readonly T[]): T[] {
  const docs = new Map<string, Map<number, T[]>>();
  for (const page of pages) {
    let revisions = docs.get(page.sourceDocumentId);
    if (!revisions) {
      revisions = new Map();
      docs.set(page.sourceDocumentId, revisions);
    }
    const revision = page.analysisRevision ?? 0;
    const group = revisions.get(revision) ?? [];
    group.push(page);
    revisions.set(revision, group);
  }
  return [...docs.values()].flatMap((revisions) => {
    const ordered = [...revisions.entries()].sort(([a], [b]) => b - a);
    const complete = ordered.find(([, rows]) => {
      const count = rows[0]!.pageCount;
      return (
        rows.length === count &&
        new Set(rows.map((p) => p.pageNumber)).size === count &&
        rows.every(
          (p) =>
            p.pageCount === count &&
            p.pageNumber >= 1 &&
            p.pageNumber <= count &&
            (p.status === undefined || p.status === "READY"),
        )
      );
    });
    // Preserve legacy partial results if no complete generation has arrived yet.
    return (complete ?? ordered.at(-1))![1]
      .slice()
      .sort((a, b) => a.pageNumber - b.pageNumber);
  });
}
