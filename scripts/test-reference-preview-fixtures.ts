import { commercialVersionFixture } from "./test-commercial-version-fixtures";
import { compareCommercialDocumentVersions } from "../packages/commercial-core/src/index";
export async function referencePreviewFixture(existing = false) {
  const data = await commercialVersionFixture(),
    { f, g, decision } = data;
  const input = {
    beforeDocumentId: f.sourceDocumentId,
    afterDocumentId: g.sourceDocumentId,
    preference: "PREFER_NEW" as const,
  };
  const comparison = compareCommercialDocumentVersions({
    storeId: f.storeId,
    beforeDocumentId: f.sourceDocumentId,
    afterDocumentId: g.sourceDocumentId,
    before: [f.reading],
    after: [g.reading],
  });
  const basis = {
    storeId: f.storeId,
    sources: { before: decision.before, after: decision.after },
    beforeFilename: "S41-original.pdf",
    afterFilename: "S41-corrige.pdf",
    counts: comparison.counts as Record<
      | "CHANGED"
      | "UNCHANGED"
      | "NOT_FOUND_IN_NEW"
      | "NEW_IN_READING"
      | "AMBIGUOUS",
      number
    >,
    warningCount:
      (f.reading.reading?.warnings.length ?? 0) +
      (g.reading.reading?.warnings.length ?? 0),
    previous: existing ? decision : null,
  };
  return { ...data, input, basis };
}
