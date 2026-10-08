import {
  commercialChoiceId,
  anchorCommercialVisualReading,
} from "../packages/commercial-core/src/index";
import type {
  CommercialOfferChoice,
  Product,
  CommercialVisualPageOutput,
} from "../packages/domain/src/index";
import { COMMERCIAL_VISUAL_SCHEMA_VERSION } from "../packages/domain/src/index";
import type { SynchronizedCommercialVisualReading } from "../packages/sync-contracts/src/index";
export async function makeCommercialChoiceFixture(
  input: Partial<{
    storeId: string;
    readingId: string;
    sourceDocumentId: string;
    productId: string;
  }> = {},
  digest: (text: string) => Promise<string>,
  uuid: () => string,
) {
  const storeId = input.storeId ?? uuid(),
    readingId = input.readingId ?? uuid(),
    sourceDocumentId = input.sourceDocumentId ?? uuid(),
    productId = input.productId ?? uuid();
  const raw: CommercialVisualPageOutput = {
    operations: [
      {
        kind: "DRAMAT",
        label: "Dramat raisin S41",
        summaryFr: "Raisin blanc vrac à moins de 2,20 € le kg.",
        evidence: [{ pageNumber: 1, quote: "Dramat raisin S41", region: null }],
        fields: [
          {
            name: "documentYear",
            rawValue: "2026",
            confidence: 1,
            evidence: [{ pageNumber: 1, quote: "2026", region: null }],
          },
          {
            name: "saleStart",
            rawValue: "jeudi 8 octobre",
            confidence: 1,
            evidence: [
              { pageNumber: 1, quote: "jeudi 8 octobre", region: null },
            ],
          },
          {
            name: "saleEnd",
            rawValue: "samedi 10 octobre",
            confidence: 1,
            evidence: [
              { pageNumber: 1, quote: "samedi 10 octobre", region: null },
            ],
          },
        ],
        items: [
          {
            kind: "OFFER",
            label: "Raisin blanc vrac",
            evidence: [
              { pageNumber: 1, quote: "Raisin blanc vrac", region: null },
            ],
            fields: [
              {
                name: "sellingPrice",
                rawValue: "2,20€",
                confidence: 1,
                evidence: [{ pageNumber: 1, quote: "2,20€", region: null }],
              },
              {
                name: "priceOperator",
                rawValue: "Moins de",
                confidence: 1,
                evidence: [{ pageNumber: 1, quote: "Moins de", region: null }],
              },
              {
                name: "salesUnit",
                rawValue: "le kg",
                confidence: 1,
                evidence: [{ pageNumber: 1, quote: "le kg", region: null }],
              },
            ],
          },
        ],
      },
    ],
    tgIdeas: [],
    otherInformation: [],
    warnings: [],
  };
  const reading: SynchronizedCommercialVisualReading = {
    id: readingId,
    storeId,
    sourceDocumentId,
    checksum: "sha256:test",
    pageNumber: 1,
    pageCount: 1,
    schemaVersion: COMMERCIAL_VISUAL_SCHEMA_VERSION,
    model: "test",
    remoteVersion: 1,
    status: "READY",
    errorCode: null,
    reading: anchorCommercialVisualReading(raw, 1, [
      {
        pageNumber: 1,
        width: 800,
        height: 600,
        rotation: 0,
        text: "2026 Dramat raisin S41 Raisin blanc vrac jeudi 8 octobre samedi 10 octobre Moins de 2,20€ le kg",
        spans: [],
        warnings: [],
      },
    ]),
  };
  const source = {
    sourceDocumentId,
    readingId,
    checksum: reading.checksum,
    operationIndex: 0,
    itemIndex: 0,
  };
  const choice: CommercialOfferChoice = {
    id: await commercialChoiceId(storeId, source, digest),
    storeId,
    source,
    operationKind: "DRAMAT",
    operationLabel: raw.operations[0]!.label,
    rawProductLabel: raw.operations[0]!.items[0]!.label,
    productId,
    saleStart: "2026-10-08",
    saleEnd: "2026-10-10",
    mechanism: {
      type: "PRICE_CEILING",
      amount: 2.2,
      currency: "EUR",
      unit: "KG",
      operator: "LESS_THAN",
    },
    applicabilityConfirmed: true,
    criticalFieldsConfirmed: true,
    status: "RETAINED",
    note: null,
    version: 1,
    createdAt: "2026-10-08T08:00:00.000Z",
    updatedAt: "2026-10-08T08:00:00.000Z",
  };
  const product: Product = {
    id: productId,
    storeId,
    label: "RAISIN BLANC VRAC",
    category: "UNKNOWN",
    nature: "UNKNOWN",
    salesUnit: "UNKNOWN",
    status: "ACTIVE",
    version: 1,
    createdAt: choice.createdAt,
    updatedAt: choice.updatedAt,
    deletedAt: null,
  };
  return {
    storeId,
    productId,
    sourceDocumentId,
    readingId,
    choice,
    reading,
    product,
    raw,
  };
}
