import {
  serializeProductDocument,
  serializeProductIdentifierDocument,
  serializeProductAliasDocument,
  type ProductDocument,
  type ProductIdentifierDocument,
  type ProductAliasDocument,
} from "../products/product-master.js";
import {
  serializeCommercialVersionDecision,
  type VersionDecisionDocument,
} from "../commercial/version-decision-sync.js";
import {
  serializeCommercialExecution,
  type ExecutionTaskDocument,
} from "../commercial/execution-sync.js";
import {
  serializeCommercialChoice,
  type OfferChoiceDocument,
} from "../commercial/offer-choice-sync.js";
import {
  serializeCommercialPreparation,
  type PreparationDocument,
} from "../commercial/week-preparation-sync.js";
import {
  serializeCommercialPlan,
  type WeekPlanDocument,
} from "../commercial/week-plan-sync.js";
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
  physicalAllocationClient = false,
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
  const choiceRow =
    input.kind === "COMMERCIAL_CHOICE"
      ? await db
          .collection<OfferChoiceDocument>("commercialOfferChoices")
          .findOne({ _id: input.entityId!, storeId }, { maxTimeMS: 2000 })
      : null;
  const preparationRow =
    input.kind === "COMMERCIAL_PREPARATION"
      ? await db
          .collection<PreparationDocument>("commercialWeekPreparations")
          .findOne({ _id: input.entityId!, storeId }, { maxTimeMS: 2000 })
      : null;
  const planRow =
    input.kind === "COMMERCIAL_PLAN"
      ? await db
          .collection<WeekPlanDocument>("commercialWeekPlans")
          .findOne({ _id: input.entityId!, storeId }, { maxTimeMS: 2000 })
      : null;
  const referenceRow =
    input.kind === "COMMERCIAL_REFERENCE"
      ? await db
          .collection<VersionDecisionDocument>("commercialVersionDecisions")
          .findOne({ _id: input.entityId!, storeId }, { maxTimeMS: 2000 })
      : null;
  const executionRow =
    input.kind === "COMMERCIAL_EXECUTION"
      ? await db
          .collection<ExecutionTaskDocument>("commercialExecutionTasks")
          .findOne({ _id: input.entityId!, storeId }, { maxTimeMS: 2000 })
      : null;
  const reference = referenceRow
      ? serializeCommercialVersionDecision(referenceRow)
      : null,
    execution = executionRow
      ? serializeCommercialExecution(executionRow)
      : null;
  const productRow =
    input.kind === "PRODUCT"
      ? await db
          .collection<ProductDocument>("products")
          .findOne({ _id: input.entityId!, storeId }, { maxTimeMS: 2000 })
      : null;
  const identifierRow =
    input.kind === "IDENTIFIER"
      ? await db
          .collection<ProductIdentifierDocument>("productIdentifiers")
          .findOne({ _id: input.entityId!, storeId }, { maxTimeMS: 2000 })
      : null;
  const aliasRow =
    input.kind === "ALIAS"
      ? await db
          .collection<ProductAliasDocument>("productAliases")
          .findOne({ _id: input.entityId!, storeId }, { maxTimeMS: 2000 })
      : null;
  const product = productRow ? serializeProductDocument(productRow) : null,
    identifier = identifierRow
      ? serializeProductIdentifierDocument(identifierRow)
      : null,
    alias = aliasRow ? serializeProductAliasDocument(aliasRow) : null;
  const choice = choiceRow ? serializeCommercialChoice(choiceRow) : null,
    preparation = preparationRow
      ? serializeCommercialPreparation(preparationRow)
      : null,
    plan = planRow ? serializeCommercialPlan(planRow) : null;
  const need = needRow ? serializeNeedUnit(needRow) : null,
    membership = membershipRow ? serializeNeedMembership(membershipRow) : null,
    substitution = substitutionRow
      ? serializeProductSubstitution(substitutionRow)
      : null;
  const event = eventRow ? serializeStoreProductEvent(eventRow) : null,
    settings = settingsRow ? serializeStoreContext(settingsRow) : null,
    entity =
      event ??
      settings ??
      need ??
      membership ??
      substitution ??
      choice ??
      preparation ??
      plan ??
      reference ??
      execution ??
      product ??
      identifier ??
      alias;
  if (!entity) throw Error("STORE_CONFLICT_TARGET_UNAVAILABLE");
  if (
    !physicalAllocationClient &&
    (preparation?.physicalAllocation !== undefined ||
      plan?.preparation.physicalAllocation !== undefined)
  )
    throw Error("PHYSICAL_ALLOCATION_CLIENT_REQUIRED");
  if (JSON.stringify(entity).length > 96000)
    throw Error("STORE_CONFLICT_REVIEW_LIMIT");
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
    ...(choice ? { choice } : {}),
    ...(preparation ? { preparation } : {}),
    ...(plan ? { plan } : {}),
    ...(reference ? { reference } : {}),
    ...(execution ? { execution } : {}),
    ...(product ? { product } : {}),
    ...(identifier ? { identifier } : {}),
    ...(alias ? { alias } : {}),
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
              : product || identifier || alias
                ? "Comparer le référentiel produit"
                : choice || preparation || plan || reference || execution
                  ? "Comparer les versions commerciales"
                  : "Comparer le besoin ou l’association",
        factKind: "QUALITY",
        value:
          "Comparaison proposée uniquement. L’appareil vérifiera le conflit local, les deux versions et les choix métier autorisés. Aucune version n’est choisie ni modifiée ici. La présence d’un conflit sur l’appareil reste à vérifier.",
      },
    ],
  });
}
