import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { BootstrapResponse } from "@fl-copilot/sync-contracts";
import {
  runLocalMigrations,
  type SQLiteMigrationDatabase,
} from "../db/migrations";
import type { AtomicMutationDatabase } from "./atomic-local-mutation";
import { applyBootstrap } from "./apply-bootstrap";
import type { OutboxDatabase } from "./outbox-repository";

type SQLiteValue = string | number | null;

class NodeBootstrapDatabase
  implements SQLiteMigrationDatabase, OutboxDatabase, AtomicMutationDatabase
{
  beforeCommit: (() => void) | undefined;

  constructor(readonly database: DatabaseSync) {}

  async execAsync(sql: string) {
    this.database.exec(sql);
  }

  async getFirstAsync<T>(sql: string, ...params: SQLiteValue[]) {
    return (this.database.prepare(sql).get(...params) as T | undefined) ?? null;
  }

  async getAllAsync<T>(sql: string, ...params: SQLiteValue[]) {
    return this.database.prepare(sql).all(...params) as T[];
  }

  async runAsync(sql: string, ...params: SQLiteValue[]) {
    return this.database.prepare(sql).run(...params);
  }

  async withExclusiveTransactionAsync(
    task: (transaction: OutboxDatabase) => Promise<void>,
  ) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      await task(this);
      this.beforeCommit?.();
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

const temporaryDirectories: string[] = [];
const storeId = "11111111-1111-4111-8111-111111111111";
const entityId = "22222222-2222-4222-8222-222222222222";

function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "fl-copilot-bootstrap-"));
  temporaryDirectories.push(directory);
  const database = new DatabaseSync(join(directory, "local.db"));
  return { adapter: new NodeBootstrapDatabase(database), database };
}

function bootstrap(label: string, revision: string): BootstrapResponse {
  return {
    protocolVersion: 1,
    store: { id: storeId, name: "Magasin test", role: "MANAGER" },
    snapshotRevision: revision,
    cursor: `cursor-${revision}`,
    historyPolicy: { rawObservationDays: 90 },
    entities: {
      syncTestEntities: [
        {
          id: entityId,
          storeId,
          label,
          remoteVersion: 1,
          createdAt: "2026-09-26T08:00:00.000Z",
          updatedAt: "2026-09-26T08:01:00.000Z",
        },
      ],
      products: [],
      productIdentifiers: [],
      productAliases: [],
      needUnits: [],
      needMemberships: [],
      productSubstitutions: [],
      salesObservations: [],
      wasteObservations: [],
      commercialOperations: [],
      offers: [],
      marketSignals: [],
      executionInstructions: [],
      storeEvents: [],
      productDailyPerformance: [],
      departmentDailyPerformance: [],
      recommendations: [],
      decisions: [],
      actionExecutions: [],
    },
    serverTime: "2026-09-26T08:10:00.000Z",
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("atomic bootstrap application", () => {
  it("replaces the store snapshot and records its revision and cursor", async () => {
    const { adapter, database } = temporaryDatabase();
    await runLocalMigrations(adapter);
    database
      .prepare(
        `
          INSERT INTO sync_test_entities (
            id, store_id, label, remote_version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "33333333-3333-4333-8333-333333333333",
        storeId,
        "Ancienne donnée",
        1,
        "2026-09-25T08:00:00.000Z",
        "2026-09-25T08:00:00.000Z",
      );

    await applyBootstrap(adapter, storeId, bootstrap("Snapshot", "revision-1"));

    expect(
      database
        .prepare(
          `
            SELECT id, label, remote_version
            FROM sync_test_entities WHERE store_id = ?
          `,
        )
        .all(storeId),
    ).toEqual([{ id: entityId, label: "Snapshot", remote_version: 1 }]);
    expect(
      database
        .prepare(
          `
            SELECT cursor, bootstrap_revision, protocol_version
            FROM sync_inbox_state WHERE store_id = ?
          `,
        )
        .get(storeId),
    ).toEqual({
      cursor: "cursor-revision-1",
      bootstrap_revision: "revision-1",
      protocol_version: 1,
    });

    database.close();
  });

  it("retains the previous snapshot when the local commit fails", async () => {
    const { adapter, database } = temporaryDatabase();
    await runLocalMigrations(adapter);
    await applyBootstrap(adapter, storeId, bootstrap("Stable", "revision-1"));
    adapter.beforeCommit = () => {
      throw new Error("Simulated bootstrap commit failure.");
    };

    await expect(
      applyBootstrap(adapter, storeId, bootstrap("Incomplet", "revision-2")),
    ).rejects.toThrow("Simulated bootstrap commit failure.");
    expect(
      database
        .prepare("SELECT label FROM sync_test_entities WHERE id = ?")
        .get(entityId),
    ).toEqual({ label: "Stable" });
    expect(
      database
        .prepare(
          "SELECT cursor, bootstrap_revision FROM sync_inbox_state WHERE store_id = ?",
        )
        .get(storeId),
    ).toEqual({
      cursor: "cursor-revision-1",
      bootstrap_revision: "revision-1",
    });

    database.close();
  });
});
