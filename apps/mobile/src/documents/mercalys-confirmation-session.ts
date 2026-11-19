import {
  normalizeProductLabel,
  type ProductMatchCatalog,
} from "@fl-copilot/domain";
import { ProductMasterRepository } from "../products/product-master-repository";
import {
  joinedMutationDatabase,
  type AtomicMutationDatabase,
} from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
import {
  confirmMercalysProductMapping,
  correctMercalysProductMapping,
  createMercalysProducts,
  type MercalysProductResolution,
} from "./mercalys-product-resolution";

export class MercalysConfirmationSession {
  private key: string;
  constructor(
    private db: OutboxDatabase,
    storeId: string,
    ownerId: string,
    checksum: string,
  ) {
    this.key = `mercalys-confirmations:v1:${storeId}:${ownerId}:${checksum}`;
  }
  async pending() {
    return !!(await this.db.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_metadata WHERE key=?",
      this.key,
    ));
  }
  async begin() {
    await this.db.runAsync(
      "INSERT INTO app_metadata(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET updated_at=excluded.updated_at",
      this.key,
      "pending",
      new Date().toISOString(),
    );
  }
  async finish() {
    await this.db.runAsync("DELETE FROM app_metadata WHERE key=?", this.key);
  }
}

/** Revalidate the reviewed identity within the same transaction as its writes.
 * No full file matching and no source publication is performed here.
 */
export async function commitMercalysResolution(
  db: OutboxDatabase & AtomicMutationDatabase,
  resolution: MercalysProductResolution,
  targetProductId: string | null,
  reviewed: ProductMatchCatalog,
  options: {
    storeId: string;
    deviceId: string;
    now(): string;
    generateId(): string;
    assertCurrent?(): void;
  },
) {
  await db.withExclusiveTransactionAsync(async (tx) => {
    options.assertCurrent?.();
    const joined = joinedMutationDatabase(tx);
    const repo = new ProductMasterRepository(joined);
    const identifiers = await repo.findIdentifiersByCodes(
      options.storeId,
      resolution.identifiers,
    );
    const aliases = await repo.listAliasesByStore(options.storeId);
    const relevant = (catalog: ProductMatchCatalog) =>
      JSON.stringify([
        catalog.identifiers
          .filter(
            (i) =>
              !i.deletedAt &&
              resolution.identifiers.some(
                (c) => c.type === i.type && c.value === i.value,
              ),
          )
          .map((i) => [i.productId, i.type, i.value, i.status])
          .sort(),
        catalog.aliases
          .filter(
            (a) =>
              !a.deletedAt &&
              a.normalizedAlias === normalizeProductLabel(resolution.label),
          )
          .map((a) => [a.productId, a.normalizedAlias, a.status])
          .sort(),
      ]);
    if (
      relevant(reviewed) !==
      relevant({
        products: [],
        identifiers: identifiers.map((r) => r.entity),
        aliases: aliases.map((r) => r.entity),
      })
    )
      throw Error("MERCALYS_MAPPING_CHANGED");
    const owners = identifiers.filter((r) =>
      resolution.identifiers.some(
        (c) => c.type === r.entity.type && c.value === r.entity.value,
      ),
    );
    for (const id of new Set([
      ...owners.map((r) => r.entity.productId),
      ...(targetProductId ? [targetProductId] : []),
    ])) {
      const p = await repo.getProduct(id);
      if (
        !p ||
        p.entity.storeId !== options.storeId ||
        p.entity.status !== "ACTIVE" ||
        p.entity.deletedAt ||
        ["ERROR", "CONFLICT"].includes(p.syncState)
      )
        throw Error("MERCALYS_MAPPING_CHANGED");
    }
    if (owners.some((r) => ["ERROR", "CONFLICT"].includes(r.syncState)))
      throw Error("MERCALYS_MAPPING_CHANGED");
    if (resolution.expectedProductIds) {
      await correctMercalysProductMapping(
        joined,
        resolution,
        targetProductId,
        options,
      );
    } else if (targetProductId) {
      await confirmMercalysProductMapping(
        repo,
        resolution,
        targetProductId,
        options,
      );
    } else {
      if (
        owners.length ||
        !(resolution.canCreate || resolution.canCreateAsDistinct)
      )
        throw Error("MERCALYS_CREATION_REVIEW_REQUIRED");
      await createMercalysProducts(
        repo,
        [resolution],
        options,
        undefined,
        true,
      );
    }
    options.assertCurrent?.();
  });
}
