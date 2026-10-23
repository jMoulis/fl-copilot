import {
  normalizeProductLabel,
  type ProductIdentifier,
} from "@fl-copilot/domain";
import { ProductMasterRepository } from "../products/product-master-repository";
import {
  emptyProductDraft,
  saveProductEditor,
  productMutationExpectedRemoteVersion,
} from "../products/product-editor-service";
import {
  joinedMutationDatabase,
  type AtomicMutationDatabase,
} from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { MercalysImportValidationSummary } from "./mercalys-import-validation";

export interface MercalysProductResolution {
  key: string;
  label: string;
  identifiers: Array<Pick<ProductIdentifier, "type" | "value">>;
  sourceIndexes: number[];
  candidateProductIds: string[];
  canCreate: boolean;
  canCreateAsDistinct: boolean;
  /** Explicit review of an existing automatic association, never a bulk action. */
  expectedProductIds?: string[];
}

interface ResolutionOptions {
  storeId: string;
  deviceId: string;
  now(): string;
  generateId(): string;
}

export function buildMercalysProductResolutions(
  summary: MercalysImportValidationSummary,
  reviewSourceIndex?: number,
): MercalysProductResolution[] {
  const selected = summary.lines.find(
    (l) => l.record.sourceIndex === reviewSourceIndex,
  );
  const selectedKey =
    selected?.match.state === "AUTO_MATCH"
      ? resolutionKey(selected.record)
      : undefined;
  const groups = new Map<string, MercalysImportValidationSummary["lines"]>();
  for (const line of summary.lines) {
    const key = resolutionKey(line.record);
    if (line.match.state === "AUTO_MATCH" && key !== selectedKey) continue;
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }

  const resolutions = [...groups.entries()]
    .map(([key, lines]) => {
      const first = lines[0];
      if (!first) throw new Error("Empty Mercalys resolution group.");
      const identifiers = uniqueIdentifiers(
        lines.flatMap(({ record }) => [
          ...(record.itm8
            ? [{ type: "ITM8" as const, value: record.itm8 }]
            : []),
          ...(record.ean ? [{ type: "EAN" as const, value: record.ean }] : []),
        ]),
      );
      const normalizedLabels = new Set(
        lines.map(({ record }) => normalizeProductLabel(record.rawLabel)),
      );
      const candidateProductIds = [
        ...new Set(
          lines.flatMap(({ match }) => [
            ...match.candidates.map(({ productId }) => productId),
            ...(key === selectedKey && match.matchedProductId
              ? [match.matchedProductId]
              : []),
          ]),
        ),
      ];
      const hasStableIdentity =
        identifiers.length > 0 && normalizedLabels.size === 1;
      return {
        key,
        label: first.record.rawLabel,
        identifiers,
        sourceIndexes: lines.map(({ record }) => record.sourceIndex),
        candidateProductIds,
        canCreate:
          hasStableIdentity &&
          lines.every(({ match }) => match.state === "NO_MATCH"),
        ...(key === selectedKey
          ? {
              expectedProductIds: [
                ...new Set(
                  lines.flatMap(({ match }) =>
                    match.matchedProductId ? [match.matchedProductId] : [],
                  ),
                ),
              ].sort(),
            }
          : {}),
        canCreateAsDistinct:
          hasStableIdentity &&
          (key === selectedKey ||
            lines.every(
              ({ match }) =>
                match.state !== "AUTO_MATCH" &&
                match.method !== "EXACT_IDENTIFIER",
            )),
      };
    })
    .sort((left, right) =>
      left.label.localeCompare(right.label, "fr", { sensitivity: "base" }),
    );
  const identifierOwners = new Map<string, Set<string>>();
  for (const { record } of summary.lines) {
    const keyOwner = resolutionKey(record);
    for (const identifier of [
      ...(record.itm8 ? [{ type: "ITM8", value: record.itm8 }] : []),
      ...(record.ean ? [{ type: "EAN", value: record.ean }] : []),
    ]) {
      const key = `${identifier.type}:${identifier.value}`;
      identifierOwners.set(
        key,
        new Set(identifierOwners.get(key)).add(keyOwner),
      );
    }
  }
  return resolutions.map((resolution) => {
    const identifiersAreUnique = resolution.identifiers.every(
      (identifier) =>
        identifierOwners.get(`${identifier.type}:${identifier.value}`)?.size ===
        1,
    );
    return {
      ...resolution,
      canCreate: resolution.canCreate && identifiersAreUnique,
      canCreateAsDistinct:
        resolution.canCreateAsDistinct && identifiersAreUnique,
    };
  });
}

export async function createMercalysProducts(
  repository: ProductMasterRepository,
  resolutions: readonly MercalysProductResolution[],
  options: ResolutionOptions,
  onProgress?: (completed: number, total: number) => void,
  allowExplicitDistinct = false,
) {
  const creatable = resolutions.filter(
    ({ canCreate, canCreateAsDistinct }) =>
      canCreate || (allowExplicitDistinct && canCreateAsDistinct),
  );
  let completed = 0;
  for (const resolution of creatable) {
    await saveProductEditor(
      repository,
      {
        ...emptyProductDraft,
        label: resolution.label,
        identifiers: resolution.identifiers,
      },
      {
        ...options,
        identifierSource: "MERCALYS",
      },
    );
    completed += 1;
    onProgress?.(completed, creatable.length);
  }
  return completed;
}

export async function confirmMercalysProductMapping(
  repository: ProductMasterRepository,
  resolution: MercalysProductResolution,
  productId: string,
  options: ResolutionOptions,
) {
  const timestamp = options.now();
  const existingIdentifiers = await repository.listIdentifiersByStore(
    options.storeId,
  );
  for (const identifier of resolution.identifiers) {
    const matching = existingIdentifiers.filter(
      ({ entity }) =>
        entity.type === identifier.type && entity.value === identifier.value,
    );
    const retained = matching.find(
      ({ entity }) => entity.productId === productId,
    );
    for (const conflicting of matching) {
      if (conflicting.entity.id === retained?.entity.id) continue;
      await repository.delete(
        "product_identifier",
        conflicting.entity.id,
        options.storeId,
        timestamp,
        {
          commandId: options.generateId(),
          deviceId: options.deviceId,
          expectedRemoteVersion:
            productMutationExpectedRemoteVersion(conflicting),
        },
      );
    }
    if (retained) continue;
    await repository.upsertIdentifier(
      {
        id: options.generateId(),
        storeId: options.storeId,
        productId,
        ...identifier,
        source: "MERCALYS",
        status: "VALIDATED",
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      },
      {
        commandId: options.generateId(),
        deviceId: options.deviceId,
        expectedRemoteVersion: null,
      },
    );
  }

  if (resolution.identifiers.length > 0) return;

  const normalizedAlias = normalizeProductLabel(resolution.label);
  const existingAliases = await repository.listAliasesByStore(options.storeId);
  const matchingAliases = existingAliases.filter(
    ({ entity }) => entity.normalizedAlias === normalizedAlias,
  );
  const retainedAlias = matchingAliases.find(
    ({ entity }) => entity.productId === productId,
  );
  for (const conflicting of matchingAliases) {
    if (conflicting.entity.id === retainedAlias?.entity.id) continue;
    await repository.delete(
      "product_alias",
      conflicting.entity.id,
      options.storeId,
      timestamp,
      {
        commandId: options.generateId(),
        deviceId: options.deviceId,
        expectedRemoteVersion:
          productMutationExpectedRemoteVersion(conflicting),
      },
    );
  }
  if (retainedAlias) return;
  await repository.upsertAlias(
    {
      id: options.generateId(),
      storeId: options.storeId,
      productId,
      alias: resolution.label,
      normalizedAlias,
      source: "MERCALYS",
      status: "VALIDATED",
      confidence: 1,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    },
    {
      commandId: options.generateId(),
      deviceId: options.deviceId,
      expectedRemoteVersion: null,
    },
  );
}

/** A reviewed correction, its product and all identity commands commit together. */
export async function correctMercalysProductMapping(
  database: OutboxDatabase & AtomicMutationDatabase,
  resolution: MercalysProductResolution,
  targetProductId: string | null,
  options: ResolutionOptions,
) {
  await database.withExclusiveTransactionAsync(async (tx) => {
    const repository = new ProductMasterRepository(joinedMutationDatabase(tx));
    const identifiers = await repository.listIdentifiersByStore(
      options.storeId,
    );
    const owners = identifiers.filter(({ entity }) =>
      resolution.identifiers.some(
        (i) => i.type === entity.type && i.value === entity.value,
      ),
    );
    if (
      resolution.expectedProductIds &&
      owners.some(
        ({ entity }) =>
          !resolution.expectedProductIds!.includes(entity.productId),
      )
    )
      throw Error("MERCALYS_MAPPING_CHANGED");
    const involved = [
      ...new Set([
        ...owners.map(({ entity }) => entity.productId),
        ...(targetProductId ? [targetProductId] : []),
      ]),
    ];
    for (const productId of involved) {
      const product = await repository.getProduct(productId);
      if (
        !product ||
        product.entity.storeId !== options.storeId ||
        product.entity.deletedAt ||
        product.entity.status !== "ACTIVE"
      )
        throw Error("MERCALYS_MAPPING_CHANGED");
      const conflict = await tx.getFirstAsync<{ id: string }>(
        `SELECT c.id FROM sync_conflicts c
         LEFT JOIN product_identifiers pi ON c.entity_type='product_identifier' AND pi.id=c.entity_id
         WHERE c.store_id=? AND c.status='OPEN' AND
          ((c.entity_type='product' AND c.entity_id=?) OR (c.entity_type='product_identifier' AND pi.product_id=?)) LIMIT 1`,
        options.storeId,
        productId,
        productId,
      );
      if (conflict) throw Error("MERCALYS_MAPPING_CONFLICT");
    }
    let productId = targetProductId;
    if (!productId) {
      if (!resolution.canCreateAsDistinct || !resolution.expectedProductIds)
        throw Error("MERCALYS_DISTINCT_REVIEW_REQUIRED");
      productId = await saveProductEditor(
        repository,
        { ...emptyProductDraft, label: resolution.label },
        options,
      );
    }
    await confirmMercalysProductMapping(
      repository,
      resolution,
      productId,
      options,
    );
  });
}

function resolutionKey(record: {
  itm8: string | null;
  ean: string | null;
  sourceIndex: number;
}) {
  if (record.itm8) return `ITM8:${record.itm8}`;
  if (record.ean) return `EAN:${record.ean}`;
  return `ROW:${record.sourceIndex}`;
}

function uniqueIdentifiers(
  identifiers: Array<Pick<ProductIdentifier, "type" | "value">>,
) {
  return [
    ...new Map(
      identifiers.map((identifier) => [
        `${identifier.type}:${identifier.value}`,
        identifier,
      ]),
    ).values(),
  ];
}
