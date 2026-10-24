import { synchronizedCommercialVisualReadingSchema } from "@fl-copilot/sync-contracts";
import {
  commercialOfferChoiceSchema,
  commercialWeekPreparationSchema,
  commercialWeekPlanSchema,
  type CommercialOfferChoice,
  type Product,
} from "@fl-copilot/domain";
import {
  commercialChoiceId,
  commercialChoiceSameSource,
  commercialChoiceDuplicateKey,
  commercialChoiceProductUnitMatches,
  commercialWeekPreparationId,
  commercialPreparationSameIdentity,
  commercialPreparationOfferIssues,
  commercialWeekPlanId,
  commercialPlanSameIdentity,
  buildCommercialWeekPlan,
  commercialPlanNeedsReview,
} from "@fl-copilot/commercial-core";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { readCommercialChoices } from "./choice-read";
import { readWeekPlanContext } from "./week-plan-context";
async function ownedProduct(db: OutboxDatabase, storeId: string, id: string) {
  const row = await db.getFirstAsync<{
    id: string;
    store_id: string;
    label: string;
    sales_unit: Product["salesUnit"];
    status: string;
    deleted_at: string | null;
    version: number;
    sync_state: string;
    dirty: number;
  }>(
    "SELECT id,store_id,label,sales_unit,status,deleted_at,version,sync_state,dirty FROM products WHERE store_id=? AND id=?",
    storeId,
    id,
  );
  return row
    ? {
        entity: {
          id: row.id,
          storeId: row.store_id,
          label: row.label,
          salesUnit: row.sales_unit,
          status: row.status,
          deletedAt: row.deleted_at,
          version: row.version,
        },
        syncState: row.sync_state,
        dirty: row.dirty,
      }
    : null;
}
/** Complete local dependency proof. No sampled set can authorize a write. */
export async function readCommercialConflictPolicy(
  db: OutboxDatabase,
  kind: string,
  rawLocal: unknown,
  rawRemote: unknown,
  digest: (s: string) => Promise<string>,
) {
  const schema =
    kind === "COMMERCIAL_CHOICE"
      ? commercialOfferChoiceSchema
      : kind === "COMMERCIAL_PREPARATION"
        ? commercialWeekPreparationSchema
        : commercialWeekPlanSchema;
  const local = schema.parse(rawLocal),
    parsed = schema.safeParse(rawRemote),
    remote = parsed.success ? parsed.data : null;
  const result = {
    identityValid: false,
    canKeep: false,
    canAdopt: false,
    retainLocal: false,
    retainRemote: false,
    reason: null as string | null,
    snapshots: [] as unknown[],
    products: {} as Record<string, string>,
    choices: {} as Record<string, string>,
  };
  const sourceValid = async (choice: CommercialOfferChoice) => {
    const row = await db.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM commercial_visual_readings WHERE id=? AND store_id=? AND length(payload_json)<=1000000",
      choice.source.readingId,
      choice.storeId,
    );
    result.snapshots.push(row);
    const reading = row
        ? synchronizedCommercialVisualReadingSchema.parse(
            JSON.parse(row.payload_json),
          )
        : null,
      operation = reading?.reading?.operations[choice.source.operationIndex],
      item = operation?.items[choice.source.itemIndex];
    return (
      reading?.status === "READY" &&
      reading.sourceDocumentId === choice.source.sourceDocumentId &&
      reading.checksum === choice.source.checksum &&
      operation?.kind === choice.operationKind &&
      operation.label === choice.operationLabel &&
      item?.kind === "OFFER" &&
      item.label === choice.rawProductLabel
    );
  };
  if (!remote) return result;
  if (kind === "COMMERCIAL_CHOICE") {
    const l = commercialOfferChoiceSchema.parse(local),
      r = commercialOfferChoiceSchema.parse(remote);
    result.identityValid =
      commercialChoiceSameSource({ ...l, createdAt: r.createdAt }, r) &&
      l.id === (await commercialChoiceId(l.storeId, l.source, digest));
    result.retainLocal = l.status === "RETAINED" && r.status === "WITHDRAWN";
    result.retainRemote = r.status === "RETAINED" && l.status === "WITHDRAWN";
    for (const id of new Set([l.productId, r.productId])) {
      const product = await ownedProduct(db, l.storeId, id);
      result.snapshots.push(product);
      if (product?.entity.storeId === l.storeId)
        result.products[id] = product.entity.label;
    }
    const product = await ownedProduct(db, l.storeId, l.productId);
    const size = await db.getFirstAsync<{ n: number; bytes: number }>(
      "SELECT COUNT(*) n,COALESCE(SUM(length(payload_json)),0) bytes FROM commercial_offer_choices WHERE store_id=? AND source_document_id=?",
      l.storeId,
      l.source.sourceDocumentId,
    );
    const complete = !!size && size.n <= 500 && size.bytes <= 1000000;
    const rows = complete
      ? await db.getAllAsync<{ payload_json: string; sync_state: string }>(
          "SELECT payload_json,sync_state FROM commercial_offer_choices WHERE store_id=? AND source_document_id=? ORDER BY id",
          l.storeId,
          l.source.sourceDocumentId,
        )
      : [];
    result.snapshots.push(size);
    result.snapshots.push(rows);
    const duplicate = rows.some((row) => {
      const c = commercialOfferChoiceSchema.parse(JSON.parse(row.payload_json));
      return (
        c.id !== l.id &&
        c.status === "RETAINED" &&
        commercialChoiceDuplicateKey(c) === commercialChoiceDuplicateKey(l)
      );
    });
    result.canKeep =
      result.identityValid &&
      complete &&
      (await sourceValid(l)) &&
      (l.status === "WITHDRAWN" ||
        (!!product &&
          product.entity.storeId === l.storeId &&
          product.entity.status === "ACTIVE" &&
          !product.entity.deletedAt &&
          !["ERROR", "CONFLICT"].includes(product.syncState) &&
          commercialChoiceProductUnitMatches(l, product.entity.salesUnit) &&
          !duplicate));
  } else {
    const prep =
      kind === "COMMERCIAL_PREPARATION"
        ? commercialWeekPreparationSchema.parse(local)
        : commercialWeekPlanSchema.parse(local).preparation;
    result.identityValid =
      kind === "COMMERCIAL_PREPARATION"
        ? commercialPreparationSameIdentity(
            {
              ...commercialWeekPreparationSchema.parse(local),
              createdAt: remote.createdAt,
            },
            commercialWeekPreparationSchema.parse(remote),
          ) &&
          local.id ===
            (await commercialWeekPreparationId(
              local.storeId,
              prep.weekStart,
              digest,
            ))
        : commercialPlanSameIdentity(
            {
              ...commercialWeekPlanSchema.parse(local),
              createdAt: remote.createdAt,
            },
            commercialWeekPlanSchema.parse(remote),
          ) &&
          local.id ===
            (await commercialWeekPlanId(local.storeId, prep.weekStart, digest));
    const tables =
      kind === "COMMERCIAL_PLAN"
        ? [
            "commercial_offer_choices",
            "commercial_validated_offers",
            "commercial_version_decisions",
            "products",
            "commercial_visual_readings",
          ]
        : ["commercial_offer_choices", "commercial_visual_readings"];
    let bounded = true,
      totalBytes = 0;
    for (const table of tables) {
      const count = await db.getFirstAsync<{ n: number; bytes: number }>(
        `SELECT COUNT(*) n,COALESCE(SUM(${table === "products" ? "length(label)+100" : "length(payload_json)"}),0) bytes FROM ${table} WHERE store_id=?`,
        local.storeId,
      );
      totalBytes += count?.bytes ?? 0;
      if ((count?.n ?? 0) > (table === "products" ? 2000 : 500))
        bounded = false;
    }
    if (totalBytes > 1000000) bounded = false;
    if (bounded) {
      const choices = await readCommercialChoices(db, local.storeId);
      result.snapshots.push(choices);
      for (const c of choices)
        result.choices[c.entity.id] = c.entity.rawProductLabel;
      const pages = await db.getAllAsync<{ payload_json: string }>(
        "SELECT payload_json FROM commercial_visual_readings WHERE store_id=? ORDER BY id",
        local.storeId,
      );
      result.snapshots.push(pages);
      const ideasValid = prep.placements.every(
        (p) =>
          !p.sourceIdea ||
          pages.some((row) => {
            const reading = synchronizedCommercialVisualReadingSchema.parse(
                JSON.parse(row.payload_json),
              ),
              src = p.sourceIdea!;
            return (
              reading.status === "READY" &&
              reading.id === src.readingId &&
              reading.checksum === src.checksum &&
              !!reading.reading?.tgIdeas?.[src.tgIndex]
            );
          }),
      );
      result.canKeep =
        result.identityValid &&
        ideasValid &&
        !commercialPreparationOfferIssues(
          prep,
          choices.map((c) => c.entity),
        ).length &&
        !choices.some(
          (c) =>
            prep.offerRefs.some((ref) => ref.choiceId === c.entity.id) &&
            ["ERROR", "CONFLICT"].includes(c.syncState),
        );
      if (kind === "COMMERCIAL_PLAN") {
        const context = await readWeekPlanContext(db, prep);
        // Preserve raw synchronization/unit fields in the proof as well as the deterministic input.
        const productRows = await db.getAllAsync<{
          id: string;
          version: number;
          sync_state: string;
          sales_unit: string | null;
          status: string;
          deleted_at: string | null;
        }>(
          "SELECT id,version,sync_state,sales_unit,status,deleted_at FROM products WHERE store_id=? ORDER BY id",
          local.storeId,
        );
        result.snapshots.push(context, productRows);
        try {
          const l = commercialWeekPlanSchema.parse(local);
          if (commercialPlanNeedsReview(l, context).length)
            result.canKeep = false;
          await buildCommercialWeekPlan(
            {
              preparation: prep,
              version: remote.version + 1,
              createdAt: remote.createdAt,
              validatedAt: l.validatedAt,
            },
            context,
            digest,
          );
        } catch {
          result.canKeep = false;
        }
      }
    } else
      result.reason =
        "Le contexte commercial dépasse la limite de comparaison. Ouvrez le conflit dans Synchronisation.";
  }
  result.canAdopt = result.identityValid;
  if (JSON.stringify([local, remote, result.snapshots]).length > 1000000) {
    result.canKeep = false;
    result.reason =
      "La comparaison complète est trop volumineuse. Ouvrez le conflit dans Synchronisation.";
  }
  if (!result.canKeep && !result.reason)
    result.reason =
      "Votre version ne peut pas être renvoyée : vérifiez les sources, les produits, les offres et leurs validations dans Ma semaine.";
  return result;
}
