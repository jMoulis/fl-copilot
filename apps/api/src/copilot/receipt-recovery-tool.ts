import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import {
  receiptRecoveryInputSchema,
  receiptRecoveryPreviewSchema,
} from "@fl-copilot/domain";
import { readReceiptSource } from "./receipt-publication-tool.js";
/** No retries, extraction, source changes or business decisions occur remotely. */
export async function previewReceiptRecovery(
  db: Db,
  storeId: string,
  raw: unknown,
) {
  const input = receiptRecoveryInputSchema.parse(raw),
    source = await readReceiptSource(db, storeId, input.sourceDocumentId);
  const publication = await db
    .collection("wasteReceiptPublications")
    .findOne(
      { storeId, "publication.source.id": input.sourceDocumentId },
      { projection: { _id: 1 }, maxTimeMS: 2000 },
    );
  const status = publication ? "READ_ONLY" : "REVIEW_LOCAL";
  const hash = createHash("sha256")
    .update(JSON.stringify([input, source, status]))
    .digest("hex");
  return receiptRecoveryPreviewSchema.parse({
    input,
    source,
    status,
    evidence: [
      {
        id: `receipt-recovery/${hash}`,
        sourceType: "DATA_QUALITY",
        sourceId: input.sourceDocumentId,
        sourceVersion: null,
        label: "Reprise du ticket de casse",
        factKind: "QUALITY",
        value: publication
          ? "Ce ticket est publié. Aucune reprise ni décision de doublon préparée."
          : "Aperçu uniquement : l’appareil vérifiera l’état actuel, les tâches et le doublon éventuel avant confirmation. Une relance peut déclencher une analyse IA ; elle ne garantit pas la disponibilité du service et ne publie aucune casse.",
      },
    ],
  });
}
