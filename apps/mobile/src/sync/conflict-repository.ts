import type { SyncCommandResult } from "@fl-copilot/sync-contracts";
import type { OutboxCommand, OutboxDatabase } from "./outbox-repository";

export const syncConflictStatuses = [
  "OPEN",
  "RESOLVED_LOCAL",
  "RESOLVED_REMOTE",
  "MERGED",
] as const;
export type SyncConflictStatus = (typeof syncConflictStatuses)[number];

export interface SyncConflict {
  id: string;
  storeId: string;
  commandId: string | null;
  entityType: string;
  entityId: string;
  localPayload: unknown;
  remotePayload: unknown;
  localExpectedVersion: number | null;
  remoteVersion: number | null;
  conflictType: string;
  status: SyncConflictStatus;
  createdAt: string;
  resolvedAt: string | null;
}

interface SyncConflictRow {
  id: string;
  store_id: string;
  command_id: string | null;
  entity_type: string;
  entity_id: string;
  local_payload_json: string;
  remote_payload_json: string;
  local_expected_version: number | null;
  remote_version: number | null;
  conflict_type: string;
  status: SyncConflictStatus;
  created_at: string;
  resolved_at: string | null;
}

export class ConflictRepository {
  constructor(
    private readonly database: OutboxDatabase,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async recordPushConflict(command: OutboxCommand, result: SyncCommandResult) {
    if (result.status !== "CONFLICT") {
      throw new Error("Only CONFLICT push results can be persisted.");
    }
    if (
      result.commandId !== command.commandId ||
      result.entityType !== command.entityType ||
      result.entityId !== command.entityId
    ) {
      throw new Error("Conflict result does not match its Outbox command.");
    }
    const createdAt = this.now();
    await this.database.runAsync(
      `
        INSERT INTO sync_conflicts (
          id, store_id, command_id, entity_type, entity_id,
          local_payload_json, remote_payload_json, local_expected_version,
          remote_version, conflict_type, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)
        ON CONFLICT(id) DO NOTHING
      `,
      command.commandId,
      command.storeId,
      command.commandId,
      command.entityType,
      command.entityId,
      serializeJson(command.payload),
      serializeJson(result.remoteEntity ?? null),
      command.expectedRemoteVersion ?? null,
      result.remoteVersion ?? null,
      result.error?.code ?? "SYNC_VERSION_CONFLICT",
      createdAt,
    );
    const conflict = await this.getById(command.commandId);
    if (!conflict) throw new Error("Sync conflict could not be persisted.");
    return conflict;
  }

  async getById(id: string) {
    const row = await this.database.getFirstAsync<SyncConflictRow>(
      "SELECT * FROM sync_conflicts WHERE id = ?",
      id,
    );
    return row ? mapRow(row) : null;
  }

  async listOpen(storeId: string) {
    const rows = await this.database.getAllAsync<SyncConflictRow>(
      `
        SELECT * FROM sync_conflicts
        WHERE store_id = ? AND status = 'OPEN'
        ORDER BY created_at DESC, id ASC
      `,
      storeId,
    );
    return rows.map(mapRow);
  }
}

function serializeJson(value: unknown) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("Conflict payload must be JSON-serializable.");
  }
  return serialized;
}

function mapRow(row: SyncConflictRow): SyncConflict {
  return {
    id: row.id,
    storeId: row.store_id,
    commandId: row.command_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    localPayload: JSON.parse(row.local_payload_json) as unknown,
    remotePayload: JSON.parse(row.remote_payload_json) as unknown,
    localExpectedVersion: row.local_expected_version,
    remoteVersion: row.remote_version,
    conflictType: row.conflict_type,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}
