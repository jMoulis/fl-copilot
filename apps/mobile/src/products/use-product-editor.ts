import { useCallback, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { randomUUID } from "expo-crypto";
import { useAuth } from "../auth/auth-provider";
import { useLocalDatabase } from "../providers/database-provider";
import { useSync } from "../sync/sync-provider";
import { ProductMasterRepository } from "./product-master-repository";
import {
  loadProductEditorSnapshot,
  saveProductEditorLocally,
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
  const { pendingCount, conflictCount, lastSyncedAt } = useSync();
  const storeId = session?.stores[0]?.storeId;
  const repository = useMemo(
    () => new ProductMasterRepository(sqlite),
    [sqlite],
  );
  const request = useRef(0);
  const [error, setError] = useState<string>();
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const ticket = ++request.current;
    if (!storeId) {
      setProducts([]);
      setLoading(false);
      return;
    }
    try {
      const [records, identifiers, aliases, conflicts] = await Promise.all([
        repository.listProducts(storeId),
        repository.listIdentifiersByStore(storeId),
        repository.listAliasesByStore(storeId),
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
      if (ticket !== request.current) return;
      const terms = new Map<string, string[]>();
      for (const { entity: e } of [...identifiers, ...aliases]) {
        if (e.status !== "VALIDATED") continue;
        const entry = terms.get(e.productId) ?? [];
        entry.push("value" in e ? e.value : e.alias);
        terms.set(e.productId, entry);
      }
      const conflictByProduct = new Map(
        conflicts.map((conflict) => [conflict.product_id, conflict.id]),
      );
      setProducts(
        records.map((record) => ({
          record,
          conflictId: conflictByProduct.get(record.entity.id),
          searchTerms: terms.get(record.entity.id) ?? [],
        })),
      );
      setError(undefined);
    } catch {
      if (ticket === request.current)
        setError(
          "Les produits ne peuvent pas être relus. Les données déjà affichées sont conservées.",
        );
    } finally {
      if (ticket === request.current) setLoading(false);
    }
  }, [repository, sqlite, storeId]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      return () => {
        request.current++;
      };
    }, [refresh, pendingCount, conflictCount, lastSyncedAt]),
  );
  return { loading, storeMissing: !storeId, products, error, refresh };
}

export function useProductEditor(productId?: string): ProductEditorState {
  const database = useLocalDatabase();
  const { session } = useAuth();
  const { pendingCount, conflictCount, lastSyncedAt } = useSync();
  const storeId = session?.stores[0]?.storeId;
  const repository = useMemo(
    () => new ProductMasterRepository(database.sqlite),
    [database.sqlite],
  );
  const generation = useRef(0);
  const [error, setError] = useState<string>();
  const [snapshot, setSnapshot] = useState<ProductEditorSnapshot>();
  const [conflictId, setConflictId] = useState<string>();
  const [loading, setLoading] = useState(Boolean(productId));
  const [missing, setMissing] = useState(false);

  const refresh = useCallback(async () => {
    const ticket = ++generation.current;
    if (!productId || !storeId) {
      setLoading(false);
      setMissing(false);
      return;
    }
    try {
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
          WHERE c.store_id = ? AND c.status = 'OPEN' AND (
            (c.entity_type = 'product' AND c.entity_id = ?)
            OR (c.entity_type = 'product_identifier' AND pi.product_id = ?)
            OR (c.entity_type = 'product_alias' AND pa.product_id = ?)
          )
          ORDER BY c.created_at DESC LIMIT 1
        `,
          storeId,
          productId,
          productId,
          productId,
        ),
      ]);
      if (ticket !== generation.current) return;
      const owned =
        nextSnapshot?.product.entity.storeId === storeId ? nextSnapshot : null;
      setSnapshot(owned ?? undefined);
      setMissing(!owned);
      setConflictId(conflict?.id);
      setError(undefined);
    } catch {
      if (ticket === generation.current)
        setError(
          "La fiche ne peut pas être relue. Votre saisie reste conservée.",
        );
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  }, [database.sqlite, productId, repository, storeId]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      return () => {
        generation.current++;
      };
    }, [refresh, pendingCount, conflictCount, lastSyncedAt]),
  );

  const save = useCallback(
    async (draft: ProductEditorDraft, expected?: ProductEditorSnapshot) => {
      if (!storeId) throw new Error("Aucun magasin actif.");
      return saveProductEditorLocally(
        database.sqlite,
        draft,
        {
          storeId,
          deviceId: database.deviceId,
          productId,
          now: () => new Date().toISOString(),
          generateId: randomUUID,
        },
        expected,
      );
    },
    [database, productId, storeId],
  );

  return {
    loading,
    missing,
    storeMissing: !storeId,
    snapshot,
    conflictId,
    error,
    save,
  };
}
