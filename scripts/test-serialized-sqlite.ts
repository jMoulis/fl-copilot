import type { DatabaseSync } from "node:sqlite";
import { VisualTestDatabase } from "./test-visual-sqlite";
import { serializeLocalWrites } from "../apps/mobile/src/db/serialized-writes";
/** Match Expo's independent, unwrapped transaction connection while sharing the real writer queue. */
export class SerializedTestDatabase extends VisualTestDatabase {
  readonly transaction = new VisualTestDatabase(this.raw);
  override async withExclusiveTransactionAsync(
    task: (tx: VisualTestDatabase) => Promise<void>,
  ) {
    await this.transaction.withExclusiveTransactionAsync(task);
  }
}
export function serializedTestDatabase(raw: DatabaseSync) {
  return serializeLocalWrites(new SerializedTestDatabase(raw));
}
