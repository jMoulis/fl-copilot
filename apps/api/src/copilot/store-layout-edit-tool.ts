import { createHash, randomUUID } from "node:crypto";
import {
  copilotLayoutEditInputSchema,
  copilotLayoutEditPreviewSchema,
} from "@fl-copilot/domain";
import { prepareStoreLayoutEdit } from "@fl-copilot/commercial-core";
/** Only a bounded comparison leaves this boundary; canonical snapshots remain private. */
export function presentStoreLayoutEdit(
  storeId: string,
  raw: unknown,
  snapshot: unknown,
  uuid: () => string = randomUUID,
) {
  const input = copilotLayoutEditInputSchema.parse(raw);
  const result = prepareStoreLayoutEdit(
    storeId,
    input,
    snapshot,
    input.action === "ADD_MOBILE"
      ? { furnitureId: uuid(), surfaceId: uuid() }
      : null,
    uuid,
  );
  const { before, after, ...visible } = result;
  void before;
  void after;
  const digest = createHash("sha256")
    .update(JSON.stringify(visible))
    .digest("hex");
  return copilotLayoutEditPreviewSchema.parse({
    ...visible,
    evidence: [
      {
        id: `store-layout-edit/${digest}`,
        sourceType: "DATA_QUALITY",
        sourceId: result.basis?.revisionId ?? storeId,
        sourceVersion: result.basis?.version ?? null,
        factKind: "QUALITY",
        label: "Modification du brouillon physique du magasin",
        value: result.message,
        detail: result.geometry
          ? `${result.changes.length} modifications ; ${result.geometry.blocking} incompatibilités et ${result.geometry.missing} points à préciser sur les emprises. La comparaison doit être confirmée localement ; aucune donnée enregistrée par cet outil.`
          : "Aucune donnée enregistrée par cet outil.",
      },
    ],
  });
}
