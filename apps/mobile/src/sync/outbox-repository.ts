export const OUTBOX_LOCAL_SEQUENCE_KEY = "outbox_local_sequence";
export const MAX_PENDING_COMMANDS = 100;

const outboxChangeListeners = new Set<() => void>();

export function subscribeOutboxChanges(listener: () => void) {
  outboxChangeListeners.add(listener);
  return () => {
    outboxChangeListeners.delete(listener);
  };
}

function notifyOutboxChanged() {
  setTimeout(() => {
    for (const listener of outboxChangeListeners) listener();
  }, 0);
}

export const outboxStatuses = [
  "PENDING",
  "SYNCING",
  "ACKNOWLEDGED",
  "CONFLICT",
  "FAILED",
] as const;
export type OutboxStatus = (typeof outboxStatuses)[number];

type SQLiteValue = string | number | null;

interface SQLiteRunResult {
  changes: number | bigint;
}

export interface OutboxDatabase {
  getFirstAsync<T>(sql: string, ...params: SQLiteValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: SQLiteValue[]): Promise<T[]>;
  runAsync(sql: string, ...params: SQLiteValue[]): Promise<SQLiteRunResult>;
}

export interface EnqueueOutboxCommand {
  commandId: string;
  storeId: string;
  deviceId: string;
  commandType: string;
  entityType: string;
  entityId: string;
  expectedRemoteVersion?: number | null;
  payload: unknown;
  createdAt?: string;
}

export interface OutboxCommand extends Omit<EnqueueOutboxCommand, "createdAt"> {
  localSequence: number;
  createdAt: string;
  status: OutboxStatus;
  attemptCount: number;
  lastAttemptAt: string | null;
  lastErrorCode: string | null;
}

interface OutboxRow {
  command_id: string;
  store_id: string;
  device_id: string;
  local_sequence: number;
  command_type: string;
  entity_type: string;
  entity_id: string;
  expected_remote_version: number | null;
  payload_json: string;
  created_at: string;
  status: OutboxStatus;
  attempt_count: number;
  last_attempt_at: string | null;
  last_error_code: string | null;
}

function mapRow(row: OutboxRow): OutboxCommand {
  return {
    commandId: row.command_id,
    storeId: row.store_id,
    deviceId: row.device_id,
    localSequence: row.local_sequence,
    commandType: row.command_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    expectedRemoteVersion: row.expected_remote_version,
    payload: JSON.parse(row.payload_json) as unknown,
    createdAt: row.created_at,
    status: row.status,
    attemptCount: row.attempt_count,
    lastAttemptAt: row.last_attempt_at,
    lastErrorCode: row.last_error_code,
  };
}

function serializePayload(payload: unknown) {
  const serialized = JSON.stringify(payload);
  if (serialized === undefined) {
    throw new Error("Outbox payload must be JSON-serializable.");
  }
  return serialized;
}

function assertChanged(result: SQLiteRunResult, transition: string) {
  if (Number(result.changes) !== 1) {
    throw new Error(`Outbox transition rejected: ${transition}.`);
  }
}

export class OutboxRepository {
  constructor(
    private readonly database: OutboxDatabase,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  private async allocateLocalSequence() {
    const timestamp = this.now();
    const row = await this.database.getFirstAsync<{ value: string }>(
      `
        INSERT INTO app_metadata (key, value, updated_at)
        VALUES (?, '1', ?)
        ON CONFLICT(key) DO UPDATE SET
          value = CAST(CAST(value AS INTEGER) + 1 AS TEXT),
          updated_at = excluded.updated_at
        RETURNING value
      `,
      OUTBOX_LOCAL_SEQUENCE_KEY,
      timestamp,
    );
    const sequence = Number(row?.value);
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new Error("Outbox local sequence could not be allocated.");
    }
    return sequence;
  }

  async enqueue(input: EnqueueOutboxCommand) {
    const localSequence = await this.allocateLocalSequence();
    const createdAt = input.createdAt ?? this.now();
    await this.database.runAsync(
      `
        INSERT INTO sync_outbox (
          command_id, store_id, device_id, local_sequence, command_type,
          entity_type, entity_id, expected_remote_version, payload_json,
          created_at, status, attempt_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0)
      `,
      input.commandId,
      input.storeId,
      input.deviceId,
      localSequence,
      input.commandType,
      input.entityType,
      input.entityId,
      input.expectedRemoteVersion ?? null,
      serializePayload(input.payload),
      createdAt,
    );
    const command = await this.getById(input.commandId);
    if (!command) throw new Error("Outbox command could not be persisted.");
    notifyOutboxChanged();
    return command;
  }

  async getById(commandId: string) {
    const row = await this.database.getFirstAsync<OutboxRow>(
      "SELECT * FROM sync_outbox WHERE command_id = ?",
      commandId,
    );
    return row ? mapRow(row) : null;
  }

  async listPending(storeId: string, limit = MAX_PENDING_COMMANDS) {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PENDING_COMMANDS) {
      throw new Error(
        `Pending Outbox limit must be between 1 and ${MAX_PENDING_COMMANDS}.`,
      );
    }
    const rows = await this.database.getAllAsync<OutboxRow>(
      `
        SELECT * FROM sync_outbox
        WHERE store_id = ? AND status = 'PENDING'
          AND (entity_type != 'product_alias' OR NOT EXISTS (
            SELECT 1 FROM sync_outbox prior
            WHERE prior.store_id = sync_outbox.store_id
              AND prior.entity_type = sync_outbox.entity_type
              AND prior.entity_id = sync_outbox.entity_id
              AND prior.local_sequence < sync_outbox.local_sequence
              AND (prior.status IN ('PENDING', 'SYNCING', 'FAILED') OR
                (prior.status = 'CONFLICT' AND NOT EXISTS (
                  SELECT 1 FROM sync_conflicts c WHERE c.command_id = prior.command_id AND c.status IN ('RESOLVED_LOCAL', 'RESOLVED_REMOTE', 'MERGED')
                )))
          ))
        ORDER BY local_sequence ASC
        LIMIT ?
      `,
      storeId,
      limit,
    );
    return rows.map(mapRow);
  }

  async markSyncing(commandId: string) {
    const attemptedAt = this.now();
    const result = await this.database.runAsync(
      `
        UPDATE sync_outbox
        SET status = 'SYNCING',
            attempt_count = attempt_count + 1,
            last_attempt_at = ?,
            last_error_code = NULL
        WHERE command_id = ? AND status = 'PENDING'
      `,
      attemptedAt,
      commandId,
    );
    assertChanged(result, `${commandId} PENDING -> SYNCING`);
    notifyOutboxChanged();
  }

  async markAcknowledged(commandId: string) {
    await this.markTerminal(commandId, "ACKNOWLEDGED", null);
  }

  async markConflict(commandId: string, errorCode: string) {
    await this.markTerminal(commandId, "CONFLICT", errorCode);
  }

  async markFailed(commandId: string, errorCode: string) {
    await this.markTerminal(commandId, "FAILED", errorCode);
  }

  async markPendingForRetry(commandId: string, errorCode: string) {
    const result = await this.database.runAsync(
      `
        UPDATE sync_outbox
        SET status = 'PENDING', last_error_code = ?
        WHERE command_id = ? AND status = 'SYNCING'
      `,
      errorCode,
      commandId,
    );
    assertChanged(result, `${commandId} SYNCING -> PENDING`);
    notifyOutboxChanged();
  }

  async recoverInterrupted(storeId: string) {
    const result = await this.database.runAsync(
      `
        UPDATE sync_outbox
        SET status = 'PENDING', last_error_code = 'SYNC_INTERRUPTED'
        WHERE store_id = ? AND status = 'SYNCING'
      `,
      storeId,
    );
    const changes = Number(result.changes);
    if (changes > 0) notifyOutboxChanged();
    return changes;
  }

  private async markTerminal(
    commandId: string,
    status: "ACKNOWLEDGED" | "CONFLICT" | "FAILED",
    errorCode: string | null,
  ) {
    const result = await this.database.runAsync(
      `
        UPDATE sync_outbox
        SET status = ?, last_error_code = ?
        WHERE command_id = ? AND status = 'SYNCING'
      `,
      status,
      errorCode,
      commandId,
    );
    assertChanged(result, `${commandId} SYNCING -> ${status}`);
    notifyOutboxChanged();
  }
}
