import { useCallback, useEffect, useMemo, useState } from "react";
import { randomUUID } from "expo-crypto";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { ProductMasterRepository } from "./product-master-repository";
import {
  loadProductEditorSnapshot,
  saveProductEditor,
  type ProductEditorDraft,
  type ProductEditorSnapshot,
} from "./product-editor-service";
import type {
  ProductEditorState,
  ProductListItem,
  ProductListState,
} from "./product-editor-hooks.types";

export function useProductList(): ProductListState {
  const { sqlite } = useLocalDatabase();
  const { session } = useAuth();
  const { pendingCount, conflictCount } = useSync();
  const storeId = session?.stores[0]?.storeId;
  const repository = useMemo(
    () => new ProductMasterRepository(sqlite),
    [sqlite],
  );
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!storeId) {
      setProducts([]);
      setLoading(false);
      return;
    }
    const [records, conflicts] = await Promise.all([
      repository.listProducts(storeId),
      sqlite.getAllAsync<{ id: string; product_id: string }>(
        `
          SELECT c.id,
            CASE c.entity_type
              WHEN 'product' THEN c.entity_id
              WHEN 'product_identifier' THEN pi.product_id
              WHEN 'product_alias' THEN pa.product_id
            END AS product_id
          FROM sync_conflicts c
          LEFT JOIN product_identifiers pi
            ON c.entity_type = 'product_identifier' AND pi.id = c.entity_id
          LEFT JOIN product_aliases pa
            ON c.entity_type = 'product_alias' AND pa.id = c.entity_id
          WHERE c.store_id = ? AND c.status = 'OPEN'
            AND c.entity_type IN ('product', 'product_identifier', 'product_alias')
        `,
        storeId,
      ),
    ]);
    const conflictByProduct = new Map(
      conflicts.map((conflict) => [conflict.product_id, conflict.id]),
    );
    setProducts(
      records.map((record) => ({
        record,
        conflictId: conflictByProduct.get(record.entity.id),
      })),
    );
    setLoading(false);
  }, [repository, sqlite, storeId]);

  useEffect(() => {
    void refresh();
  }, [conflictCount, pendingCount, refresh]);

  return { loading, storeMissing: !storeId, products, refresh };
}

export function useProductEditor(productId?: string): ProductEditorState {
  const database = useLocalDatabase();
  const { session } = useAuth();
  const { pendingCount, conflictCount } = useSync();
  const storeId = session?.stores[0]?.storeId;
  const repository = useMemo(
    () => new ProductMasterRepository(database.sqlite),
    [database.sqlite],
  );
  const [snapshot, setSnapshot] = useState<ProductEditorSnapshot>();
  const [conflictId, setConflictId] = useState<string>();
  const [loading, setLoading] = useState(Boolean(productId));
  const [missing, setMissing] = useState(false);

  const refresh = useCallback(async () => {
    if (!productId) {
      setLoading(false);
      setMissing(false);
      return;
    }
    const [nextSnapshot, conflict] = await Promise.all([
      loadProductEditorSnapshot(repository, productId),
      database.sqlite.getFirstAsync<{ id: string }>(
        `
          SELECT c.id
          FROM sync_conflicts c
          LEFT JOIN product_identifiers pi
            ON c.entity_type = 'product_identifier' AND pi.id = c.entity_id
          LEFT JOIN product_aliases pa
            ON c.entity_type = 'product_alias' AND pa.id = c.entity_id
          WHERE c.status = 'OPEN' AND (
            (c.entity_type = 'product' AND c.entity_id = ?)
            OR (c.entity_type = 'product_identifier' AND pi.product_id = ?)
            OR (c.entity_type = 'product_alias' AND pa.product_id = ?)
          )
          ORDER BY c.created_at DESC LIMIT 1
        `,
        productId,
        productId,
        productId,
      ),
    ]);
    setSnapshot(nextSnapshot ?? undefined);
    setMissing(!nextSnapshot);
    setConflictId(conflict?.id);
    setLoading(false);
  }, [database.sqlite, productId, repository]);

  useEffect(() => {
    void refresh();
  }, [conflictCount, pendingCount, refresh]);

  const save = useCallback(
    async (draft: ProductEditorDraft) => {
      if (!storeId) throw new Error("Aucun magasin actif.");
      const savedId = await saveProductEditor(repository, draft, {
        storeId,
        deviceId: database.deviceId,
        productId,
        existing: snapshot,
        now: () => new Date().toISOString(),
        generateId: randomUUID,
      });
      return savedId;
    },
    [database.deviceId, productId, repository, snapshot, storeId],
  );

  return {
    loading,
    missing,
    storeMissing: !storeId,
    snapshot,
    conflictId,
    save,
  };
}
