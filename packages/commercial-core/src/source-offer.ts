import {
  copilotSourceOfferSchema,
  type CommercialVisualPageOutput,
} from "@fl-copilot/domain";
import { commercialOfferProposal } from "./offer-choice";
/** Exact immutable source projection shared by remote preparation and native review. */
export function projectCommercialSourceOffer(
  page: {
    id: string;
    sourceDocumentId: string;
    checksum: string;
    pageNumber: number;
    reading: { operations: CommercialVisualPageOutput["operations"] } | null;
  },
  operationIndex: number,
  itemIndex: number,
) {
  const operation = page.reading?.operations[operationIndex],
    item = operation?.items[itemIndex];
  if (!operation || item?.kind !== "OFFER")
    throw Error("COMMERCIAL_CHOICE_SOURCE_INVALID");
  const proposal = commercialOfferProposal(operation, item);
  return copilotSourceOfferSchema.parse({
    source: {
      sourceDocumentId: page.sourceDocumentId,
      readingId: page.id,
      checksum: page.checksum,
      operationIndex,
      itemIndex,
    },
    pageNumber: page.pageNumber,
    operationKind: operation.kind,
    operationLabel: operation.label,
    rawProductLabel: item.label,
    operationFields: operation.fields,
    itemFields: item.fields,
    operationEvidence: operation.evidence,
    itemEvidence: item.evidence,
    proposal: {
      saleStart: proposal.saleStart || null,
      saleEnd: proposal.saleEnd || null,
      mechanism: proposal.mechanism,
    },
    validationStatus: "TO_VALIDATE",
  });
}
