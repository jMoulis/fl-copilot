import type { SQLiteDatabase } from "expo-sqlite";

type WritableDatabase = Pick<
  SQLiteDatabase,
  | "execAsync"
  | "runAsync"
  | "getFirstAsync"
  | "getAllAsync"
  | "withExclusiveTransactionAsync"
>;
type Enqueue = <R>(work: () => Promise<R>) => Promise<R>;
const configured = new WeakMap<object, Enqueue>();
/** Also serialize native SQLite backups with the existing application writers. */
export function withSerializedDatabaseTask<R>(
  database: object,
  work: () => Promise<R>,
) {
  const enqueue = configured.get(database);
  if (!enqueue) throw new Error("LOCAL_DATABASE_NOT_SERIALIZED");
  return enqueue(work);
}
/** Expo exclusive transactions open independent connections. Queue app writers
 * together so imports, sync and recomputation cannot compete for SQLite's writer.
 * Reads stay concurrent under WAL; work inside a transaction must use its txn.
 */
export function serializeLocalWrites<T extends WritableDatabase>(
  database: T,
): T {
  if (configured.has(database)) return database;
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <R>(work: () => Promise<R>): Promise<R> => {
    const result = tail.then(work);
    // A failed transaction must release the next writer, without replaying work.
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  configured.set(database, enqueue);
  for (const name of [
    "execAsync",
    "runAsync",
    "getFirstAsync",
    "getAllAsync",
  ] as const) {
    const original = database[name];
    Object.defineProperty(database, name, {
      configurable: true,
      writable: true,
      value: (...args: unknown[]) => {
        const work = () =>
          Reflect.apply(original, database, args) as Promise<unknown>;
        // getFirstAsync also runs INSERT ... RETURNING for Outbox sequences.
        // Only plain reads may bypass the writer queue; unknown SQL is queued.
        return (name === "getFirstAsync" || name === "getAllAsync") &&
          typeof args[0] === "string" &&
          /^\s*(SELECT|EXPLAIN)\b/i.test(args[0])
          ? work()
          : enqueue(work);
      },
    });
  }
  const exclusive = database.withExclusiveTransactionAsync.bind(database);
  database.withExclusiveTransactionAsync = (task) =>
    enqueue(() =>
      exclusive(async (transaction) => {
        // busy_timeout is connection-local: Expo creates a fresh connection here.
        await transaction.execAsync("PRAGMA busy_timeout = 5000;");
        await task(transaction);
      }),
    );
  return database;
}
