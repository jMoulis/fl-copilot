import {
  productAliasSchema,
  productIdentifierSchema,
  productSchema,
  type Product,
  type ProductAlias,
  type ProductIdentifier,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";

export interface ProductMasterSnapshot {
  products: unknown[];
  productIdentifiers: unknown[];
  productAliases: unknown[];
}

export async function applyProductMasterSnapshot(
  database: OutboxDatabase,
  storeId: string,
  snapshot: ProductMasterSnapshot,
) {
  const products = snapshot.products.map((value) => productSchema.parse(value));
  const identifiers = snapshot.productIdentifiers.map((value) =>
    productIdentifierSchema.parse(value),
  );
  const aliases = snapshot.productAliases.map((value) =>
    productAliasSchema.parse(value),
  );
  assertStore(storeId, [...products, ...identifiers, ...aliases]);
  for (const product of products) await upsertProduct(database, product);
  for (const identifier of identifiers)
    await upsertIdentifier(database, identifier);
  for (const alias of aliases) await upsertAlias(database, alias);
}

export async function applyProductMasterChange(
  database: OutboxDatabase,
  storeId: string,
  change: {
    entityType: string;
    entityId: string;
    entityVersion: number;
    operation: "UPSERT" | "DELETE";
    entity?: unknown;
  },
  expectedLocalVersion?: number,
) {
  const table = tableFor(change.entityType);
  if (!table) return false;
  if (change.operation === "DELETE") {
    await database.runAsync(
      `
        DELETE FROM ${table}
        WHERE id = ? AND store_id = ? AND (dirty = 0 OR version = ?)
          AND COALESCE(remote_version, -1) <= ?
      `,
      change.entityId,
      storeId,
      expectedLocalVersion ?? -1,
      change.entityVersion,
    );
    return true;
  }
  if (change.entityType === "product") {
    const entity = productSchema.parse(change.entity);
    assertEnvelope(storeId, change, entity);
    await upsertProduct(database, entity, expectedLocalVersion);
  } else if (change.entityType === "product_identifier") {
    const entity = productIdentifierSchema.parse(change.entity);
    assertEnvelope(storeId, change, entity);
    await upsertIdentifier(database, entity, expectedLocalVersion);
  } else {
    const entity = productAliasSchema.parse(change.entity);
    assertEnvelope(storeId, change, entity);
    await upsertAlias(database, entity, expectedLocalVersion);
  }
  return true;
}

function assertStore(storeId: string, entities: { storeId: string }[]) {
  if (entities.some((entity) => entity.storeId !== storeId)) {
    throw new Error("Product master entity belongs to another store.");
  }
}

function assertEnvelope(
  storeId: string,
  change: { entityId: string; entityVersion: number },
  entity: { id: string; storeId: string; version: number },
) {
  if (
    entity.id !== change.entityId ||
    entity.storeId !== storeId ||
    entity.version !== change.entityVersion
  ) {
    throw new Error("Product master entity does not match its envelope.");
  }
}

async function upsertProduct(
  database: OutboxDatabase,
  product: Product,
  expectedLocalVersion?: number,
) {
  await database.runAsync(
    `
      INSERT INTO products (
        id, store_id, label, category, nature, sales_unit,
        packaging_quantity, packaging_unit, packaging_source_label,
        family_id, subfamily_id, status, version, created_at, updated_at,
        deleted_at, sync_state, remote_version, dirty
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYNCED', ?, 0)
      ON CONFLICT(id) DO UPDATE SET
        store_id = excluded.store_id, label = excluded.label,
        category = excluded.category, nature = excluded.nature,
        sales_unit = excluded.sales_unit,
        packaging_quantity = excluded.packaging_quantity,
        packaging_unit = excluded.packaging_unit,
        packaging_source_label = excluded.packaging_source_label,
        family_id = excluded.family_id, subfamily_id = excluded.subfamily_id,
        status = excluded.status, version = excluded.version,
        created_at = excluded.created_at, updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at, sync_state = 'SYNCED',
        remote_version = excluded.remote_version, dirty = 0
      WHERE (products.dirty = 0 OR products.version = ?)
        AND excluded.version >= COALESCE(products.remote_version, -1)
    `,
    product.id,
    product.storeId,
    product.label,
    product.category,
    product.nature,
    product.salesUnit,
    product.packaging?.quantity ?? null,
    product.packaging?.unit ?? null,
    product.packaging?.sourceLabel ?? null,
    product.familyId ?? null,
    product.subfamilyId ?? null,
    product.status,
    product.version,
    product.createdAt,
    product.updatedAt,
    product.deletedAt ?? null,
    product.version,
    expectedLocalVersion ?? -1,
  );
}

async function upsertIdentifier(
  database: OutboxDatabase,
  identifier: ProductIdentifier,
  expectedLocalVersion?: number,
) {
  await database.runAsync(
    `
      INSERT INTO product_identifiers (
        id, store_id, product_id, type, value, source, status, version,
        created_at, updated_at, deleted_at, sync_state, remote_version, dirty
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYNCED', ?, 0)
      ON CONFLICT(id) DO UPDATE SET
        store_id = excluded.store_id, product_id = excluded.product_id,
        type = excluded.type, value = excluded.value, source = excluded.source,
        status = excluded.status, version = excluded.version,
        created_at = excluded.created_at, updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at, sync_state = 'SYNCED',
        remote_version = excluded.remote_version, dirty = 0
      WHERE (product_identifiers.dirty = 0 OR product_identifiers.version = ?)
        AND excluded.version >= COALESCE(product_identifiers.remote_version, -1)
    `,
    identifier.id,
    identifier.storeId,
    identifier.productId,
    identifier.type,
    identifier.value,
    identifier.source,
    identifier.status,
    identifier.version,
    identifier.createdAt,
    identifier.updatedAt,
    identifier.deletedAt ?? null,
    identifier.version,
    expectedLocalVersion ?? -1,
  );
}

async function upsertAlias(
  database: OutboxDatabase,
  alias: ProductAlias,
  expectedLocalVersion?: number,
) {
  await database.runAsync(
    `
      INSERT INTO product_aliases (
        id, store_id, product_id, alias, normalized_alias, source, status,
        confidence, version, created_at, updated_at, deleted_at, sync_state,
        remote_version, dirty
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYNCED', ?, 0)
      ON CONFLICT(id) DO UPDATE SET
        store_id = excluded.store_id, product_id = excluded.product_id,
        alias = excluded.alias, normalized_alias = excluded.normalized_alias,
        source = excluded.source, status = excluded.status,
        confidence = excluded.confidence, version = excluded.version,
        created_at = excluded.created_at, updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at, sync_state = 'SYNCED',
        remote_version = excluded.remote_version, dirty = 0
      WHERE (product_aliases.dirty = 0 OR product_aliases.version = ?)
        AND excluded.version >= COALESCE(product_aliases.remote_version, -1)
    `,
    alias.id,
    alias.storeId,
    alias.productId,
    alias.alias,
    alias.normalizedAlias,
    alias.source,
    alias.status,
    alias.confidence ?? null,
    alias.version,
    alias.createdAt,
    alias.updatedAt,
    alias.deletedAt ?? null,
    alias.version,
    expectedLocalVersion ?? -1,
  );
}

function tableFor(entityType: string) {
  if (entityType === "product") return "products";
  if (entityType === "product_identifier") return "product_identifiers";
  if (entityType === "product_alias") return "product_aliases";
  return undefined;
}
