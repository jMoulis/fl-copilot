import { z } from "zod";
const tails = new Map<string, Promise<void>>();
/** Native file installation + its SQLite proof share this gate with cache eviction.
 * Always acquire the file gate before opening a SQLite transaction, never the reverse.
 */
export async function withVisualFiles<T>(
  storeId: string,
  work: () => Promise<T>,
): Promise<T> {
  z.uuid().parse(storeId);
  const before = tails.get(storeId) ?? Promise.resolve();
  const task = before.then(work),
    tail = task.then(
      () => undefined,
      () => undefined,
    );
  tails.set(storeId, tail);
  try {
    return await task;
  } finally {
    if (tails.get(storeId) === tail) tails.delete(storeId);
  }
}
