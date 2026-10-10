import { lookupSubstitutes } from "@fl-copilot/substitution-core";
import { ProductMasterRepository } from "../products/product-master-repository";
import { ProductSubstitutionRepository } from "./substitution-repository";
import { StoreProductEventRepository } from "./store-event-repository";
import { NeedUnitRepository } from "./repository";
import { substitutionIdentifierLabels } from "./substitution-details";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
export const substituteReadOnly = () => {
  throw Error("SUBSTITUTE_LOOKUP_READ_ONLY");
};
export class SubstituteLookupRepository {
  constructor(private db: AtomicMutationDatabase) {}
  async read(
    storeId: string,
    productId: string,
    needUnitId?: string,
    at = new Date().toISOString(),
  ) {
    let snapshot: Awaited<ReturnType<typeof readSnapshot>> | undefined;
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      snapshot = await readSnapshot(tx, storeId, productId, needUnitId, at);
    });
    if (!snapshot) throw Error("SUBSTITUTE_LOOKUP_SNAPSHOT_MISSING");
    return snapshot;
  }
}
async function readSnapshot(
  tx: OutboxDatabase,
  storeId: string,
  productId: string,
  needUnitId: string | undefined,
  at: string,
) {
  const reader = substituteReadOnlyReader(tx);
  const products = new ProductMasterRepository(reader);
  const [p, n, r, e, identifiers] = await Promise.all([
    products.listProducts(storeId),
    new NeedUnitRepository(reader).list(storeId),
    new ProductSubstitutionRepository(reader, async () =>
      substituteReadOnly(),
    ).forSource(storeId, productId),
    new StoreProductEventRepository(reader).list(storeId),
    products.listIdentifiersByStore(storeId),
  ]);
  return {
    result: lookupSubstitutes({
      storeId,
      productId,
      needUnitId,
      at,
      products: p,
      needs: n,
      relations: r,
      events: e,
    }),
    source: p.find((p) => p.entity.id === productId)?.entity,
    labels: Object.fromEntries(p.map((p) => [p.entity.id, p.entity.label])),
    identifiers: substitutionIdentifierLabels(
      identifiers.filter((i) => !i.entity.deletedAt).map((i) => i.entity),
    ),
    needs: n
      .filter(
        (n) =>
          n.entity.status === "ACTIVE" &&
          r.some((r) => r.entity.needUnitId === n.entity.id),
      )
      .map((n) => n.entity),
  };
}

export function substituteReadOnlyReader(
  tx: OutboxDatabase,
): OutboxDatabase & AtomicMutationDatabase {
  return {
    getFirstAsync: tx.getFirstAsync.bind(tx),
    getAllAsync: tx.getAllAsync.bind(tx),
    runAsync: async () => substituteReadOnly(),
    withExclusiveTransactionAsync: async () => substituteReadOnly(),
  };
}
