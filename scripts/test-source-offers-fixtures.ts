import { commercialChoiceFixture } from "./test-commercial-choice-fixtures";
export async function sourceOffersFixture(storeId?: string) {
  const f = await commercialChoiceFixture({ ...(storeId ? { storeId } : {}) }),
    op = f.reading.reading!.operations[0]!,
    item = op.items[0]!,
    input = {
      sourceDocumentId: f.sourceDocumentId,
      businessDate: "2026-10-08",
      pageNumber: 1,
      offset: 0,
      limit: 5,
    };
  const offer = {
    source: f.choice.source,
    pageNumber: 1,
    operationKind: op.kind,
    operationLabel: op.label,
    rawProductLabel: item.label,
    operationFields: op.fields,
    itemFields: item.fields,
    operationEvidence: op.evidence,
    itemEvidence: item.evidence,
    proposal: {
      saleStart: f.choice.saleStart,
      saleEnd: f.choice.saleEnd,
      mechanism: f.choice.mechanism,
    },
    validationStatus: "TO_VALIDATE" as const,
  };
  const result = {
    storeId: f.storeId,
    input,
    status: "READY" as const,
    week: {
      date: input.businessDate,
      year: 2026,
      number: 41,
      start: "2026-10-05",
      end: "2026-10-11",
    },
    readingId: f.readingId,
    checksum: f.reading.checksum,
    pageCount: 1,
    totalOffers: 1,
    excludedOffers: 0,
    unknownOffers: 0,
    warnings: [],
    warningCount: 0,
    warningsComplete: true,
    offers: [offer],
    nextOffset: null,
    evidence: [
      {
        id: "source-offer",
        sourceType: "SOURCE_DOCUMENT" as const,
        sourceId: f.sourceDocumentId,
        sourceVersion: 1,
        label: item.label,
        value: "Extraction à confirmer",
        factKind: "SOURCE_INSTRUCTION" as const,
      },
    ],
  };
  return { f, input, result };
}
