import { useCallback, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { useLocalDatabase } from "../providers/database-provider";
import { WasteReceiptRepository } from "./waste-receipt-repository";
import {
  loadReceiptProductTarget,
  receiptProductError,
  type ReceiptProductOrigin,
} from "./receipt-product-selection";

export function useReceiptProductTarget(
  origin: ReceiptProductOrigin,
  storeId: string,
) {
  const { sqlite } = useLocalDatabase();
  const repository = useMemo(
    () => new WasteReceiptRepository(sqlite),
    [sqlite],
  );
  const [target, setTarget] =
    useState<Awaited<ReturnType<typeof loadReceiptProductTarget>>>();
  const [error, setError] = useState<string>();
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const { receiptId, lineId } = origin;
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setAvailable(false);
    setLoading(true);
    try {
      const next = await loadReceiptProductTarget(repository, storeId, {
        receiptId,
        lineId,
      });
      if (generation.current !== request) return;
      setTarget(next);
      setError(undefined);
      setAvailable(true);
    } catch (reason) {
      if (generation.current === request) setError(receiptProductError(reason));
    } finally {
      if (generation.current === request) setLoading(false);
    }
  }, [repository, storeId, receiptId, lineId]);
  useFocusEffect(
    useCallback(() => {
      void refresh();
      return () => {
        generation.current++;
      };
    }, [refresh]),
  );
  return { target, error, available, loading, refresh, repository };
}
