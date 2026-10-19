import { DatabaseSync } from "node:sqlite";
import type { OutboxDatabase } from "../apps/mobile/src/sync/outbox-repository";
export class VisualTestDatabase implements OutboxDatabase {
  constructor(readonly raw: DatabaseSync) {}
  async getFirstAsync<T>(sql: string, ...p: (string | number | null)[]) {
    return (this.raw.prepare(sql).get(...p) as T) ?? null;
  }
  async getAllAsync<T>(sql: string, ...p: (string | number | null)[]) {
    return this.raw.prepare(sql).all(...p) as T[];
  }
  async runAsync(sql: string, ...p: (string | number | null)[]) {
    return this.raw.prepare(sql).run(...p);
  }
  async execAsync(sql: string) {
    this.raw.exec(sql);
  }
  async withExclusiveTransactionAsync(
    task: (db: OutboxDatabase) => Promise<void>,
  ) {
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      await task(this);
      this.raw.exec("COMMIT");
    } catch (e) {
      this.raw.exec("ROLLBACK");
      throw e;
    }
  }
}
