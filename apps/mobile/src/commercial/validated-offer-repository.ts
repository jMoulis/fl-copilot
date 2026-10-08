import {
  commercialValidatedOfferSchema,
  type CommercialValidatedOffer,
} from "@fl-copilot/sync-contracts";
import {
  commercialValidatedOfferId,
  commercialOfferValidationSource,
  commercialValidatedOfferSameBusiness,
  commercialOfferValidationCurrent,
} from "@fl-copilot/commercial-core";
import { readCommercialChoices } from "./offer-choice-repository";
import { readCommercialVisualReadings } from "./visual-repository";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
export type LocalValidatedOffer = {
  entity: CommercialValidatedOffer;
  syncState: string;
  lastErrorCode: string | null;
};
export async function readValidatedOffers(
  db: OutboxDatabase,
  storeId: string,
): Promise<LocalValidatedOffer[]> {
  const rows = await db.getAllAsync<{
    payload_json: string;
    sync_state: string;
    last_error_code: string | null;
  }>(
    "SELECT v.*,(SELECT last_error_code FROM sync_outbox o WHERE o.store_id=v.store_id AND o.entity_id=v.id AND o.entity_type='commercial_validated_offer' ORDER BY local_sequence DESC LIMIT 1) AS last_error_code FROM commercial_validated_offers v WHERE v.store_id=?",
    storeId,
  );
  return rows.map((r) => ({
    entity: commercialValidatedOfferSchema.parse(JSON.parse(r.payload_json)),
    syncState: r.sync_state,
    lastErrorCode: r.last_error_code ?? null,
  }));
}
export async function applyValidatedOffer(
  db: OutboxDatabase,
  storeId: string,
  input: unknown,
) {
  const v = commercialValidatedOfferSchema.parse(input);
  if (v.storeId !== storeId) throw Error("COMMERCIAL_VALIDATION_STORE_INVALID");
  const row = await db.getFirstAsync<{ payload_json: string }>(
    "SELECT payload_json FROM commercial_validated_offers WHERE id=?",
    v.id,
  );
  if (
    row &&
    !commercialValidatedOfferSameBusiness(
      commercialValidatedOfferSchema.parse(JSON.parse(row.payload_json)),
      v,
    )
  )
    throw Error("COMMERCIAL_VALIDATION_IMMUTABLE");
  await db.runAsync(
    "INSERT INTO commercial_validated_offers(id,store_id,choice_id,choice_version,payload_json,sync_state) VALUES(?,?,?,?,?,'SYNCED') ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,sync_state='SYNCED'",
    v.id,
    storeId,
    v.choice.id,
    v.choice.version,
    JSON.stringify(v),
  );
}
export class ValidatedOfferRepository {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private digest: (s: string) => Promise<string>,
  ) {}
  async validate(
    storeId: string,
    selection: readonly { choiceId: string; choiceVersion: number }[],
    ctx: { deviceId: string; commandIds: string[]; createdAt: string },
  ) {
    if (
      !selection.length ||
      selection.length > 100 ||
      selection.length !== ctx.commandIds.length ||
      new Set(selection.map((r) => r.choiceId)).size !== selection.length
    )
      throw Error("COMMERCIAL_VALIDATION_SELECTION_INVALID");
    const ids = await Promise.all(
      selection.map((r) =>
        commercialValidatedOfferId(
          storeId,
          r.choiceId,
          r.choiceVersion,
          this.digest,
        ),
      ),
    );
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const choices = await readCommercialChoices(tx, storeId),
        previous = await readValidatedOffers(tx, storeId);
      for (const [i, ref] of selection.entries()) {
        const c = choices.find((c) => c.entity.id === ref.choiceId);
        if (
          !c ||
          c.entity.status !== "RETAINED" ||
          c.entity.version !== ref.choiceVersion ||
          ["ERROR", "CONFLICT"].includes(c.syncState)
        )
          throw Error("COMMERCIAL_VALIDATION_CHOICE_CHANGED");
        const product = await tx.getFirstAsync<{ id: string }>(
          "SELECT id FROM products WHERE id=? AND store_id=? AND status='ACTIVE' AND deleted_at IS NULL",
          c.entity.productId,
          storeId,
        );
        if (!product) throw Error("COMMERCIAL_VALIDATION_PRODUCT_INVALID");
        const pages = await readCommercialVisualReadings(
          tx,
          storeId,
          c.entity.source.sourceDocumentId,
        );
        const v = commercialValidatedOfferSchema.parse({
          id: ids[i],
          storeId,
          choice: c.entity,
          ...commercialOfferValidationSource(c.entity, pages),
          status: "VALIDATED",
          sourceReviewed: true,
          version: 1,
          createdAt: ctx.createdAt,
        });
        const old = previous.find((p) => p.entity.id === v.id);
        if (old) {
          if (
            !commercialOfferValidationCurrent(old.entity, c.entity) ||
            !commercialValidatedOfferSameBusiness(old.entity, v)
          )
            throw Error("COMMERCIAL_VALIDATION_IMMUTABLE");
          if (old.syncState !== "ERROR") continue;
          const inFlight = await tx.getFirstAsync<{ n: number }>(
            "SELECT COUNT(*) n FROM sync_outbox WHERE store_id=? AND entity_id=? AND entity_type='commercial_validated_offer' AND status='SYNCING'",
            storeId,
            v.id,
          );
          if (inFlight?.n) throw Error("COMMERCIAL_VALIDATION_SYNCING");
          await tx.runAsync(
            "UPDATE sync_outbox SET status='FAILED',last_error_code='COMMERCIAL_VALIDATION_SUPERSEDED' WHERE store_id=? AND entity_id=? AND entity_type='commercial_validated_offer' AND status='FAILED'",
            storeId,
            v.id,
          );
        }
        await tx.runAsync(
          "INSERT INTO commercial_validated_offers(id,store_id,choice_id,choice_version,payload_json,sync_state) VALUES(?,?,?,?,?,'PENDING') ON CONFLICT(id) DO UPDATE SET sync_state='PENDING'",
          v.id,
          storeId,
          c.entity.id,
          c.entity.version,
          JSON.stringify(old?.entity ?? v),
        );
        await tx.runAsync(
          "INSERT INTO commercial_offer_validation_history(action_id,offer_id,store_id,payload_json,created_at) VALUES(?,?,?,?,?)",
          ctx.commandIds[i]!,
          v.id,
          storeId,
          JSON.stringify(v),
          ctx.createdAt,
        );
        await new OutboxRepository(tx).enqueue({
          commandId: ctx.commandIds[i]!,
          deviceId: ctx.deviceId,
          storeId,
          commandType: "COMMERCIAL_OFFER_VALIDATE",
          entityType: "commercial_validated_offer",
          entityId: v.id,
          expectedRemoteVersion: null,
          payload: old?.entity ?? v,
          createdAt: ctx.createdAt,
        });
      }
    });
  }
}
