import {
  commercialChoiceFixture,
  testChoiceDigest,
} from "./test-commercial-choice-fixtures";
import { commercialVersionDecisionId } from "../packages/commercial-core/src/index";
import type { CommercialVersionDecision } from "../packages/domain/src/index";
export async function commercialVersionFixture() {
  const f = await commercialChoiceFixture(),
    g = await commercialChoiceFixture({ storeId: f.storeId });
  g.reading.checksum = "sha256:corrected";
  g.reading.reading!.operations[0]!.items[0]!.fields.find(
    (f) => f.name === "sellingPrice",
  )!.rawValue = "2,50€";
  const source = (x: typeof f) => ({
    documentId: x.sourceDocumentId,
    checksum: x.reading.checksum,
    readingIds: [x.reading.id],
  });
  const decision: CommercialVersionDecision = {
    id: await commercialVersionDecisionId(
      f.storeId,
      f.sourceDocumentId,
      g.sourceDocumentId,
      testChoiceDigest,
    ),
    storeId: f.storeId,
    before: source(f),
    after: source(g),
    preference: "KEEP_PREVIOUS",
    comparisonReviewed: true,
    note: "Prix à examiner",
    version: 1,
    createdAt: f.choice.createdAt,
    updatedAt: f.choice.updatedAt,
  };
  return { f, g, decision };
}
