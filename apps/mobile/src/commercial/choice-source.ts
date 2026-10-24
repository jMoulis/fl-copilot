import {
  isCommercialOriginalSource,
  type CommercialOfferChoice,
} from "@fl-copilot/domain";
import {
  sourceOriginalManifestSchema,
  synchronizedCommercialVisualReadingSchema,
} from "@fl-copilot/sync-contracts";
import {
  projectCommercialOriginalOffer,
  projectCommercialSourceOffer,
} from "@fl-copilot/commercial-core";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { commercialChoiceId } from "@fl-copilot/commercial-core";
import type { LocalCommercialChoice } from "./choice-read";

/** One bounded local source read, shared by manual/Copilot saves, validation and conflict review. */
export async function readCommercialChoiceSource(
  db: OutboxDatabase,
  choice: Pick<
    CommercialOfferChoice,
    | "storeId"
    | "source"
    | "operationKind"
    | "operationLabel"
    | "rawProductLabel"
  >,
) {
  const source = choice.source;
  if (isCommercialOriginalSource(source)) {
    const row = await db.getFirstAsync<{
      id: string;
      store_id: string;
      source_type: string;
      checksum: string | null;
      deleted_at: string | null;
    }>(
      "SELECT id,store_id,source_type,checksum,deleted_at FROM source_documents WHERE id=?",
      source.sourceDocumentId,
    );
    const snapshots: unknown[] = [row];
    let valid = row
      ? row.store_id === choice.storeId &&
        row.source_type === "WEEKLY_COMMERCIAL_PDF" &&
        row.checksum === source.checksum &&
        !row.deleted_at
      : false;
    if (!row) {
      // Another device can retain the authenticated original manifest without a capture row.
      const cached = await db.getFirstAsync<{ manifest_json: string }>(
        "SELECT manifest_json FROM source_original_manifests WHERE store_id=? AND source_document_id=? AND length(manifest_json)<=16000 ORDER BY owner_id LIMIT 1",
        choice.storeId,
        source.sourceDocumentId,
      );
      snapshots.push(cached);
      try {
        const manifest = sourceOriginalManifestSchema.parse(
          JSON.parse(cached?.manifest_json ?? "null"),
        );
        valid =
          manifest.storeId === choice.storeId &&
          manifest.sourceDocumentId === source.sourceDocumentId &&
          manifest.sourceType === "WEEKLY_COMMERCIAL_PDF" &&
          manifest.mimeType === "application/pdf" &&
          manifest.checksum === source.checksum &&
          manifest.access === "STORE";
      } catch {
        valid = false;
      }
    }
    return {
      snapshots,
      offer: valid
        ? projectCommercialOriginalOffer({
            source,
            operationKind: choice.operationKind,
            operationLabel: choice.operationLabel,
            rawProductLabel: choice.rawProductLabel,
          })
        : null,
    };
  }
  const row = await db.getFirstAsync<{ payload_json: string }>(
    "SELECT payload_json FROM commercial_visual_readings WHERE id=? AND store_id=? AND length(payload_json)<=1000000",
    source.readingId,
    choice.storeId,
  );
  let offer: ReturnType<typeof projectCommercialSourceOffer> | null = null;
  try {
    const reading = synchronizedCommercialVisualReadingSchema.parse(
      JSON.parse(row?.payload_json ?? "null"),
    );
    if (
      reading.id === source.readingId &&
      reading.storeId === choice.storeId &&
      reading.sourceDocumentId === source.sourceDocumentId &&
      reading.checksum === source.checksum &&
      reading.status === "READY"
    ) {
      const projected = projectCommercialSourceOffer(
        reading,
        source.operationIndex,
        source.itemIndex,
      );
      if (
        projected.operationKind === choice.operationKind &&
        projected.operationLabel === choice.operationLabel &&
        projected.rawProductLabel === choice.rawProductLabel
      )
        offer = projected;
    }
  } catch {
    /* A missing, damaged or mismatched extraction is not source authority. */
  }
  return { snapshots: [row], offer };
}
/** Existing editor, resolved by extracted coordinates or an actual retained choice ID. */
export async function readCommercialOfferEditorSource(
  db: OutboxDatabase,
  storeId: string,
  coordinates: {
    id: string;
    choiceId?: string;
    operationIndex: number;
    itemIndex: number;
  },
  getChoice: (id: string) => Promise<LocalCommercialChoice | null>,
  digest: (text: string) => Promise<string>,
) {
  if (coordinates.choiceId) {
    if (coordinates.choiceId !== coordinates.id)
      throw Error("COMMERCIAL_CHOICE_SOURCE_INVALID");
    const saved = await getChoice(coordinates.choiceId);
    if (!saved || saved.entity.storeId !== storeId)
      throw Error("COMMERCIAL_CHOICE_SOURCE_INVALID");
    const source = await readCommercialChoiceSource(db, saved.entity);
    const offer =
      source.offer ??
      (isCommercialOriginalSource(saved.entity.source)
        ? projectCommercialOriginalOffer({
            source: saved.entity.source,
            operationKind: saved.entity.operationKind,
            operationLabel: saved.entity.operationLabel,
            rawProductLabel: saved.entity.rawProductLabel,
          })
        : null);
    if (!offer) throw Error("COMMERCIAL_CHOICE_SOURCE_INVALID");
    return {
      saved,
      offer,
      choiceId: saved.entity.id,
      sourceAvailable: source.offer !== null,
    };
  }
  if (
    !Number.isInteger(coordinates.operationIndex) ||
    coordinates.operationIndex < 0 ||
    !Number.isInteger(coordinates.itemIndex) ||
    coordinates.itemIndex < 0
  )
    throw Error("COMMERCIAL_CHOICE_SOURCE_INVALID");
  const row = await db.getFirstAsync<{ payload_json: string }>(
    "SELECT payload_json FROM commercial_visual_readings WHERE id=? AND store_id=?",
    coordinates.id,
    storeId,
  );
  const reading = synchronizedCommercialVisualReadingSchema.parse(
    JSON.parse(row?.payload_json ?? "null"),
  );
  if (
    reading.id !== coordinates.id ||
    reading.storeId !== storeId ||
    reading.status !== "READY"
  )
    throw Error("COMMERCIAL_CHOICE_SOURCE_INVALID");
  const offer = projectCommercialSourceOffer(
    reading,
    coordinates.operationIndex,
    coordinates.itemIndex,
  );
  const choiceId = await commercialChoiceId(storeId, offer.source, digest);
  return {
    saved: await getChoice(choiceId),
    offer,
    choiceId,
    sourceAvailable: true,
  };
}
