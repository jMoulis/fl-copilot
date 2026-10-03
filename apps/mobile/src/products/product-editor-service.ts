import {
  normalizeProductLabel,
  type Product,
  type ProductAlias,
  type ProductIdentifier,
} from "@fl-copilot/domain";
import {
  ProductMasterRepository,
  type LocalProductMasterRecord,
} from "./product-master-repository";

export interface ProductEditorDraft {
  label: string;
  category: Product["category"];
  nature: Product["nature"];
  salesUnit: Product["salesUnit"];
  packagingQuantity: string;
  packagingUnit: NonNullable<Product["packaging"]>["unit"];
  packagingSourceLabel: string;
  identifiers: Array<{
    id?: string;
    type: ProductIdentifier["type"];
    value: string;
  }>;
  aliases: Array<{ id?: string; alias: string }>;
}

export interface ProductEditorSnapshot {
  product: LocalProductMasterRecord<Product>;
  identifiers: Array<LocalProductMasterRecord<ProductIdentifier>>;
  aliases: Array<LocalProductMasterRecord<ProductAlias>>;
}

interface SaveProductEditorOptions {
  storeId: string;
  deviceId: string;
  productId?: string;
  existing?: ProductEditorSnapshot;
  now(): string;
  generateId(): string;
  identifierSource?: ProductIdentifier["source"];
  aliasSource?: ProductAlias["source"];
}

export async function loadProductEditorSnapshot(
  repository: ProductMasterRepository,
  productId: string,
) {
  const product = await repository.getProduct(productId);
  if (!product || product.entity.deletedAt) return null;
  const [identifiers, aliases] = await Promise.all([
    repository.listIdentifiers(productId),
    repository.listAliases(productId),
  ]);
  return { product, identifiers, aliases } satisfies ProductEditorSnapshot;
}

export async function saveProductEditor(
  repository: ProductMasterRepository,
  draft: ProductEditorDraft,
  options: SaveProductEditorOptions,
) {
  const timestamp = options.now();
  const productId = options.productId ?? options.generateId();
  const existingProduct = options.existing?.product;
  const product: Product = {
    id: productId,
    storeId: options.storeId,
    label: draft.label.trim(),
    category: draft.category,
    nature: draft.nature,
    salesUnit: draft.salesUnit,
    packaging: draft.packagingQuantity.trim()
      ? {
          quantity: normalizeDecimal(draft.packagingQuantity),
          unit: draft.packagingUnit,
          sourceLabel: draft.packagingSourceLabel.trim() || null,
        }
      : null,
    familyId: existingProduct?.entity.familyId ?? null,
    subfamilyId: existingProduct?.entity.subfamilyId ?? null,
    status: existingProduct?.entity.status ?? "ACTIVE",
    version: (existingProduct?.entity.version ?? 0) + 1,
    createdAt: existingProduct?.entity.createdAt ?? timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
  await repository.upsertProduct(product, {
    commandId: options.generateId(),
    deviceId: options.deviceId,
    expectedRemoteVersion: expectedRemoteVersion(existingProduct),
  });

  const existingIdentifiers = new Map(
    options.existing?.identifiers.map((record) => [record.entity.id, record]) ??
      [],
  );
  const retainedIdentifierIds = new Set<string>();
  for (const input of draft.identifiers) {
    const value = input.value.trim();
    if (!value) continue;
    const existing = input.id ? existingIdentifiers.get(input.id) : undefined;
    const id = existing?.entity.id ?? options.generateId();
    retainedIdentifierIds.add(id);
    await repository.upsertIdentifier(
      {
        id,
        storeId: options.storeId,
        productId,
        type: input.type,
        value,
        source: existing?.entity.source ?? options.identifierSource ?? "USER",
        status: existing?.entity.status ?? "VALIDATED",
        version: (existing?.entity.version ?? 0) + 1,
        createdAt: existing?.entity.createdAt ?? timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      },
      {
        commandId: options.generateId(),
        deviceId: options.deviceId,
        expectedRemoteVersion: expectedRemoteVersion(existing),
      },
    );
  }
  for (const existing of existingIdentifiers.values()) {
    if (!retainedIdentifierIds.has(existing.entity.id)) {
      await repository.delete(
        "product_identifier",
        existing.entity.id,
        options.storeId,
        timestamp,
        {
          commandId: options.generateId(),
          deviceId: options.deviceId,
          expectedRemoteVersion: expectedRemoteVersion(existing),
        },
      );
    }
  }

  const existingAliases = new Map(
    options.existing?.aliases.map((record) => [record.entity.id, record]) ?? [],
  );
  const retainedAliasIds = new Set<string>();
  for (const input of draft.aliases) {
    const alias = input.alias.trim();
    if (!alias) continue;
    const existing = input.id ? existingAliases.get(input.id) : undefined;
    const id = existing?.entity.id ?? options.generateId();
    retainedAliasIds.add(id);
    await repository.upsertAlias(
      {
        id,
        storeId: options.storeId,
        productId,
        alias,
        normalizedAlias: normalizeProductLabel(alias),
        source: existing?.entity.source ?? options.aliasSource ?? "USER",
        status: existing?.entity.status ?? "VALIDATED",
        confidence: existing?.entity.confidence ?? null,
        version: (existing?.entity.version ?? 0) + 1,
        createdAt: existing?.entity.createdAt ?? timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      },
      {
        commandId: options.generateId(),
        deviceId: options.deviceId,
        expectedRemoteVersion: expectedRemoteVersion(existing),
      },
    );
  }
  for (const existing of existingAliases.values()) {
    if (!retainedAliasIds.has(existing.entity.id)) {
      await repository.delete(
        "product_alias",
        existing.entity.id,
        options.storeId,
        timestamp,
        {
          commandId: options.generateId(),
          deviceId: options.deviceId,
          expectedRemoteVersion: expectedRemoteVersion(existing),
        },
      );
    }
  }

  return productId;
}

export function productSnapshotToDraft(
  snapshot: ProductEditorSnapshot,
): ProductEditorDraft {
  return {
    label: snapshot.product.entity.label,
    category: snapshot.product.entity.category,
    nature: snapshot.product.entity.nature,
    salesUnit: snapshot.product.entity.salesUnit,
    packagingQuantity: snapshot.product.entity.packaging?.quantity ?? "",
    packagingUnit: snapshot.product.entity.packaging?.unit ?? "KG",
    packagingSourceLabel: snapshot.product.entity.packaging?.sourceLabel ?? "",
    identifiers: snapshot.identifiers.map(({ entity }) => ({
      id: entity.id,
      type: entity.type,
      value: entity.value,
    })),
    aliases: snapshot.aliases.map(({ entity }) => ({
      id: entity.id,
      alias: entity.alias,
    })),
  };
}

export const emptyProductDraft: ProductEditorDraft = {
  label: "",
  category: "UNKNOWN",
  nature: "UNKNOWN",
  salesUnit: "UNKNOWN",
  packagingQuantity: "",
  packagingUnit: "KG",
  packagingSourceLabel: "",
  identifiers: [],
  aliases: [],
};

function expectedRemoteVersion<
  T extends Product | ProductIdentifier | ProductAlias,
>(record: LocalProductMasterRecord<T> | undefined) {
  if (!record) return null;
  return record.dirty ? record.entity.version : record.remoteVersion;
}

function normalizeDecimal(value: string) {
  return value.trim().replace(",", ".");
}
