import { applyNeedUnit } from "../needs/repository";
import { applyStoreContext } from "../store/context-repository";
import { applyCommercialExecution } from "../commercial/execution-repository";
import {
  applyCommercialPlan,
  applyCommercialPlanRevision,
} from "../commercial/week-plan-repository";
import { applyValidatedOffer } from "../commercial/validated-offer-repository";
import { applyCommercialVersionDecision } from "../commercial/version-decision-repository";
import { applyCommercialPreparation } from "../commercial/week-preparation-repository";
import { applyCommercialChoice } from "../commercial/offer-choice-repository";
import { applyCommercialVisualReading } from "../commercial/visual-repository";
import { applyCommercialReviewEntity } from "../commercial/review-repository";
import { applyWastePublication } from "../documents/waste-receipt-publication";
import { z } from "zod";
import type { BootstrapResponse } from "@fl-copilot/sync-contracts";
import type { AtomicMutationDatabase } from "./atomic-local-mutation";
import { synchronizedTestEntitySchema } from "./sync-test-entity-schema";
import { applyProductMasterSnapshot } from "../products/apply-product-master";

const bootstrapStoreSchema = z.object({ id: z.string().uuid() });

export async function applyBootstrap(
  database: AtomicMutationDatabase,
  storeId: string,
  bootstrap: BootstrapResponse,
) {
  const store = bootstrapStoreSchema.parse(bootstrap.store);
  if (store.id !== storeId) {
    throw new Error("Bootstrap store does not match the local store.");
  }
  assertOnlySupportedEntities(bootstrap);
  const entities = bootstrap.entities.syncTestEntities.map((entity) => {
    const parsed = synchronizedTestEntitySchema.parse(entity);
    if (parsed.storeId !== storeId) {
      throw new Error("Bootstrap entity belongs to another store.");
    }
    return parsed;
  });

  await database.withExclusiveTransactionAsync(async (transaction) => {
    await applyProductMasterSnapshot(transaction, storeId, bootstrap.entities);
    for (const prep of bootstrap.entities.commercialWeekPlans ?? [])
      await applyCommercialPlan(transaction, storeId, prep);
    if (bootstrap.entities.commercialWeekPlans)
      await transaction.runAsync(
        "INSERT OR REPLACE INTO app_metadata(key,value,updated_at) VALUES(?,?,?)",
        `commercial-plans:${storeId}`,
        "1",
        bootstrap.serverTime,
      );
    for (const revision of bootstrap.entities.commercialPlanRevisions ?? [])
      await applyCommercialPlanRevision(transaction, storeId, revision);
    for (const prep of bootstrap.entities.commercialValidatedOffers ?? [])
      await applyValidatedOffer(transaction, storeId, prep);
    if (bootstrap.entities.commercialValidatedOffers)
      await transaction.runAsync(
        "INSERT OR REPLACE INTO app_metadata(key,value,updated_at) VALUES(?,?,?)",
        `commercial-validation:${storeId}`,
        "1",
        bootstrap.serverTime,
      );
    for (const prep of bootstrap.entities.commercialVersionDecisions ?? [])
      await applyCommercialVersionDecision(transaction, storeId, prep);
    if (bootstrap.entities.commercialVersionDecisions)
      await transaction.runAsync(
        "INSERT OR REPLACE INTO app_metadata(key,value,updated_at) VALUES(?,?,?)",
        `commercial-versions:${storeId}`,
        "1",
        bootstrap.serverTime,
      );
    for (const prep of bootstrap.entities.storeContextSettings ?? [])
      await applyStoreContext(transaction, storeId, prep);
    if (bootstrap.entities.storeContextSettings)
      await transaction.runAsync(
        "INSERT OR REPLACE INTO app_metadata(key,value,updated_at) VALUES(?,?,?)",
        `store-context:${storeId}`,
        "1",
        bootstrap.serverTime,
      );
    for (const prep of bootstrap.entities.needUnitCatalogue ?? [])
      await applyNeedUnit(transaction, storeId, prep);
    if (bootstrap.entities.needUnitCatalogue)
      await transaction.runAsync(
        "INSERT OR REPLACE INTO app_metadata(key,value,updated_at) VALUES(?,?,?)",
        `need-units:${storeId}`,
        "1",
        bootstrap.serverTime,
      );
    for (const prep of bootstrap.entities.commercialExecutionTasks ?? [])
      await applyCommercialExecution(transaction, storeId, prep);
    if (bootstrap.entities.commercialExecutionTasks)
      await transaction.runAsync(
        "INSERT OR REPLACE INTO app_metadata(key,value,updated_at) VALUES(?,?,?)",
        `commercial-execution:${storeId}`,
        "1",
        bootstrap.serverTime,
      );
    for (const prep of bootstrap.entities.commercialWeekPreparations ?? [])
      await applyCommercialPreparation(transaction, storeId, prep);
    if (bootstrap.entities.commercialWeekPreparations)
      await transaction.runAsync(
        "INSERT OR REPLACE INTO app_metadata(key,value,updated_at) VALUES(?,?,?)",
        `commercial-preparation:${storeId}`,
        "1",
        bootstrap.serverTime,
      );
    for (const choice of bootstrap.entities.commercialOfferChoices ?? [])
      await applyCommercialChoice(transaction, storeId, choice);
    if (bootstrap.entities.commercialOfferChoices)
      await transaction.runAsync(
        "INSERT OR REPLACE INTO app_metadata(key,value,updated_at) VALUES(?,?,?)",
        `commercial-choices:${storeId}`,
        "1",
        bootstrap.serverTime,
      );
    for (const reading of bootstrap.entities.commercialVisualReadings ?? [])
      await applyCommercialVisualReading(transaction, storeId, reading);
    if (bootstrap.entities.commercialVisualReadings)
      await transaction.runAsync(
        "INSERT OR REPLACE INTO app_metadata(key,value,updated_at) VALUES (?,?,?)",
        `commercial-visual:${storeId}`,
        "1",
        bootstrap.serverTime,
      );
    for (const page of bootstrap.entities.commercialReviewPages ?? [])
      await applyCommercialReviewEntity(
        transaction,
        storeId,
        "commercial_review_page",
        page,
      );
    for (const decision of bootstrap.entities.commercialReviewDecisions ?? [])
      await applyCommercialReviewEntity(
        transaction,
        storeId,
        "commercial_review_decision",
        decision,
      );
    if (bootstrap.entities.commercialReviewPages)
      await transaction.runAsync(
        "INSERT OR REPLACE INTO app_metadata(key,value,updated_at) VALUES (?,?,?)",
        `commercial-review:${storeId}`,
        "1",
        bootstrap.serverTime,
      );
    for (const entity of bootstrap.entities.wasteReceiptPublications ?? [])
      await applyWastePublication(transaction, storeId, entity);
    await transaction.runAsync(
      "DELETE FROM sync_test_entities WHERE store_id = ?",
      storeId,
    );
    for (const entity of entities) {
      await transaction.runAsync(
        `
          INSERT INTO sync_test_entities (
            id, store_id, label, remote_version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `,
        entity.id,
        entity.storeId,
        entity.label,
        entity.remoteVersion,
        entity.createdAt,
        entity.updatedAt,
      );
    }
    await transaction.runAsync(
      `
        INSERT INTO sync_inbox_state (
          store_id, cursor, last_successful_sync_at, protocol_version,
          bootstrap_revision
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(store_id) DO UPDATE SET
          cursor = excluded.cursor,
          last_successful_sync_at = excluded.last_successful_sync_at,
          protocol_version = excluded.protocol_version,
          bootstrap_revision = excluded.bootstrap_revision
      `,
      storeId,
      bootstrap.cursor,
      bootstrap.serverTime,
      bootstrap.protocolVersion,
      bootstrap.snapshotRevision,
    );
  });
}

function assertOnlySupportedEntities(bootstrap: BootstrapResponse) {
  const supported = new Set([
    "commercialOfferChoices",
    "commercialWeekPreparations",
    "commercialExecutionTasks",
    "storeContextSettings",
    "needUnitCatalogue",
    "commercialVersionDecisions",
    "commercialValidatedOffers",
    "commercialWeekPlans",
    "commercialPlanRevisions",
    "commercialVisualReadings",
    "commercialReviewPages",
    "commercialReviewDecisions",
    "syncTestEntities",
    "products",
    "productIdentifiers",
    "productAliases",
    "wasteReceiptPublications",
  ]);
  if (
    Object.entries(bootstrap.entities).some(
      ([name, entities]) => !supported.has(name) && entities.length > 0,
    )
  ) {
    throw new Error("Bootstrap contains unsupported entity types.");
  }
}
