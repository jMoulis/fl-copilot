import {
  normalizeProductLabel,
  productAliasSchema,
  productIdentifierSchema,
  productSchema,
  type Product,
  type ProductAlias,
  type ProductIdentifier,
} from "@fl-copilot/domain";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";

type EntityKind = "product" | "product_identifier" | "product_alias";
type ProductMasterEntity = Product | ProductIdentifier | ProductAlias;

export interface ProductMutationContext {
  commandId: string;
  deviceId: string;
  expectedRemoteVersion?: number | null;
}

export interface LocalProductMasterRecord<T extends ProductMasterEntity> {
  entity: T;
  syncState: "PENDING" | "SYNCED" | "CONFLICT" | "ERROR";
  remoteVersion: number | null;
  dirty: boolean;
}

export class ProductMasterRepository {
  constructor(
    private readonly database: AtomicMutationDatabase & OutboxDatabase,
  ) {}

  upsertProduct(entity: Product, context: ProductMutationContext) {
    return this.upsert("product", productSchema.parse(entity), context);
  }

  upsertIdentifier(entity: ProductIdentifier, context: ProductMutationContext) {
    return this.upsert(
      "product_identifier",
      productIdentifierSchema.parse(entity),
      context,
    );
  }

  upsertAlias(entity: ProductAlias, context: ProductMutationContext) {
    return this.upsert(
      "product_alias",
      productAliasSchema.parse(entity),
      context,
    );
  }

  /** Explicit receipt-label memory; the alias and command commit together. */
  async rememberWasteReceiptAlias(
    receiptId: string,
    lineId: string,
    aliasId: string,
    context: ProductMutationContext,
  ) {
    let remembered: ProductAlias | undefined;
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const line = await transaction.getFirstAsync<{
        store_id: string;
        raw_label: string;
        matched_product_id: string;
      }>(
        `SELECT l.store_id, l.raw_label, l.matched_product_id
         FROM waste_lines l JOIN waste_receipts r ON r.id = l.receipt_id
         JOIN products p ON p.id = l.matched_product_id AND p.store_id = l.store_id
         WHERE l.id = ? AND r.id = ? AND r.store_id = l.store_id
           AND l.match_status = 'MATCHED' AND l.validation_status != 'EXCLUDED'
           AND p.deleted_at IS NULL AND p.status = 'ACTIVE'`,
        lineId,
        receiptId,
      );
      if (!line) throw new Error("WASTE_ALIAS_PRODUCT_REQUIRED");
      const normalizedAlias = normalizeProductLabel(line.raw_label);
      const products = await transaction.getAllAsync<{
        id: string;
        label: string;
      }>(
        "SELECT id, label FROM products WHERE store_id = ? AND deleted_at IS NULL AND status = 'ACTIVE'",
        line.store_id,
      );
      if (
        products.some(
          (product) =>
            product.id !== line.matched_product_id &&
            normalizeProductLabel(product.label) === normalizedAlias,
        )
      )
        throw new Error("WASTE_ALIAS_CONFLICT");
      const existing = await transaction.getAllAsync<AliasRow>(
        `SELECT * FROM product_aliases WHERE store_id = ?
         AND normalized_alias = ? AND deleted_at IS NULL`,
        line.store_id,
        normalizedAlias,
      );
      if (
        existing.some(
          (row) =>
            row.product_id !== line.matched_product_id ||
            row.status !== "VALIDATED",
        )
      )
        throw new Error("WASTE_ALIAS_CONFLICT");
      if (existing[0]) {
        remembered = mapAlias(existing[0]).entity;
        return;
      }
      const timestamp = new Date().toISOString();
      remembered = productAliasSchema.parse({
        id: aliasId,
        storeId: line.store_id,
        productId: line.matched_product_id,
        alias: line.raw_label,
        normalizedAlias,
        source: "WASTE_RECEIPT",
        status: "VALIDATED",
        confidence: 1,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      });
      await writeEntity(transaction, "product_alias", remembered, null);
      await new OutboxRepository(transaction).enqueue({
        commandId: context.commandId,
        storeId: line.store_id,
        deviceId: context.deviceId,
        commandType: "PRODUCT_ALIAS_UPSERT",
        entityType: "product_alias",
        entityId: remembered.id,
        expectedRemoteVersion: null,
        payload: remembered,
        createdAt: timestamp,
      });
    });
    return remembered!;
  }

  async delete(
    kind: EntityKind,
    id: string,
    storeId: string,
    deletedAt: string,
    context: ProductMutationContext,
  ) {
    const table = tableFor(kind);
    let changed = false;
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const result = await transaction.runAsync(
        `
          UPDATE ${table}
          SET deleted_at = ?, updated_at = ?, version = version + 1,
              sync_state = 'PENDING', dirty = 1
          WHERE id = ? AND store_id = ? AND deleted_at IS NULL
        `,
        deletedAt,
        deletedAt,
        id,
        storeId,
      );
      if (Number(result.changes) !== 1) {
        throw new Error("Product master entity could not be deleted.");
      }
      const updated = await transaction.getFirstAsync<{ version: number }>(
        `SELECT version FROM ${table} WHERE id = ? AND store_id = ?`,
        id,
        storeId,
      );
      if (!updated)
        throw new Error("Deleted product master entity is missing.");
      await new OutboxRepository(transaction).enqueue({
        commandId: context.commandId,
        storeId,
        deviceId: context.deviceId,
        commandType: `${kind.toUpperCase()}_DELETE`,
        entityType: kind,
        entityId: id,
        expectedRemoteVersion: context.expectedRemoteVersion ?? null,
        payload: { id, storeId, deletedAt, version: updated.version },
        createdAt: deletedAt,
      });
      changed = true;
    });
    return changed;
  }

  async getProduct(id: string) {
    const row = await this.database.getFirstAsync<ProductRow>(
      "SELECT * FROM products WHERE id = ?",
      id,
    );
    return row ? mapProduct(row) : null;
  }

  async listProducts(storeId: string) {
    const rows = await this.database.getAllAsync<ProductRow>(
      `
        SELECT * FROM products
        WHERE store_id = ? AND deleted_at IS NULL
        ORDER BY label COLLATE NOCASE, id
      `,
      storeId,
    );
    return rows.map(mapProduct);
  }

  async getIdentifier(id: string) {
    const row = await this.database.getFirstAsync<IdentifierRow>(
      "SELECT * FROM product_identifiers WHERE id = ?",
      id,
    );
    return row ? mapIdentifier(row) : null;
  }

  async getAlias(id: string) {
    const row = await this.database.getFirstAsync<AliasRow>(
      "SELECT * FROM product_aliases WHERE id = ?",
      id,
    );
    return row ? mapAlias(row) : null;
  }

  async listIdentifiers(productId: string) {
    const rows = await this.database.getAllAsync<IdentifierRow>(
      `
        SELECT * FROM product_identifiers
        WHERE product_id = ? AND deleted_at IS NULL
        ORDER BY type, value, id
      `,
      productId,
    );
    return rows.map(mapIdentifier);
  }

  async listIdentifiersByStore(storeId: string) {
    const rows = await this.database.getAllAsync<IdentifierRow>(
      `
        SELECT * FROM product_identifiers
        WHERE store_id = ? AND deleted_at IS NULL
        ORDER BY type, value, id
      `,
      storeId,
    );
    return rows.map(mapIdentifier);
  }

  async listAliases(productId: string) {
    const rows = await this.database.getAllAsync<AliasRow>(
      `
        SELECT * FROM product_aliases
        WHERE product_id = ? AND deleted_at IS NULL
        ORDER BY normalized_alias, id
      `,
      productId,
    );
    return rows.map(mapAlias);
  }

  async listAliasesByStore(storeId: string) {
    const rows = await this.database.getAllAsync<AliasRow>(
      `
        SELECT * FROM product_aliases
        WHERE store_id = ? AND deleted_at IS NULL
        ORDER BY normalized_alias, id
      `,
      storeId,
    );
    return rows.map(mapAlias);
  }

  private async upsert<T extends ProductMasterEntity>(
    kind: EntityKind,
    entity: T,
    context: ProductMutationContext,
  ) {
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      await writeEntity(
        transaction,
        kind,
        entity,
        context.expectedRemoteVersion,
      );
      await new OutboxRepository(transaction).enqueue({
        commandId: context.commandId,
        storeId: entity.storeId,
        deviceId: context.deviceId,
        commandType: `${kind.toUpperCase()}_UPSERT`,
        entityType: kind,
        entityId: entity.id,
        expectedRemoteVersion: context.expectedRemoteVersion ?? null,
        payload: entity,
        createdAt: entity.updatedAt,
      });
    });
    return entity;
  }
}

async function writeEntity(
  database: OutboxDatabase,
  kind: EntityKind,
  entity: ProductMasterEntity,
  remoteVersion: number | null | undefined,
) {
  if (kind === "product") {
    const product = entity as Product;
    await database.runAsync(
      `
        INSERT INTO products (
          id, store_id, label, category, nature, sales_unit,
          packaging_quantity, packaging_unit, packaging_source_label,
          family_id, subfamily_id, status, version, created_at, updated_at,
          deleted_at, sync_state, remote_version, dirty
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, 1)
        ON CONFLICT(id) DO UPDATE SET
          label = excluded.label, category = excluded.category,
          nature = excluded.nature, sales_unit = excluded.sales_unit,
          packaging_quantity = excluded.packaging_quantity,
          packaging_unit = excluded.packaging_unit,
          packaging_source_label = excluded.packaging_source_label,
          family_id = excluded.family_id, subfamily_id = excluded.subfamily_id,
          status = excluded.status, version = excluded.version,
          updated_at = excluded.updated_at, deleted_at = excluded.deleted_at,
          sync_state = 'PENDING', dirty = 1
        WHERE products.store_id = excluded.store_id
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
      remoteVersion ?? null,
    );
    return;
  }
  if (kind === "product_identifier") {
    const identifier = entity as ProductIdentifier;
    await database.runAsync(
      `
        INSERT INTO product_identifiers (
          id, store_id, product_id, type, value, source, status, version,
          created_at, updated_at, deleted_at, sync_state, remote_version, dirty
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, 1)
        ON CONFLICT(id) DO UPDATE SET
          product_id = excluded.product_id, type = excluded.type,
          value = excluded.value, source = excluded.source,
          status = excluded.status, version = excluded.version,
          updated_at = excluded.updated_at, deleted_at = excluded.deleted_at,
          sync_state = 'PENDING', dirty = 1
        WHERE product_identifiers.store_id = excluded.store_id
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
      remoteVersion ?? null,
    );
    return;
  }
  const alias = entity as ProductAlias;
  await database.runAsync(
    `
      INSERT INTO product_aliases (
        id, store_id, product_id, alias, normalized_alias, source, status,
        confidence, version, created_at, updated_at, deleted_at, sync_state,
        remote_version, dirty
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, 1)
      ON CONFLICT(id) DO UPDATE SET
        product_id = excluded.product_id, alias = excluded.alias,
        normalized_alias = excluded.normalized_alias,
        source = excluded.source, status = excluded.status,
        confidence = excluded.confidence, version = excluded.version,
        updated_at = excluded.updated_at, deleted_at = excluded.deleted_at,
        sync_state = 'PENDING', dirty = 1
      WHERE product_aliases.store_id = excluded.store_id
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
    remoteVersion ?? null,
  );
}

function tableFor(kind: EntityKind) {
  if (kind === "product") return "products";
  if (kind === "product_identifier") return "product_identifiers";
  return "product_aliases";
}

interface SyncColumns {
  sync_state: LocalProductMasterRecord<Product>["syncState"];
  remote_version: number | null;
  dirty: number;
}
interface ProductRow extends SyncColumns {
  id: string;
  store_id: string;
  label: string;
  category: Product["category"];
  nature: Product["nature"];
  sales_unit: Product["salesUnit"];
  packaging_quantity: string | null;
  packaging_unit: NonNullable<Product["packaging"]>["unit"] | null;
  packaging_source_label: string | null;
  family_id: string | null;
  subfamily_id: string | null;
  status: Product["status"];
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
interface IdentifierRow extends SyncColumns {
  id: string;
  store_id: string;
  product_id: string;
  type: ProductIdentifier["type"];
  value: string;
  source: ProductIdentifier["source"];
  status: ProductIdentifier["status"];
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
interface AliasRow extends SyncColumns {
  id: string;
  store_id: string;
  product_id: string;
  alias: string;
  normalized_alias: string;
  source: ProductAlias["source"];
  status: ProductAlias["status"];
  confidence: number | null;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function withSync<T extends ProductMasterEntity>(
  entity: T,
  row: SyncColumns,
): LocalProductMasterRecord<T> {
  return {
    entity,
    syncState: row.sync_state,
    remoteVersion: row.remote_version,
    dirty: row.dirty === 1,
  };
}

function mapProduct(row: ProductRow) {
  return withSync(
    productSchema.parse({
      id: row.id,
      storeId: row.store_id,
      label: row.label,
      category: row.category,
      nature: row.nature,
      salesUnit: row.sales_unit,
      packaging:
        row.packaging_quantity && row.packaging_unit
          ? {
              quantity: row.packaging_quantity,
              unit: row.packaging_unit,
              sourceLabel: row.packaging_source_label,
            }
          : null,
      familyId: row.family_id,
      subfamilyId: row.subfamily_id,
      status: row.status,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    }),
    row,
  );
}

function mapIdentifier(row: IdentifierRow) {
  return withSync(
    productIdentifierSchema.parse({
      id: row.id,
      storeId: row.store_id,
      productId: row.product_id,
      type: row.type,
      value: row.value,
      source: row.source,
      status: row.status,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    }),
    row,
  );
}

function mapAlias(row: AliasRow) {
  return withSync(
    productAliasSchema.parse({
      id: row.id,
      storeId: row.store_id,
      productId: row.product_id,
      alias: row.alias,
      normalizedAlias: row.normalized_alias,
      source: row.source,
      status: row.status,
      confidence: row.confidence,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    }),
    row,
  );
}
