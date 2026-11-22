import { z } from "zod";
import {
  buildProcurementEnrichment,
  procurementLinkCandidates,
  referenceProductOwner,
  procurementProductLinkSchema,
  storeContextSettingsSchema,
  type ProcurementCatalogueDraft,
  type ProcurementProductLink,
} from "@fl-copilot/domain";
import {
  parseMercalysReferenceIdentities,
  SheetJsSpreadsheetParser,
} from "@fl-copilot/import-core";
import { procurementPublicationSchema } from "@fl-copilot/sync-contracts";
import { ProductMasterRepository } from "../products/product-master-repository";
import {
  ProcurementProductLinkRepository,
  procurementProductLinkId,
} from "../products/procurement-links";
import { ProcurementPublicationRepository } from "./procurement-publication";
import { ProcurementCatalogueDraftRepository } from "./procurement-catalogue-draft";
import {
  joinedMutationDatabase,
  type AtomicMutationDatabase,
} from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { sourceOriginalHash } from "./source-original-hash";
import {
  loadProductEditorSnapshot,
  saveProductEditorLocally,
  productSnapshotToDraft,
} from "../products/product-editor-service";

type Database = OutboxDatabase & AtomicMutationDatabase;
export type ProcurementOriginals = {
  read(uri: string, maximumBytes?: number): Promise<Uint8Array>;
  sha256(bytes: Uint8Array): Promise<string>;
};
export type CatalogueActionContext = {
  storeId: string;
  actorId: string;
  deviceId: string;
  now(): string;
  id(): string;
  assertCurrentScope(): void;
};
export const manualProcurementChoiceSchema = z.strictObject({
  genericId: z.string().min(1).max(200),
  sourceIndex: z.number().int().nonnegative(),
  productId: z.uuid(),
  reason: z.string().trim().min(1).max(500),
});
export type ManualProcurementChoice = z.infer<
  typeof manualProcurementChoiceSchema
>;
export const procurementReviewDraftSchema = z
  .strictObject({
    signature: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    choices: z.record(z.string(), manualProcurementChoiceSchema),
  })
  .refine((v) =>
    Object.entries(v.choices).every(([k, c]) => k === c.genericId),
  );

export async function listProcurementImports(
  db: OutboxDatabase,
  storeId: string,
  ownerId: string,
) {
  const rows = await db.getAllAsync<{
    checksum: string;
    original_filename: string;
    source_generated_at: string | null;
    imported_at: string;
  }>(
    "SELECT d.checksum,s.original_filename,s.source_generated_at,d.imported_at FROM procurement_catalogue_drafts d JOIN source_documents s ON s.id=d.source_document_id AND s.store_id=d.store_id WHERE d.store_id=? AND d.owner_id=? AND s.deleted_at IS NULL ORDER BY d.imported_at DESC,d.id DESC",
    storeId,
    ownerId,
  );
  return rows;
}
export async function listArticleReferences(
  db: OutboxDatabase,
  storeId: string,
) {
  return db.getAllAsync<{
    id: string;
    original_filename: string;
    source_generated_at: string | null;
    created_at: string;
    local_file_uri: string | null;
  }>(
    "SELECT id,original_filename,source_generated_at,created_at,local_file_uri FROM source_documents WHERE store_id=? AND source_type='MERCALYS_PURCHASE_PRICES' AND parser_version='mercalys-article-reference.v1' AND deleted_at IS NULL AND local_processing_status='PUBLISHED' ORDER BY created_at DESC,id DESC",
    storeId,
  );
}
async function catalogue(db: Database, storeId: string) {
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
export async function procurementPreview(
  db: Database,
  draft: ProcurementCatalogueDraft,
  referenceId: string | null,
  originals: ProcurementOriginals,
) {
  const config = await db.getFirstAsync<{ payload_json: string }>(
    "SELECT payload_json FROM store_context_settings WHERE store_id=?",
    draft.storeId,
  );
  const pdv = config
    ? storeContextSettingsSchema.parse(JSON.parse(config.payload_json)).pdvCode
    : null;
  if (!pdv) throw Error("PROCUREMENT_STORE_PDV_REQUIRED");
  if (BigInt(pdv) !== BigInt(draft.catalogue.pdv))
    throw Error("PROCUREMENT_PDV_MISMATCH");
  const repo = new ProcurementProductLinkRepository(db, originals),
    links = await repo.list(draft.storeId);
  const empty = {
    draft,
    referenceId: null,
    referenceChecksum: null,
    facts: null,
    rows: [],
    options: [],
    links,
  } as const;
  if (!referenceId)
    return {
      ...empty,
      signature: sourceOriginalHash(
        JSON.stringify({
          checksum: draft.normalizedChecksum,
          pdv,
          links: links.map((l) => ({
            entity: l.entity,
            blocked: ["ERROR", "CONFLICT"].includes(l.syncState),
          })),
        }),
      ),
    };
  const source = await db.getFirstAsync<{
    checksum: string;
    local_file_uri: string | null;
    parser_version: string;
  }>(
    "SELECT checksum,local_file_uri,parser_version FROM source_documents WHERE id=? AND store_id=? AND source_type='MERCALYS_PURCHASE_PRICES' AND deleted_at IS NULL",
    referenceId,
    draft.storeId,
  );
  if (
    !source?.local_file_uri ||
    source.parser_version !== "mercalys-article-reference.v1"
  )
    throw Error("PROCUREMENT_REFERENCE_ORIGINAL_REQUIRED");
  const bytes = await originals.read(source.local_file_uri, 25 * 1024 * 1024);
  if (
    !bytes.length ||
    bytes.length > 25 * 1024 * 1024 ||
    (await originals.sha256(bytes)) !== source.checksum
  )
    throw Error("PROCUREMENT_LINK_SOURCE_CHANGED");
  const facts = parseMercalysReferenceIdentities(
    new SheetJsSpreadsheetParser().parse(bytes),
  );
  if (BigInt(pdv) !== BigInt(facts.storeCode))
    throw Error("PROCUREMENT_LINK_PDV_MISMATCH");
  const master = await catalogue(db, draft.storeId);
  const options = facts.references
    .map((reference) => ({
      reference,
      productId: referenceProductOwner(reference, master, draft.storeId),
    }))
    .filter((r) => r.productId !== null);
  const rows = procurementLinkCandidates(
    draft.catalogue.offers,
    facts.references,
    master,
    draft.storeId,
  );
  return {
    draft,
    referenceId,
    referenceChecksum: source.checksum,
    facts,
    rows,
    options,
    links,
    signature: sourceOriginalHash(
      JSON.stringify({
        checksum: draft.normalizedChecksum,
        pdv,
        referenceId,
        referenceChecksum: source.checksum,
        rows,
        links: links.map((l) => ({
          entity: l.entity,
          blocked: ["ERROR", "CONFLICT"].includes(l.syncState),
        })),
        options,
      }),
    ),
  };
}
export type ProcurementPreview = Awaited<ReturnType<typeof procurementPreview>>;
export function procurementReadyRows(preview: ProcurementPreview) {
  return preview.rows.filter((row) => {
    const old = preview.links.find((l) => l.entity.genericId === row.genericId);
    return (
      ["PLU_MATCH", "ITM_CANDIDATE"].includes(row.state) &&
      row.products.length === 1 &&
      row.products[0]!.productId &&
      !old
    );
  });
}
/** One local transaction: immutable snapshot/upload + explicit link decisions.
 * No Product creation, price selection, quantity conversion or automatic relinking.
 */
export async function confirmProcurementImport(
  db: Database,
  preview: ProcurementPreview,
  rawManual: readonly ManualProcurementChoice[],
  originals: ProcurementOriginals,
  ctx: CatalogueActionContext,
) {
  ctx.assertCurrentScope();
  if (
    preview.draft.storeId !== ctx.storeId ||
    preview.draft.ownerId !== ctx.actorId
  )
    throw Error("PROCUREMENT_LINK_ACTOR_INVALID");
  const manual = z
    .array(manualProcurementChoiceSchema)
    .max(1000)
    .parse(rawManual);
  if (new Set(manual.map((m) => m.genericId)).size !== manual.length)
    throw Error("PROCUREMENT_REVIEW_REQUIRED");
  // Reuse immutable byte reads within this single action, including nested canonical writers.
  const cache = new Map<string, Uint8Array>();
  const cached = {
    sha256: originals.sha256,
    read: async (uri: string, max?: number) => {
      let b = cache.get(uri);
      if (!b) {
        b = await originals.read(uri, max);
        cache.set(uri, b);
      }
      if (max && b.length > max) throw Error("PROCUREMENT_SOURCE_SIZE_INVALID");
      return b;
    },
  };
  let publication:
    | Awaited<ReturnType<ProcurementPublicationRepository["publish"]>>
    | undefined;
  await db.withExclusiveTransactionAsync(async (tx) => {
    ctx.assertCurrentScope();
    const joined = joinedMutationDatabase(tx);
    const draft = await new ProcurementCatalogueDraftRepository(
      joined,
      cached,
    ).get(ctx.storeId, ctx.actorId, preview.draft.checksum);
    if (!draft) throw Error("PROCUREMENT_DRAFT_CHANGED");
    const fresh = await procurementPreview(
      joined,
      draft,
      preview.referenceId,
      cached,
    );
    if (fresh.signature !== preview.signature)
      throw Error("PROCUREMENT_PREVIEW_CHANGED");
    const timestamp = ctx.now();
    publication = await new ProcurementPublicationRepository(
      joined,
      cached,
    ).publish(
      {
        storeId: ctx.storeId,
        ownerId: ctx.actorId,
        checksum: draft.checksum,
        normalizedChecksum: draft.normalizedChecksum,
        confirmedAt: timestamp,
        commandId: ctx.id(),
        deviceId: ctx.deviceId,
      },
      ctx.assertCurrentScope,
    );
    const decisions = new Map(manual.map((m) => [m.genericId, m]));
    if (
      manual.some((m) => !fresh.rows.some((r) => r.genericId === m.genericId))
    )
      throw Error("PROCUREMENT_REVIEW_REQUIRED");
    const selected = [
      ...procurementReadyRows(fresh).map((r) => ({
        genericId: r.genericId,
        sourceIndex: r.candidates[0]!.sourceIndex,
        productId: r.products[0]!.productId!,
        method:
          r.state === "PLU_MATCH"
            ? ("EXPLICIT_PLU" as const)
            : ("ITM_CANDIDATE" as const),
        reason: null as string | null,
      })),
      ...manual.map((m) => ({ ...m, method: "MANUAL" as const })),
    ].filter(
      (c, i, a) =>
        !decisions.has(c.genericId) ||
        (c.method === "MANUAL" &&
          a.findIndex(
            (v) => v.genericId === c.genericId && v.method === "MANUAL",
          ) === i),
    );
    const links: ProcurementProductLink[] = [];
    for (const c of selected) {
      const old = fresh.links.find((l) => l.entity.genericId === c.genericId);
      if (old && old.syncState !== "SYNCED")
        throw Error("PROCUREMENT_LINK_PENDING");
      const reference = fresh.facts?.references.find(
        (r) => r.sourceIndex === c.sourceIndex,
      );
      if (!reference || !fresh.referenceId || !fresh.referenceChecksum)
        throw Error("PROCUREMENT_LINK_SOURCE_REQUIRED");
      links.push(
        procurementProductLinkSchema.parse({
          id:
            old?.entity.id ??
            procurementProductLinkId(ctx.storeId, c.genericId),
          storeId: ctx.storeId,
          genericId: c.genericId,
          productId: c.productId,
          status: "ACTIVE",
          basis: {
            catalogueSnapshotId: publication.id,
            catalogueChecksum: publication.checksum,
            referenceDocumentId: fresh.referenceId,
            referenceChecksum: fresh.referenceChecksum,
            referenceParserVersion: fresh.facts!.parserVersion,
            reference,
            method: c.method,
            reason: c.reason,
          },
          version: (old?.entity.version ?? 0) + 1,
          createdBy: old?.entity.createdBy ?? ctx.actorId,
          createdAt: old?.entity.createdAt ?? timestamp,
          updatedBy: ctx.actorId,
          updatedAt: timestamp,
        }),
      );
    }
    if (links.length)
      await new ProcurementProductLinkRepository(joined, cached).confirmBatch(
        links,
        {
          reviewId: ctx.id(),
          commandId: ctx.id(),
          deviceId: ctx.deviceId,
          actorId: ctx.actorId,
          storeId: ctx.storeId,
          createdAt: timestamp,
          assertCurrentScope: ctx.assertCurrentScope,
        },
      );
    ctx.assertCurrentScope();
  });
  if (!publication) throw Error("PROCUREMENT_DRAFT_CHANGED");
  return publication;
}

export async function productProcurementOffers(
  db: Database,
  storeId: string,
  productId: string,
) {
  const links = (
    await db.getAllAsync<{ payload_json: string; sync_state: string }>(
      "SELECT payload_json,sync_state FROM procurement_product_links WHERE store_id=?",
      storeId,
    )
  ).map((r) => ({
    entity: procurementProductLinkSchema.parse(JSON.parse(r.payload_json)),
    syncState: r.sync_state,
  }));
  if (
    !links.some(
      (l) =>
        l.entity.productId === productId &&
        l.entity.status === "ACTIVE" &&
        !["ERROR", "CONFLICT"].includes(l.syncState),
    )
  )
    return [];
  const master = await catalogue(db, storeId);
  const genericIds = new Set(
    links
      .filter(
        (l) =>
          l.entity.productId === productId &&
          l.entity.status === "ACTIVE" &&
          !["ERROR", "CONFLICT"].includes(l.syncState) &&
          referenceProductOwner(l.entity.basis.reference, master, storeId) ===
            productId,
      )
      .map((l) => l.entity.genericId),
  );
  if (!genericIds.size) return [];
  const snapshots = (
    await db.getAllAsync<{ payload_json: string; sync_state: string }>(
      "SELECT payload_json,sync_state FROM procurement_catalogue_snapshots WHERE store_id=? AND sync_state NOT IN ('ERROR','CONFLICT')",
      storeId,
    )
  )
    .map((r) => ({
      publication: procurementPublicationSchema.parse(
        JSON.parse(r.payload_json),
      ),
      syncState: r.sync_state,
    }))
    .sort(
      (a, b) =>
        Date.parse(b.publication.catalogue.asOf) -
          Date.parse(a.publication.catalogue.asOf) ||
        a.publication.id.localeCompare(b.publication.id),
    );
  const seen = new Set<string>();
  const offers = [];
  for (const s of snapshots)
    for (const offer of s.publication.catalogue.offers) {
      if (seen.has(offer.offerId)) continue;
      seen.add(offer.offerId);
      if (genericIds.has(offer.genericId))
        offers.push({
          offer,
          asOf: s.publication.catalogue.asOf,
          snapshotId: s.publication.id,
          sourceDocumentId: s.publication.sourceDocumentId,
          syncState: s.syncState,
        });
    }
  return offers;
}
export async function productProcurementEnrichment(
  db: Database,
  storeId: string,
  productId: string,
) {
  const snapshot = await loadProductEditorSnapshot(
    new ProductMasterRepository(db),
    productId,
  );
  if (
    !snapshot ||
    snapshot.product.entity.storeId !== storeId ||
    ["CONFLICT", "ERROR"].includes(snapshot.product.syncState)
  )
    throw Error("PRODUCT_EDITOR_UNAVAILABLE");
  const links = (
    await db.getAllAsync<{ payload_json: string; sync_state: string }>(
      "SELECT payload_json,sync_state FROM procurement_product_links WHERE store_id=?",
      storeId,
    )
  )
    .filter((r) => !["ERROR", "CONFLICT"].includes(r.sync_state))
    .map((r) => procurementProductLinkSchema.parse(JSON.parse(r.payload_json)))
    .filter((l) => l.productId === productId && l.status === "ACTIVE");
  if (!links.length) return null;
  const sources = [];
  const master = await catalogue(db, storeId);
  for (const link of links) {
    if (
      referenceProductOwner(link.basis.reference, master, storeId) !== productId
    )
      throw Error("PROCUREMENT_LINK_CHOICE_CHANGED");
    const row = await db.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM procurement_catalogue_snapshots WHERE id=? AND store_id=? AND sync_state NOT IN ('ERROR','CONFLICT')",
      link.basis.catalogueSnapshotId,
      storeId,
    );
    if (!row) throw Error("PROCUREMENT_LINK_SOURCE_REQUIRED");
    const p = procurementPublicationSchema.parse(JSON.parse(row.payload_json));
    sources.push({
      link,
      catalogueSnapshotId: p.id,
      catalogueChecksum: p.checksum,
      catalogue: p.catalogue,
    });
  }
  return {
    snapshot,
    sources,
    proposal: buildProcurementEnrichment(snapshot.product.entity, sources),
  };
}
export async function confirmProcurementEnrichment(
  db: Database,
  expected: NonNullable<
    Awaited<ReturnType<typeof productProcurementEnrichment>>
  >,
  choice: {
    nature: boolean;
    packaging: boolean;
    petitPrix: boolean;
    category?: "FRUIT" | "VEGETABLE" | "OTHER";
  },
  ctx: CatalogueActionContext,
) {
  ctx.assertCurrentScope();
  await db.withExclusiveTransactionAsync(async (tx) => {
    ctx.assertCurrentScope();
    const joined = joinedMutationDatabase(tx),
      fresh = await productProcurementEnrichment(
        joined,
        ctx.storeId,
        expected.proposal.productId,
      );
    if (!fresh || JSON.stringify(fresh) !== JSON.stringify(expected))
      throw Error("PROCUREMENT_PREVIEW_CHANGED");
    const draft = productSnapshotToDraft(fresh.snapshot);
    draft.isPetitPrix = fresh.snapshot.product.entity.isPetitPrix;
    const pick = <T>(field: { state: string; candidates: { value: T }[] }) => {
      if (field.state !== "PROPOSED" || field.candidates.length !== 1)
        throw Error("PROCUREMENT_ENRICHMENT_REVIEW_REQUIRED");
      return field.candidates[0]!.value;
    };
    if (choice.nature) draft.nature = pick(fresh.proposal.nature);
    if (choice.packaging) {
      const p = pick(fresh.proposal.packaging);
      draft.packagingQuantity = p.quantity;
      draft.packagingUnit = p.unit;
      draft.packagingSourceLabel = p.sourceLabel ?? "";
    }
    if (choice.petitPrix) draft.isPetitPrix = pick(fresh.proposal.isPetitPrix);
    if (choice.category)
      draft.category = z
        .enum(["FRUIT", "VEGETABLE", "OTHER"])
        .parse(choice.category);
    await saveProductEditorLocally(
      joined,
      draft,
      {
        storeId: ctx.storeId,
        deviceId: ctx.deviceId,
        productId: fresh.proposal.productId,
        now: ctx.now,
        generateId: ctx.id,
        assertCurrentScope: ctx.assertCurrentScope,
      },
      fresh.snapshot,
    );
    ctx.assertCurrentScope();
  });
}
