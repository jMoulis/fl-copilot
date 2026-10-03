import {
  normalizeProductLabel,
  type ProductIdentifier,
} from "@fl-copilot/domain";
import type { ProductMasterRepository } from "../products/product-master-repository";
import {
  emptyProductDraft,
  saveProductEditor,
} from "../products/product-editor-service";
import type { MercalysImportValidationSummary } from "./mercalys-import-validation";

export interface MercalysProductResolution {
  key: string;
  label: string;
  identifiers: Array<Pick<ProductIdentifier, "type" | "value">>;
  sourceIndexes: number[];
  candidateProductIds: string[];
  canCreate: boolean;
}

interface ResolutionOptions {
  storeId: string;
  deviceId: string;
  now(): string;
  generateId(): string;
}

export function buildMercalysProductResolutions(
  summary: MercalysImportValidationSummary,
): MercalysProductResolution[] {
  const groups = new Map<string, MercalysImportValidationSummary["lines"]>();
  for (const line of summary.lines) {
    if (line.match.state === "AUTO_MATCH") continue;
    const key = resolutionKey(line.record);
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
          lines.flatMap(({ match }) =>
            match.candidates.map(({ productId }) => productId),
          ),
        ),
      ];
      return {
        key,
        label: first.record.rawLabel,
        identifiers,
        sourceIndexes: lines.map(({ record }) => record.sourceIndex),
        candidateProductIds,
        canCreate:
          identifiers.length > 0 &&
          normalizedLabels.size === 1 &&
          lines.every(({ match }) => match.state === "NO_MATCH"),
      };
    })
    .sort((left, right) =>
      left.label.localeCompare(right.label, "fr", { sensitivity: "base" }),
    );
  const identifierOwners = new Map<string, Set<string>>();
  for (const resolution of resolutions) {
    for (const identifier of resolution.identifiers) {
      const key = `${identifier.type}:${identifier.value}`;
      identifierOwners.set(
        key,
        new Set(identifierOwners.get(key)).add(resolution.key),
      );
    }
  }
  return resolutions.map((resolution) => ({
    ...resolution,
    canCreate:
      resolution.canCreate &&
      resolution.identifiers.every(
        (identifier) =>
          identifierOwners.get(`${identifier.type}:${identifier.value}`)
            ?.size === 1,
      ),
  }));
}

export async function createMercalysProducts(
  repository: ProductMasterRepository,
  resolutions: readonly MercalysProductResolution[],
  options: ResolutionOptions,
  onProgress?: (completed: number, total: number) => void,
) {
  const creatable = resolutions.filter(({ canCreate }) => canCreate);
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
  for (const identifier of resolution.identifiers) {
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
