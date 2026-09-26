import { Decimal128 } from "mongodb";
import {
  productAliasSchema,
  productIdentifierSchema,
  productSchema,
  type Product,
  type ProductAlias,
  type ProductIdentifier,
} from "@fl-copilot/domain";
import type {
  ApiErrorDto,
  SyncCommand,
  SyncCommandResult,
} from "@fl-copilot/sync-contracts";
import type { MongoCommandMutationContext } from "../sync/processed-command-service.js";

export interface ProductDocument extends Omit<
  Product,
  "id" | "packaging" | "createdAt" | "updatedAt" | "deletedAt"
> {
  _id: string;
  packaging?: {
    quantity: Decimal128;
    unit: NonNullable<Product["packaging"]>["unit"];
    sourceLabel?: string | null;
  } | null;
  schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

export interface ProductIdentifierDocument extends Omit<
  ProductIdentifier,
  "id" | "createdAt" | "updatedAt" | "deletedAt"
> {
  _id: string;
  schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

export interface ProductAliasDocument extends Omit<
  ProductAlias,
  "id" | "createdAt" | "updatedAt" | "deletedAt"
> {
  _id: string;
  schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

interface ProductChangeAppender {
  append(
    context: MongoCommandMutationContext,
    input: {
      storeId: string;
      entityType: string;
      entityId: string;
      operation: "UPSERT" | "DELETE";
      entityVersion: number;
    },
  ): Promise<unknown>;
}

export interface ProductCommandOutcome {
  resultStatus: "APPLIED" | "CONFLICT" | "REJECTED";
  resultingVersion: number | null;
  responseJson?: {
    remoteEntity?: SyncCommandResult["remoteEntity"];
    error?: ApiErrorDto;
  };
}

export function isProductMasterCommand(command: SyncCommand) {
  return [
    "PRODUCT_UPSERT",
    "PRODUCT_DELETE",
    "PRODUCT_IDENTIFIER_UPSERT",
    "PRODUCT_IDENTIFIER_DELETE",
    "PRODUCT_ALIAS_UPSERT",
    "PRODUCT_ALIAS_DELETE",
  ].includes(command.type);
}

export async function applyProductMasterCommand(
  context: MongoCommandMutationContext,
  storeId: string,
  command: SyncCommand,
  requestId: string,
  now: () => Date,
  changes: ProductChangeAppender,
): Promise<ProductCommandOutcome> {
  const descriptor = descriptorFor(command);
  if (!descriptor || descriptor.entityType !== command.entityType) {
    return rejected(
      "SYNC_COMMAND_INVALID",
      "Cette commande produit est invalide.",
      requestId,
    );
  }
  const collection = context.database.collection<ProductMasterDocument>(
    descriptor.collection,
  );
  const existing = await collection.findOne(
    { _id: command.entityId },
    { session: context.session },
  );
  if (existing && existing.storeId !== storeId) {
    return rejected(
      "SYNC_ENTITY_STORE_MISMATCH",
      "Cette donnée appartient à un autre magasin.",
      requestId,
    );
  }
  const actualVersion = existing?.version ?? null;
  if ((command.expectedRemoteVersion ?? null) !== actualVersion) {
    return conflict(command, existing, actualVersion, requestId);
  }
  if (descriptor.operation === "DELETE") {
    if (!existing) {
      return rejected(
        "SYNC_ENTITY_NOT_FOUND",
        "Cette donnée produit n’existe plus.",
        requestId,
      );
    }
    const deletedAt = now();
    const nextVersion = existing.version + 1;
    await collection.updateOne(
      { _id: existing._id },
      { $set: { deletedAt, updatedAt: deletedAt, version: nextVersion } },
      { session: context.session },
    );
    await changes.append(context, {
      storeId,
      entityType: command.entityType,
      entityId: command.entityId,
      operation: "DELETE",
      entityVersion: nextVersion,
    });
    return { resultStatus: "APPLIED", resultingVersion: nextVersion };
  }

  const parsed = descriptor.schema.safeParse(command.payload);
  if (
    !parsed.success ||
    parsed.data.id !== command.entityId ||
    parsed.data.storeId !== storeId
  ) {
    return rejected(
      "SYNC_COMMAND_INVALID",
      "Les données produit sont invalides.",
      requestId,
    );
  }
  if (descriptor.entityType !== "product") {
    const child = parsed.data as ProductIdentifier | ProductAlias;
    const parent = await context.database
      .collection<ProductDocument>("products")
      .findOne(
        { _id: child.productId, storeId, deletedAt: null },
        { session: context.session },
      );
    if (!parent) {
      return rejected(
        "SYNC_PRODUCT_NOT_FOUND",
        "Le produit associé n’existe pas.",
        requestId,
      );
    }
  }
  if (descriptor.entityType === "product_identifier") {
    const identifier = parsed.data as ProductIdentifier;
    const duplicate = await context.database
      .collection<ProductIdentifierDocument>("productIdentifiers")
      .findOne(
        {
          _id: { $ne: identifier.id },
          storeId,
          type: identifier.type,
          value: identifier.value,
          deletedAt: null,
        },
        { session: context.session },
      );
    if (duplicate) {
      return rejected(
        "PRODUCT_IDENTIFIER_ALREADY_USED",
        "Cet identifiant est déjà associé à un autre produit.",
        requestId,
      );
    }
  }
  const timestamp = now();
  const nextVersion = (actualVersion ?? 0) + 1;
  const document = toDocument(
    descriptor.entityType,
    parsed.data,
    nextVersion,
    existing?.createdAt ?? timestamp,
    timestamp,
  );
  await collection.replaceOne({ _id: command.entityId }, document, {
    upsert: true,
    session: context.session,
  });
  await changes.append(context, {
    storeId,
    entityType: command.entityType,
    entityId: command.entityId,
    operation: "UPSERT",
    entityVersion: nextVersion,
  });
  return {
    resultStatus: "APPLIED",
    resultingVersion: nextVersion,
    responseJson: {
      remoteEntity: serializeProductMasterDocument(
        descriptor.entityType,
        document,
      ),
    },
  };
}

type ProductMasterDocument =
  ProductDocument | ProductIdentifierDocument | ProductAliasDocument;
type ProductMasterEntity = Product | ProductIdentifier | ProductAlias;

export function serializeProductMasterDocument(
  entityType: string,
  document: ProductMasterDocument,
) {
  const common = {
    id: document._id,
    storeId: document.storeId,
    version: document.version,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
    deletedAt: document.deletedAt?.toISOString() ?? null,
  };
  if (entityType === "product") {
    const product = document as ProductDocument;
    return productSchema.parse({
      ...common,
      label: product.label,
      category: product.category,
      nature: product.nature,
      salesUnit: product.salesUnit,
      packaging: product.packaging
        ? {
            quantity: product.packaging.quantity.toString(),
            unit: product.packaging.unit,
            sourceLabel: product.packaging.sourceLabel ?? null,
          }
        : null,
      familyId: product.familyId ?? null,
      subfamilyId: product.subfamilyId ?? null,
      status: product.status,
    });
  }
  if (entityType === "product_identifier") {
    const identifier = document as ProductIdentifierDocument;
    return productIdentifierSchema.parse({
      ...common,
      productId: identifier.productId,
      type: identifier.type,
      value: identifier.value,
      source: identifier.source,
      status: identifier.status,
    });
  }
  const alias = document as ProductAliasDocument;
  return productAliasSchema.parse({
    ...common,
    productId: alias.productId,
    alias: alias.alias,
    normalizedAlias: alias.normalizedAlias,
    source: alias.source,
    status: alias.status,
    confidence: alias.confidence ?? null,
  });
}

export function serializeProductDocument(document: ProductDocument): Product {
  return serializeProductMasterDocument("product", document) as Product;
}

export function serializeProductIdentifierDocument(
  document: ProductIdentifierDocument,
): ProductIdentifier {
  return serializeProductMasterDocument(
    "product_identifier",
    document,
  ) as ProductIdentifier;
}

export function serializeProductAliasDocument(
  document: ProductAliasDocument,
): ProductAlias {
  return serializeProductMasterDocument(
    "product_alias",
    document,
  ) as ProductAlias;
}

function toDocument(
  entityType: string,
  entity: ProductMasterEntity,
  version: number,
  createdAt: Date,
  updatedAt: Date,
): ProductMasterDocument {
  const common = {
    _id: entity.id,
    storeId: entity.storeId,
    schemaVersion: 1,
    version,
    createdAt,
    updatedAt,
    deletedAt: entity.deletedAt ? new Date(entity.deletedAt) : null,
  };
  if (entityType === "product") {
    const product = entity as Product;
    return {
      ...common,
      label: product.label,
      category: product.category,
      nature: product.nature,
      salesUnit: product.salesUnit,
      packaging: product.packaging
        ? {
            quantity: Decimal128.fromString(product.packaging.quantity),
            unit: product.packaging.unit,
            sourceLabel: product.packaging.sourceLabel ?? null,
          }
        : null,
      familyId: product.familyId ?? null,
      subfamilyId: product.subfamilyId ?? null,
      status: product.status,
    };
  }
  if (entityType === "product_identifier") {
    const identifier = entity as ProductIdentifier;
    return {
      ...common,
      productId: identifier.productId,
      type: identifier.type,
      value: identifier.value,
      source: identifier.source,
      status: identifier.status,
    };
  }
  const alias = entity as ProductAlias;
  return {
    ...common,
    productId: alias.productId,
    alias: alias.alias,
    normalizedAlias: alias.normalizedAlias,
    source: alias.source,
    status: alias.status,
    confidence: alias.confidence ?? null,
  };
}

function conflict(
  command: SyncCommand,
  existing: ProductMasterDocument | null,
  actualVersion: number | null,
  requestId: string,
): ProductCommandOutcome {
  return {
    resultStatus: "CONFLICT",
    resultingVersion: actualVersion,
    responseJson: {
      ...(existing
        ? {
            remoteEntity: serializeProductMasterDocument(
              command.entityType,
              existing,
            ),
          }
        : {}),
      error: publicError(
        "SYNC_VERSION_CONFLICT",
        "Cette donnée a été modifiée sur un autre appareil.",
        requestId,
      ),
    },
  };
}

function rejected(code: string, messageFr: string, requestId: string) {
  return {
    resultStatus: "REJECTED" as const,
    resultingVersion: null,
    responseJson: { error: publicError(code, messageFr, requestId) },
  };
}

function publicError(code: string, messageFr: string, requestId: string) {
  return { code, messageFr, retryable: false, requestId };
}

function descriptorFor(command: SyncCommand) {
  const descriptors = {
    PRODUCT_UPSERT: {
      collection: "products",
      entityType: "product",
      operation: "UPSERT",
      schema: productSchema,
    },
    PRODUCT_DELETE: {
      collection: "products",
      entityType: "product",
      operation: "DELETE",
      schema: productSchema,
    },
    PRODUCT_IDENTIFIER_UPSERT: {
      collection: "productIdentifiers",
      entityType: "product_identifier",
      operation: "UPSERT",
      schema: productIdentifierSchema,
    },
    PRODUCT_IDENTIFIER_DELETE: {
      collection: "productIdentifiers",
      entityType: "product_identifier",
      operation: "DELETE",
      schema: productIdentifierSchema,
    },
    PRODUCT_ALIAS_UPSERT: {
      collection: "productAliases",
      entityType: "product_alias",
      operation: "UPSERT",
      schema: productAliasSchema,
    },
    PRODUCT_ALIAS_DELETE: {
      collection: "productAliases",
      entityType: "product_alias",
      operation: "DELETE",
      schema: productAliasSchema,
    },
  } as const;
  return descriptors[command.type as keyof typeof descriptors];
}
