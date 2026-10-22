import type { SyncSummary } from "./sync-service";

const pipelines = new WeakMap<
  object,
  Map<string, Promise<SyncSummary | undefined>>
>();
/** Share the entire upload/push/pull/recompute cycle, not only the network push. */
export function runSyncPipeline(
  database: object,
  ownerId: string,
  storeId: string,
  work: () => Promise<SyncSummary | undefined>,
) {
  let cycles = pipelines.get(database);
  if (!cycles) {
    cycles = new Map();
    pipelines.set(database, cycles);
  }
  const key = JSON.stringify([ownerId, storeId]),
    active = cycles.get(key);
  if (active) return active;
  const cycle = Promise.resolve()
    .then(work)
    .finally(() => {
      if (cycles.get(key) === cycle) cycles.delete(key);
    });
  cycles.set(key, cycle);
  return cycle;
}
