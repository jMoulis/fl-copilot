import { serializeNeedUnit, type NeedUnitDocument } from "../need-unit-sync.js";
import {
  serializeNeedMembership,
  type NeedMembershipDocument,
} from "../need-membership-sync.js";
import {
  serializeProductSubstitution,
  type ProductSubstitutionDocument,
} from "../product-substitution-sync.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "mongodb";
import {
  storeConflictInputSchema,
  storeConflictPreviewSchema,
  copilotVisibleStoreSettingsSchema,
  validateStoreConflictBasis,
} from "@fl-copilot/domain";
import {
  serializeStoreProductEvent,
  type StoreProductEventDocument,
} from "../store-product-event-sync.js";
import {
  serializeStoreContext,
  type StoreContextDocument,
} from "../store-context-sync.js";
/** Prepare only: synchronization conflicts and decisions remain on the device. */
export async function previewStoreConflict(
  db: Db,
  storeId: string,
  raw: unknown,
) {
  z.uuid().parse(storeId);
  const input = storeConflictInputSchema.parse(raw);
  const eventRow =
    input.kind === "FIELD_EVENT"
      ? await db
          .collection<StoreProductEventDocument>("storeProductEvents")
          .findOne({ _id: input.entityId!, storeId }, { maxTimeMS: 2000 })
      : null;
  const settingsRow =
    input.kind === "SETTINGS"
      ? await db
          .collection<StoreContextDocument>("storeContextSettings")
          .findOne({ _id: storeId, storeId }, { maxTimeMS: 2000 })
      : null;
  const needRow =
    input.kind === "NEED"
      ? await db
          .collection<NeedUnitDocument>("needUnits")
          .findOne({ _id: input.entityId!, storeId }, { maxTimeMS: 2000 })
      : null;
  const membershipRow =
    input.kind === "MEMBERSHIP"
      ? await db
          .collection<NeedMembershipDocument>("needMemberships")
          .findOne({ _id: input.entityId!, storeId }, { maxTimeMS: 2000 })
      : null;
  const substitutionRow =
    input.kind === "SUBSTITUTION"
      ? await db
          .collection<ProductSubstitutionDocument>("productSubstitutions")
          .findOne({ _id: input.entityId!, storeId }, { maxTimeMS: 2000 })
      : null;
  const need = needRow ? serializeNeedUnit(needRow) : null,
    membership = membershipRow ? serializeNeedMembership(membershipRow) : null,
    substitution = substitutionRow
      ? serializeProductSubstitution(substitutionRow)
      : null;
  const event = eventRow ? serializeStoreProductEvent(eventRow) : null,
    settings = settingsRow ? serializeStoreContext(settingsRow) : null,
    entity = event ?? settings ?? need ?? membership ?? substitution;
  if (!entity) throw Error("STORE_CONFLICT_TARGET_UNAVAILABLE");
  const visible = settings
    ? (({ position, ...rest }) => {
        void position;
        return copilotVisibleStoreSettingsSchema.parse(rest);
      })(settings)
    : null;
  const { basis } = validateStoreConflictBasis(storeId, input, {
    storeId,
    entityId: entity.id,
    remoteVersion: entity.version,
    remoteHash: createHash("sha256")
      .update(JSON.stringify(entity))
      .digest("hex"),
    event,
    settings: visible,
    ...(need ? { need } : {}),
    ...(membership ? { membership } : {}),
    ...(substitution ? { substitution } : {}),
  });
  return storeConflictPreviewSchema.parse({
    input,
    basis,
    evidence: [
      {
        id: `store-conflict/${basis.remoteHash}`,
        sourceType: "DATA_QUALITY",
        sourceId: entity.id,
        sourceVersion: entity.version,
        label:
          input.kind === "SETTINGS"
            ? "Comparer les réglages du magasin"
            : input.kind === "FIELD_EVENT"
              ? "Comparer un signalement magasin"
              : "Comparer le besoin ou l’association",
        factKind: "QUALITY",
        value:
          "Comparaison proposée uniquement. L’appareil vérifiera le conflit local, les deux versions et les choix métier autorisés. Aucune version n’est choisie ni modifiée ici. La présence d’un conflit sur l’appareil reste à vérifier.",
      },
    ],
  });
}
