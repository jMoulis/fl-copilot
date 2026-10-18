import {
  isNeedConflictKind,
  needUnitSchema,
  needMembershipSchema,
  productSubstitutionSchema,
} from "@fl-copilot/domain";
import { NeedUnitRepository } from "../needs/repository";
import { NeedMembershipRepository } from "../needs/membership-repository";
import { ProductSubstitutionRepository } from "../needs/substitution-repository";
import { readNeedConflictPolicy } from "./need-conflict-policy";
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
import { StoreProductEventRepository } from "../needs/store-event-repository";
import { StoreContextRepository } from "../store/context-repository";
import { joinedProductToolDatabase } from "./product-tool-transaction";
type Content = z.infer<typeof storeConflictProposalSchema>;
export async function readStoreConflictCurrent(
  db: OutboxDatabase,
  content: Content,
  digest: (s: string) => Promise<string> = async () => {
    throw Error("STORE_CONFLICT_DIGEST_REQUIRED");
  },
) {
  const joined = joinedProductToolDatabase(db),
    { basis, input } = content;
  switch (input.kind) {
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
    FIELD_EVENT: "store_product_event",
    SETTINGS: "store_context_settings",
    NEED: "need_unit",
    MEMBERSHIP: "need_membership",
    SUBSTITUTION: "product_substitution",
  }[input.kind];
  const rows = await db.getAllAsync<{ id: string }>(
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
  const conflict = rows[0]
    ? await new ConflictRepository(db).getById(rows[0].id)
    : null;
  let status: "READY" | "BLOCKED" | "UNCHANGED" = "READY",
    reason: string | null = null;
  const block = (message: string) => {
    status = "BLOCKED";
    reason = message;
  };
  const remoteSchema =
    input.kind === "FIELD_EVENT"
      ? storeProductEventSchema
      : input.kind === "SETTINGS"
        ? storeContextSettingsSchema
        : input.kind === "NEED"
          ? needUnitSchema
          : input.kind === "MEMBERSHIP"
            ? needMembershipSchema
            : productSubstitutionSchema;
  const parsed = remoteSchema.safeParse(conflict?.remotePayload);
  const remote = parsed.success ? parsed.data : null;
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
  } else if (rows.length !== 1)
    block(
      "Plusieurs conflits concernent cette donnée. Examinez-les dans Synchronisation avant de décider.",
    );
  else if (
    current.syncState !== "CONFLICT" ||
    !remote ||
    remote.storeId !== basis.storeId ||
    remote.id !== basis.entityId ||
    conflict.remoteVersion !== remote.version ||
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
  const localEvent =
      input.kind === "FIELD_EVENT"
        ? storeProductEventSchema.parse(current.entity)
        : null,
    remoteEvent =
      input.kind === "FIELD_EVENT" && remote
        ? storeProductEventSchema.parse(remote)
        : null;
  const needPolicy = isNeedConflictKind(input.kind)
    ? await readNeedConflictPolicy(
        db,
        input.kind,
        current.entity,
        remote,
        digest,
      )
    : null;
  if (needPolicy && !needPolicy.identityValid && remote)
    block(
      "L’identité du besoin ou de la relation a changé. Examinez les versions dans Synchronisation ; aucune association n’est réaffectée.",
    );
  const canKeepLocal =
    !!remote &&
    (needPolicy
      ? needPolicy.canKeep
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
      ...(needPolicy ? { parents: needPolicy.parentSnapshots } : {}),
    }),
  );
  return {
    status: z.enum(["READY", "BLOCKED", "UNCHANGED"]).parse(status),
    reason,
    current,
    remote,
    conflict,
    canKeepLocal,
    canAdoptRemote: needPolicy ? needPolicy.canAdopt : !!remote,
    needPolicy,
    basisHash,
  };
}
