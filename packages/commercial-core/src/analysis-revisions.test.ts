import { expect, it } from "vitest";
import { currentCommercialAnalysisPages } from "./analysis-revisions";
const page = (
  pageNumber: number,
  analysisRevision?: number,
  status = "READY",
  sourceDocumentId = "a",
) => ({ sourceDocumentId, pageNumber, pageCount: 2, analysisRevision, status });
it("keeps coherent prior results while new pages arrive, without mixing generations or sources", () => {
  const old = [page(1), page(2)],
    fresh = [page(1, 1), page(2, 1)];
  expect(currentCommercialAnalysisPages([...old, fresh[0]!])).toEqual(old);
  expect(currentCommercialAnalysisPages([...old, ...fresh])).toEqual(fresh);
  expect(
    currentCommercialAnalysisPages([...old, fresh[0]!, page(2, 1, "FAILED")]),
  ).toEqual(old);
  expect(
    currentCommercialAnalysisPages([
      ...old,
      ...fresh,
      page(1, 2),
      page(1, undefined, "READY", "b"),
    ]),
  ).toEqual([...fresh, page(1, undefined, "READY", "b")]);
  expect(currentCommercialAnalysisPages([old[0]!, ...fresh])).toEqual(fresh);
  expect(currentCommercialAnalysisPages([])).toEqual([]);
});
it("does not mistake duplicate/out-of-range pages for a complete replacement", () => {
  const old = [page(1), page(2)];
  expect(
    currentCommercialAnalysisPages([...old, page(1, 1), page(1, 1)]),
  ).toEqual(old);
  expect(
    currentCommercialAnalysisPages([...old, page(1, 1), page(3, 1)]),
  ).toEqual(old);
});
