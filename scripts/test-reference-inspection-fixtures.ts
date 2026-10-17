import { referencePreviewFixture } from "./test-reference-preview-fixtures";
import { validateReferenceInspectionResult } from "../packages/domain/src/index";
export async function referenceInspectionFixture() {
  const f = await referencePreviewFixture(true);
  const input = {
    firstDocumentId: f.input.beforeDocumentId,
    secondDocumentId: f.input.afterDocumentId,
  };
  const result = validateReferenceInspectionResult(f.f.storeId, input, {
    storeId: f.f.storeId,
    input,
    status: "RECORDED",
    first: {
      documentId: input.firstDocumentId,
      filename: f.basis.beforeFilename,
      checksum: f.decision.before.checksum,
    },
    second: {
      documentId: input.secondDocumentId,
      filename: f.basis.afterFilename,
      checksum: f.decision.after.checksum,
    },
    decision: f.decision,
    reviewStatus: "MATCHING_SNAPSHOTS",
    evidence: [
      {
        id: "reference-inspect/test",
        sourceType: "DATA_QUALITY",
        sourceId: input.firstDocumentId,
        sourceVersion: f.decision.version,
        label: "Référence enregistrée",
        value: "Ancien PDF conservé",
        factKind: "QUALITY",
      },
    ],
  });
  return { ...f, inspectInput: input, result };
}
