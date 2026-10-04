export interface StoreSnapshot<T> {
  storeId: string;
  value: T;
}

export function visibleStoreSnapshot<T>(
  snapshot: StoreSnapshot<T> | undefined,
  storeId: string | undefined,
): T | undefined {
  return snapshot && storeId && snapshot.storeId === storeId
    ? snapshot.value
    : undefined;
}
