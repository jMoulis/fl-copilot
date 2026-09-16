import type { Db } from "mongodb";

export type DatabaseStatus = "connected" | "disconnected";

export interface DatabaseService {
  checkHealth(): Promise<DatabaseStatus>;
  getDb(): Promise<Db>;
  close(): Promise<void>;
}
