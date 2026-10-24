import {
  isCatalogueConflictKind,
  catalogueConflictSchemas,
} from "@fl-copilot/domain";
import {
  readCatalogueConflictCurrent,
  readCatalogueConflictGroup,
  readCatalogueConflictPolicy,
} from "../products/conflict-repository";
import {
  isCommercialDecisionConflictKind,
  commercialVersionDecisionSchema,
  commercialExecutionTaskSchema,
  isCommercialConflictKind,
  commercialOfferChoiceSchema,
  commercialWeekPreparationSchema,
  commercialWeekPlanSchema,
} from "@fl-copilot/domain";
import { CommercialVersionDecisionRepository } from "../commercial/version-decision-repository";
import { CommercialExecutionRepository } from "../commercial/execution-repository";
import { readCommercialDecisionConflictPolicy } from "./commercial-decision-conflict-policy";
import { CommercialChoiceRepository } from "../commercial/offer-choice-repository";
import { CommercialPreparationRepository } from "../commercial/week-preparation-repository";
import { CommercialPlanRepository } from "../commercial/week-plan-repository";
import { readCommercialConflictPolicy } from "./commercial-conflict-policy";
import {
  needUnitSchema,
  needMembershipSchema,
  productSubstitutionSchema,
} from "@fl-copilot/domain";
import { NeedUnitRepository } from "../needs/repository";
import { NeedMembershipRepository } from "../needs/membership-repository";
import { ProductSubstitutionRepository } from "../needs/substitution-repository";
import { readNeedConflictReview } from "../needs/conflict-review";
import { z } from "zod";
import {
  storeProductEventSchema,
  storeContextSettingsSchema,
  sameStoreEventCapture,
  validateStoreConflictBasis,
} from "@fl-copilot/domain";
import { storeConflictProposalSchema } from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { ConflictRepository } from "../sync/conflict-repository";
import {
  StoreProductEventRepository,
  readStoreEventConflictReview,
} from "../needs/store-event-repository";
import {
  StoreContextRepository,
  readStoreContextConflictReview,
} from "../store/context-repository";
import { joinedProductToolDatabase } from "./product-tool-transaction";
type Content = z.infer<typeof storeConflictProposalSchema>;
export async function readStoreConflictCurrent(
  db: OutboxDatabase,
  content: Content,
  digest: (s: string) => Promise<string> = async () => {
    throw Error("STORE_CONFLICT_DIGEST_REQUIRED");
  },
) {
  if (isCatalogueConflictKind(content.input.kind))
    return readCatalogueConflictCurrent(
      db,
      content.basis.storeId,
      content.input.kind,
      content.basis.entityId,
    );
  const joined = joinedProductToolDatabase(db),
    { basis, input } = content;
  switch (input.kind) {
    case "COMMERCIAL_REFERENCE":
      return new CommercialVersionDecisionRepository(joined, digest).get(
        basis.storeId,
        basis.reference!.before.documentId,
        basis.reference!.after.documentId,
      );
    case "COMMERCIAL_EXECUTION":
      return new CommercialExecutionRepository(joined, digest).get(
        basis.storeId,
        basis.entityId,
      );
    case "COMMERCIAL_CHOICE":
      return new CommercialChoiceRepository(joined, digest).get(
        basis.storeId,
        basis.entityId,
      );
    case "COMMERCIAL_PREPARATION":
      return new CommercialPreparationRepository(joined, digest).get(
        basis.storeId,
        basis.preparation!.weekStart,
      );
    case "COMMERCIAL_PLAN":
      return new CommercialPlanRepository(joined, digest).get(
        basis.storeId,
        basis.plan!.weekStart,
      );
    case "FIELD_EVENT":
      return new StoreProductEventRepository(joined).get(
        basis.storeId,
        basis.entityId,
      );
    case "SETTINGS":
      return new StoreContextRepository(joined).get(basis.storeId);
    case "NEED":
      return new NeedUnitRepository(joined).get(basis.storeId, basis.entityId);
    case "MEMBERSHIP":
      return new NeedMembershipRepository(joined, digest).get(
        basis.storeId,
        basis.entityId,
      );
    case "SUBSTITUTION":
      return new ProductSubstitutionRepository(joined, digest).get(
        basis.storeId,
        basis.entityId,
      );
  }
}
export async function readStoreConflictReview(
  db: OutboxDatabase,
  content: Content,
  digest: (s: string) => Promise<string>,
) {
  const { input, basis } = validateStoreConflictBasis(
    content.basis.storeId,
    content.input,
    content.basis,
  );
  const entityType = {
    PRODUCT: "product",
    IDENTIFIER: "product_identifier",
    ALIAS: "product_alias",
    COMMERCIAL_REFERENCE: "commercial_version_decision",
    COMMERCIAL_EXECUTION: "commercial_execution_task",
    COMMERCIAL_CHOICE: "commercial_offer_choice",
    COMMERCIAL_PREPARATION: "commercial_week_preparation",
    COMMERCIAL_PLAN: "commercial_week_plan",
    FIELD_EVENT: "store_product_event",
    SETTINGS: "store_context_settings",
    NEED: "need_unit",
    MEMBERSHIP: "need_membership",
    SUBSTITUTION: "product_substitution",
  }[input.kind];
  const rows = isCatalogueConflictKind(input.kind)
    ? []
    : await db.getAllAsync<{ id: string }>(
        "SELECT id FROM sync_conflicts WHERE store_id=? AND entity_type=? AND entity_id=? AND status='OPEN' ORDER BY created_at DESC,id DESC LIMIT 2",
        basis.storeId,
        entityType,
        basis.entityId,
      );
  const current = await readStoreConflictCurrent(db, content, digest);
  if (
    !current ||
    current.entity.id !== basis.entityId ||
    current.entity.storeId !== basis.storeId
  )
    throw Error("STORE_CONFLICT_LOCAL_UNAVAILABLE");
  const catalogueGroup = isCatalogueConflictKind(input.kind)
    ? await readCatalogueConflictGroup(
        db,
        basis.storeId,
        input.kind,
        current.entity,
        current.remote,
      )
    : null;
  const settingsReview =
    input.kind === "SETTINGS" && rows[0]
      ? await readStoreContextConflictReview(
          db,
          basis.storeId,
          rows[0].id,
          digest,
        )
      : null;
  const eventReview =
    input.kind === "FIELD_EVENT" && rows[0]
      ? await readStoreEventConflictReview(
          db,
          basis.storeId,
          rows[0].id,
          digest,
        )
      : null;
  const needReview =
    (input.kind === "NEED" ||
      input.kind === "MEMBERSHIP" ||
      input.kind === "SUBSTITUTION") &&
    rows[0]
      ? await readNeedConflictReview(
          db,
          basis.storeId,
          input.kind,
          rows[0].id,
          digest,
        )
      : null;
  const reviewedGroup =
    catalogueGroup ??
    settingsReview?.group ??
    eventReview?.group ??
    needReview?.group;
  const conflict = reviewedGroup
    ? reviewedGroup.conflict
    : rows[0]
      ? await new ConflictRepository(db).getById(rows[0].id)
      : null;
  let status: "READY" | "BLOCKED" | "UNCHANGED" = "READY",
    reason: string | null = null;
  const block = (message: string) => {
    status = "BLOCKED";
    reason = message;
  };
  const remoteSchema = isCatalogueConflictKind(input.kind)
    ? catalogueConflictSchemas[input.kind]
    : input.kind === "COMMERCIAL_REFERENCE"
      ? commercialVersionDecisionSchema
      : input.kind === "COMMERCIAL_EXECUTION"
        ? commercialExecutionTaskSchema
        : input.kind === "COMMERCIAL_CHOICE"
          ? commercialOfferChoiceSchema
          : input.kind === "COMMERCIAL_PREPARATION"
            ? commercialWeekPreparationSchema
            : input.kind === "COMMERCIAL_PLAN"
              ? commercialWeekPlanSchema
              : input.kind === "FIELD_EVENT"
                ? storeProductEventSchema
                : input.kind === "SETTINGS"
                  ? storeContextSettingsSchema
                  : input.kind === "NEED"
                    ? needUnitSchema
                    : input.kind === "MEMBERSHIP"
                      ? needMembershipSchema
                      : productSubstitutionSchema;
  const parsed = remoteSchema.safeParse(conflict?.remotePayload);
  const remote = reviewedGroup
    ? reviewedGroup.remote
    : parsed.success
      ? parsed.data
      : null;
  const commands = await db.getAllAsync<{
    command_id: string;
    status: string;
    payload_json: string;
    expected_remote_version: number | null;
  }>(
    "SELECT command_id,status,payload_json,expected_remote_version FROM sync_outbox WHERE store_id=? AND entity_type=? AND entity_id=? AND status IN ('PENDING','SYNCING','CONFLICT','FAILED') ORDER BY local_sequence LIMIT 101",
    basis.storeId,
    entityType,
    basis.entityId,
  );
  if (!conflict) {
    if (current.syncState === "CONFLICT")
      block(
        "Le détail du conflit manque. Synchronisez avant de demander une nouvelle comparaison.",
      );
    else status = "UNCHANGED";
  } else if (reviewedGroup ? !reviewedGroup.valid : rows.length !== 1)
    block(
      reviewedGroup
        ? reviewedGroup.reason!
        : "Plusieurs conflits concernent cette donnée. Examinez-les dans Synchronisation avant de décider.",
    );
  else if (
    current.syncState !== "CONFLICT" ||
    !remote ||
    remote.storeId !== basis.storeId ||
    remote.id !== basis.entityId ||
    (!reviewedGroup && conflict.remoteVersion !== remote.version) ||
    remote.version !== basis.remoteVersion ||
    (await digest(JSON.stringify(remote))) !== basis.remoteHash
  )
    block(
      "La version synchronisée a changé ou ne peut plus être comparée. Synchronisez puis demandez un nouvel aperçu.",
    );
  else if (
    (current.remoteVersion ?? 0) > remote.version ||
    (current.remote &&
      current.remote.version >= remote.version &&
      (await digest(JSON.stringify(current.remote))) !== basis.remoteHash)
  )
    block(
      "Une version plus récente est arrivée sur cet appareil. Demandez une nouvelle comparaison.",
    );
  else if (commands.length > 100)
    block(
      "L’historique d’envoi dépasse la limite de cette comparaison. Examinez le conflit dans Synchronisation.",
    );
  else if (commands.some((c) => c.status === "SYNCING"))
    block(
      "Un envoi est en cours. Attendez sa fin avant de choisir une version.",
    );
  if (settingsReview && !settingsReview.canResolve)
    block(settingsReview.reason!);
  if (eventReview && !eventReview.ready) block(eventReview.reason!);
  const localEvent =
      input.kind === "FIELD_EVENT"
        ? storeProductEventSchema.parse(current.entity)
        : null,
    remoteEvent =
      input.kind === "FIELD_EVENT" && remote
        ? storeProductEventSchema.parse(remote)
        : null;
  const cataloguePolicy = isCatalogueConflictKind(input.kind)
    ? await readCatalogueConflictPolicy(db, input.kind, current.entity, remote)
    : null;
  if (cataloguePolicy && !cataloguePolicy.identityValid && remote)
    block(
      "L’identité pointe vers une autre fiche ou une autre origine. Examinez les fiches sans réaffectation automatique.",
    );
  if (cataloguePolicy && !cataloguePolicy.canKeep && !cataloguePolicy.canAdopt)
    block(
      cataloguePolicy.reason ??
        "Cette version ne peut pas être retenue dans ce parcours.",
    );
  if (
    cataloguePolicy &&
    "snapshot" in current &&
    current.snapshot?.operation === "DELETE" &&
    current.snapshot.version >= (remote?.version ?? 0) &&
    (!cataloguePolicy.remoteDeleted ||
      current.snapshot.version !== remote?.version)
  )
    block(
      "Une suppression plus récente a été reçue. Synchronisez avant de choisir une version.",
    );
  const needPolicy = needReview?.policy ?? null;
  if (needReview && !needReview.ready) block(needReview.reason!);
  if (needPolicy && !needPolicy.identityValid && remote)
    block(
      "L’identité du besoin ou de la relation a changé. Examinez les versions dans Synchronisation ; aucune association n’est réaffectée.",
    );
  const commercialDecisionPolicy = isCommercialDecisionConflictKind(input.kind)
    ? await readCommercialDecisionConflictPolicy(
        db,
        input.kind,
        current.entity,
        remote,
        digest,
      )
    : null;
  const commercialPolicy =
    isCommercialConflictKind(input.kind) &&
    !isCommercialDecisionConflictKind(input.kind)
      ? await readCommercialConflictPolicy(
          db,
          input.kind,
          current.entity,
          remote,
          digest,
        )
      : null;
  const commercialIdentity = commercialDecisionPolicy ?? commercialPolicy;
  if (commercialIdentity && !commercialIdentity.identityValid && remote)
    block(
      "L’identité commerciale a changé. Examinez ce conflit dans Synchronisation.",
    );
  const groupAllowsDecision =
    (!reviewedGroup || reviewedGroup.valid) &&
    (!settingsReview || settingsReview.canResolve) &&
    (!eventReview || eventReview.ready) &&
    (!needReview || needReview.ready);
  const canKeepLocal =
    groupAllowsDecision &&
    !!remote &&
    (cataloguePolicy
      ? cataloguePolicy.canKeep
      : commercialDecisionPolicy
        ? commercialDecisionPolicy.canKeep
        : commercialPolicy
          ? commercialPolicy.canKeep
          : needPolicy
            ? needPolicy.canKeep
            : eventReview
              ? eventReview.canKeepLocal
              : input.kind === "SETTINGS" ||
                (!!localEvent &&
                  !!remoteEvent &&
                  localEvent.source === "USER" &&
                  remoteEvent.source === "USER" &&
                  localEvent.status === "CLOSED" &&
                  sameStoreEventCapture(localEvent, remoteEvent)));
  const basisHash = await digest(
    JSON.stringify({
      content,
      current,
      conflict,
      commands,
      ...(cataloguePolicy
        ? {
            catalogue: cataloguePolicy.snapshots,
            conflicts: catalogueGroup?.conflicts,
          }
        : {}),
      ...(settingsReview ? { settings: settingsReview.hash } : {}),
      ...(eventReview ? { event: eventReview.hash } : {}),
      ...(needReview ? { need: needReview.hash } : {}),
      ...(commercialPolicy ? { commercial: commercialPolicy.snapshots } : {}),
      ...(commercialDecisionPolicy
        ? { commercialDecision: commercialDecisionPolicy.snapshots }
        : {}),
    }),
  );
  return {
    status: z.enum(["READY", "BLOCKED", "UNCHANGED"]).parse(status),
    reason,
    current,
    remote,
    conflict,
    canKeepLocal,
    canAdoptRemote: !groupAllowsDecision
      ? false
      : cataloguePolicy
        ? cataloguePolicy.canAdopt
        : commercialDecisionPolicy
          ? commercialDecisionPolicy.canAdopt
          : commercialPolicy
            ? commercialPolicy.canAdopt
            : needPolicy
              ? needPolicy.canAdopt
              : eventReview
                ? eventReview.canAdoptRemote
                : !!remote,
    cataloguePolicy,
    catalogueConflicts: catalogueGroup?.conflicts,
    settingsReview,
    eventReview,
    commercialPolicy,
    commercialDecisionPolicy,
    needPolicy,
    needReview,
    basisHash,
  };
}
