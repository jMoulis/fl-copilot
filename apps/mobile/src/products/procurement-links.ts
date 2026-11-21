import { sourceOriginalHash } from "../documents/source-original-hash";
import {
  procurementLinkIdentityKey,
  procurementLinkIdFromHash,
  procurementProductLinkSchema,
  validateProcurementLinkRevision,
  validateProcurementLinkChoice,
  procurementLinkCandidates,
  storeContextSettingsSchema,
  procurementLinkReviewSchema,
  type ProcurementLinkReview,
} from "@fl-copilot/domain";
import {
  parseMercalysReferenceIdentities,
  SheetJsSpreadsheetParser,
} from "@fl-copilot/import-core";
import { procurementPublicationSchema } from "@fl-copilot/sync-contracts";
import { ProductMasterRepository } from "./product-master-repository";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import {
  joinedMutationDatabase,
  type AtomicMutationDatabase,
} from "../sync/atomic-local-mutation";
export function procurementProductLinkId(storeId: string, genericId: string) {
  return procurementLinkIdFromHash(
    sourceOriginalHash(procurementLinkIdentityKey(storeId, genericId)),
  );
}
type Database = OutboxDatabase & AtomicMutationDatabase;
type Row = {
  store_id: string;
  generic_id: string;
  payload_json: string;
  remote_version: number | null;
  dirty: number;
};
export async function applyProcurementProductLink(
  tx: OutboxDatabase,
  storeId: string,
  raw: unknown,
  ack = false,
) {
  const link = procurementProductLinkSchema.parse(raw);
  if (
    link.storeId !== storeId ||
    link.id !== procurementProductLinkId(storeId, link.genericId)
  )
    throw Error("PROCUREMENT_LINK_SCOPE_INVALID");
  const old = await tx.getFirstAsync<Row>(
    "SELECT * FROM procurement_product_links WHERE id=?",
    link.id,
  );
  if (old && (old.store_id !== storeId || old.generic_id !== link.genericId))
    throw Error("PROCUREMENT_LINK_IDENTITY_INVALID");
  const sameGeneric = await tx.getFirstAsync<{ id: string; dirty: number }>(
    "SELECT id,dirty FROM procurement_product_links WHERE store_id=? AND generic_id=?",
    storeId,
    link.genericId,
  );
  if (sameGeneric && sameGeneric.id !== link.id) {
    throw Error("PROCUREMENT_LINK_IDENTITY_CONFLICT");
  }
  const previous = old
    ? procurementProductLinkSchema.parse(JSON.parse(old.payload_json))
    : null;
  if (
    previous &&
    !old!.dirty &&
    previous.version === link.version &&
    JSON.stringify(previous) !== JSON.stringify(link)
  )
    throw Error("PROCUREMENT_LINK_REVISION_CHANGED");
  if (previous && (previous.version > link.version || (old!.dirty && !ack))) {
    await tx.runAsync(
      "UPDATE procurement_product_links SET remote_payload_json=CASE WHEN COALESCE(remote_version,0)<=? THEN ? ELSE remote_payload_json END,remote_version=MAX(COALESCE(remote_version,0),?) WHERE id=? AND store_id=?",
      link.version,
      JSON.stringify(link),
      link.version,
      link.id,
      storeId,
    );
    return;
  }
  await tx.runAsync(
    `INSERT INTO procurement_product_links(id,store_id,generic_id,payload_json,remote_payload_json,remote_version,sync_state,dirty)
    VALUES(?,?,?,?,?,?,'SYNCED',0) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,remote_payload_json=excluded.remote_payload_json,remote_version=excluded.remote_version,sync_state='SYNCED',dirty=0`,
    link.id,
    storeId,
    link.genericId,
    JSON.stringify(link),
    JSON.stringify(link),
    link.version,
  );
}
export async function applyProcurementLinkReview(
  tx: OutboxDatabase,
  storeId: string,
  raw: unknown,
  ack = false,
) {
  const review = procurementLinkReviewSchema.parse(raw);
  if (review.storeId !== storeId) throw Error("PROCUREMENT_LINK_SCOPE_INVALID");
  const old = await tx.getFirstAsync<{
    store_id: string;
    payload_json: string;
  }>(
    "SELECT store_id,payload_json FROM procurement_link_reviews WHERE id=?",
    review.id,
  );
  if (
    old &&
    (old.store_id !== storeId || old.payload_json !== JSON.stringify(review))
  )
    throw Error("PROCUREMENT_REVIEW_IMMUTABLE");
  for (const d of review.decisions)
    await applyProcurementProductLink(tx, storeId, d.link, ack);
  await tx.runAsync(
    "INSERT INTO procurement_link_reviews(id,store_id,actor_id,payload_json,sync_state,dirty) VALUES(?,?,?,?,'SYNCED',0) ON CONFLICT(id) DO UPDATE SET sync_state='SYNCED',dirty=0",
    review.id,
    storeId,
    review.actorId,
    JSON.stringify(review),
  );
}
export class ProcurementProductLinkRepository {
  constructor(
    private db: Database,
    private originals: {
      read(uri: string): Promise<Uint8Array>;
      sha256(bytes: Uint8Array): Promise<string>;
    },
  ) {}
  async preview(
    storeId: string,
    catalogueSnapshotId: string,
    referenceDocumentId: string,
  ) {
    const snapshot = await this.db.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM procurement_catalogue_snapshots WHERE id=? AND store_id=?",
      catalogueSnapshotId,
      storeId,
    );
    const source = await this.db.getFirstAsync<{
      checksum: string;
      local_file_uri: string;
      source_type: string;
    }>(
      "SELECT checksum,local_file_uri,source_type FROM source_documents WHERE id=? AND store_id=? AND deleted_at IS NULL",
      referenceDocumentId,
      storeId,
    );
    if (
      !snapshot ||
      !source?.local_file_uri ||
      source.source_type !== "MERCALYS_PURCHASE_PRICES"
    )
      throw Error("PROCUREMENT_LINK_SOURCE_REQUIRED");
    const p = procurementPublicationSchema.parse(
      JSON.parse(snapshot.payload_json),
    );
    const bytes = await this.originals.read(source.local_file_uri);
    if ((await this.originals.sha256(bytes)) !== source.checksum)
      throw Error("PROCUREMENT_LINK_SOURCE_CHANGED");
    const facts = parseMercalysReferenceIdentities(
      new SheetJsSpreadsheetParser().parse(bytes),
    );
    const config = await this.db.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM store_context_settings WHERE store_id=?",
      storeId,
    );
    const pdv = config
      ? storeContextSettingsSchema.parse(JSON.parse(config.payload_json))
          .pdvCode
      : null;
    if (
      !pdv ||
      BigInt(pdv) !== BigInt(facts.storeCode) ||
      BigInt(pdv) !== BigInt(p.catalogue.pdv)
    )
      throw Error("PROCUREMENT_LINK_PDV_MISMATCH");
    const catalog = await readCatalog(this.db, storeId);
    return {
      snapshot: p,
      facts,
      referenceDocumentId,
      referenceChecksum: source.checksum,
      rows: procurementLinkCandidates(
        p.catalogue.offers,
        facts.references,
        catalog,
        storeId,
      ),
    };
  }
  async list(storeId: string) {
    return (
      await this.db.getAllAsync<Row>(
        "SELECT * FROM procurement_product_links WHERE store_id=? ORDER BY generic_id",
        storeId,
      )
    ).map((r) => ({
      entity: procurementProductLinkSchema.parse(JSON.parse(r.payload_json)),
      syncState: (r as Row & { sync_state: string }).sync_state,
    }));
  }
  async confirmBatch(
    raw: readonly unknown[],
    ctx: {
      reviewId: string;
      commandId: string;
      deviceId: string;
      actorId: string;
      storeId: string;
      createdAt: string;
      assertCurrentScope(): void;
    },
  ) {
    const links = raw.map((v) => procurementProductLinkSchema.parse(v));
    if (
      links.some(
        (l) =>
          l.storeId !== ctx.storeId ||
          l.updatedBy !== ctx.actorId ||
          l.id !== procurementProductLinkId(l.storeId, l.genericId),
      )
    )
      throw Error("PROCUREMENT_LINK_ACTOR_INVALID");
    ctx.assertCurrentScope();
    const prior = await this.list(ctx.storeId);
    const changed = links.filter(
      (link) =>
        JSON.stringify(prior.find((p) => p.entity.id === link.id)?.entity) !==
        JSON.stringify(link),
    );
    if (!changed.length) return null;
    const proofs = new Map<
      string,
      Awaited<ReturnType<ProcurementProductLinkRepository["preview"]>>
    >();
    for (const link of changed.filter((l) => l.status === "ACTIVE")) {
      const key =
        link.basis.catalogueSnapshotId + ":" + link.basis.referenceDocumentId;
      if (!proofs.has(key))
        proofs.set(
          key,
          await this.preview(
            link.storeId,
            link.basis.catalogueSnapshotId,
            link.basis.referenceDocumentId,
          ),
        );
    }
    let review: ProcurementLinkReview | undefined;
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      ctx.assertCurrentScope();
      const catalog = await readCatalog(
        joinedMutationDatabase(tx),
        ctx.storeId,
      );
      const decisions: ProcurementLinkReview["decisions"] = [];
      for (const link of changed) {
        const old = await tx.getFirstAsync<Row>(
          "SELECT * FROM procurement_product_links WHERE id=?",
          link.id,
        );
        const previous = old
          ? procurementProductLinkSchema.parse(JSON.parse(old.payload_json))
          : null;
        if (previous && JSON.stringify(previous) === JSON.stringify(link))
          continue;
        if (old && old.store_id !== ctx.storeId)
          throw Error("PROCUREMENT_LINK_SCOPE_INVALID");
        validateProcurementLinkRevision(link, previous);
        if (link.status === "ACTIVE") {
          const proof = proofs.get(
            link.basis.catalogueSnapshotId +
              ":" +
              link.basis.referenceDocumentId,
          )!;
          if (
            proof.snapshot.checksum !== link.basis.catalogueChecksum ||
            proof.referenceChecksum !== link.basis.referenceChecksum
          )
            throw Error("PROCUREMENT_LINK_SOURCE_CHANGED");
          const current = await tx.getFirstAsync<{ checksum: string }>(
            "SELECT checksum FROM source_documents WHERE id=? AND store_id=? AND deleted_at IS NULL",
            link.basis.referenceDocumentId,
            ctx.storeId,
          );
          if (current?.checksum !== proof.referenceChecksum)
            throw Error("PROCUREMENT_LINK_SOURCE_CHANGED");
          validateProcurementLinkChoice(
            link,
            proof.snapshot.catalogue.offers,
            proof.facts.references,
            catalog,
            proof.rows,
          );
        }
        decisions.push({ link, expectedVersion: previous?.version ?? null });
      }
      if (!decisions.length) return;
      review = procurementLinkReviewSchema.parse({
        id: ctx.reviewId,
        storeId: ctx.storeId,
        actorId: ctx.actorId,
        version: 1,
        createdAt: ctx.createdAt,
        decisions,
      });
      for (const { link } of decisions)
        await tx.runAsync(
          "INSERT INTO procurement_product_links(id,store_id,generic_id,payload_json,sync_state,dirty) VALUES(?,?,?,?,'PENDING',1) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,sync_state='PENDING',dirty=1",
          link.id,
          link.storeId,
          link.genericId,
          JSON.stringify(link),
        );
      await tx.runAsync(
        "INSERT INTO procurement_link_reviews(id,store_id,actor_id,payload_json,sync_state,dirty) VALUES(?,?,?,?,'PENDING',1)",
        review.id,
        review.storeId,
        review.actorId,
        JSON.stringify(review),
      );
      await new OutboxRepository(tx).enqueue({
        commandId: ctx.commandId,
        deviceId: ctx.deviceId,
        storeId: ctx.storeId,
        entityId: review.id,
        entityType: "procurement_link_review",
        commandType: "PROCUREMENT_LINK_REVIEW_PUBLISH",
        expectedRemoteVersion: null,
        payload: review,
        createdAt: ctx.createdAt,
      });
      ctx.assertCurrentScope();
    });
    return review ?? null;
  }
}
async function readCatalog(db: Database, storeId: string) {
  const repo = new ProductMasterRepository(db);
  const [products, identifiers] = await Promise.all([
    repo.listProducts(storeId),
    repo.listIdentifiersByStore(storeId),
  ]);
  return {
    products: products
      .filter((r) => !["CONFLICT", "ERROR"].includes(r.syncState))
      .map((r) => r.entity),
    identifiers: identifiers
      .filter((r) => !["CONFLICT", "ERROR"].includes(r.syncState))
      .map((r) => r.entity),
    aliases: [],
  };
}

export async function markProcurementReviewState(
  tx: OutboxDatabase,
  storeId: string,
  id: string,
  state: "ERROR" | "CONFLICT",
) {
  const row = await tx.getFirstAsync<{ payload_json: string }>(
    "SELECT payload_json FROM procurement_link_reviews WHERE id=? AND store_id=?",
    id,
    storeId,
  );
  if (!row) return;
  const review = procurementLinkReviewSchema.parse(
    JSON.parse(row.payload_json),
  );
  await tx.runAsync(
    "UPDATE procurement_link_reviews SET sync_state=? WHERE id=? AND store_id=?",
    state,
    id,
    storeId,
  );
  for (const { link } of review.decisions)
    await tx.runAsync(
      "UPDATE procurement_product_links SET sync_state=? WHERE id=? AND store_id=? AND json_extract(payload_json,'$.version')=?",
      state,
      link.id,
      storeId,
      link.version,
    );
}
