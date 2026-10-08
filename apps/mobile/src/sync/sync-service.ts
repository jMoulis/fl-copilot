import { applyCommercialChoice } from "../commercial/offer-choice-repository";
import { applyCommercialReviewEntity } from "../commercial/review-repository";
import { applyWastePublication } from "../documents/waste-receipt-publication";
import { ApiClientError } from "@fl-copilot/api-client";
import {
  SYNC_PROTOCOL_VERSION,
  syncCommandSchema,
  type BootstrapResponse,
  type SyncPullResponse,
  type SyncPushRequest,
  type SyncPushResponse,
} from "@fl-copilot/sync-contracts";
import { applyBootstrap } from "./apply-bootstrap";
import { applyPullPage } from "./apply-pull-page";
import type { AtomicMutationDatabase } from "./atomic-local-mutation";
import { ConflictRepository } from "./conflict-repository";
import { applyProductMasterChange } from "../products/apply-product-master";
import {
  OutboxRepository,
  type OutboxCommand,
  type OutboxDatabase,
} from "./outbox-repository";

export interface SyncTransport {
  bootstrap(storeId: string): Promise<BootstrapResponse>;
  push(request: SyncPushRequest): Promise<SyncPushResponse>;
  pull(storeId: string, cursor: string): Promise<SyncPullResponse>;
}

export interface SyncDatabase extends OutboxDatabase, AtomicMutationDatabase {}

export interface PushSummary {
  pushed: number;
  conflicts: number;
  failed: number;
}

export interface PullSummary {
  pulled: number;
  cursor: string;
}

export interface SyncSummary extends PushSummary, PullSummary {
  startedAt: string;
  completedAt: string;
}

export interface MobileSyncServiceOptions {
  commercialReview?: boolean;
  commercialVisual?: boolean;
  commercialChoices?: boolean;
  appVersion: string;
  deviceId: string;
  maxRetries?: number;
  baseRetryDelayMs?: number;
  now?: () => string;
  sleep?: (milliseconds: number) => Promise<void>;
}

const activeSyncCycles = new Map<string, Promise<SyncSummary>>();

export class MobileSyncService {
  private readonly maxRetries: number;
  private readonly baseRetryDelayMs: number;
  private readonly now: () => string;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(
    private readonly database: SyncDatabase,
    private readonly transport: SyncTransport,
    private readonly options: MobileSyncServiceOptions,
  ) {
    this.maxRetries = options.maxRetries ?? 2;
    this.baseRetryDelayMs = options.baseRetryDelayMs ?? 500;
    this.now = options.now ?? (() => new Date().toISOString());
    this.sleep = options.sleep ?? wait;
  }

  sync(storeId: string): Promise<SyncSummary> {
    const active = activeSyncCycles.get(storeId);
    if (active) return active;
    const cycle = this.runSync(storeId).finally(() => {
      if (activeSyncCycles.get(storeId) === cycle) {
        activeSyncCycles.delete(storeId);
      }
    });
    activeSyncCycles.set(storeId, cycle);
    return cycle;
  }

  async bootstrap(storeId: string) {
    await this.waitForActiveCycle(storeId);
    await this.bootstrapUnlocked(storeId);
  }

  async push(storeId: string) {
    await this.waitForActiveCycle(storeId);
    return this.pushUnlocked(storeId);
  }

  async pull(storeId: string) {
    await this.waitForActiveCycle(storeId);
    return this.pullUnlocked(storeId);
  }

  private async runSync(storeId: string): Promise<SyncSummary> {
    const startedAt = this.now();
    await new OutboxRepository(this.database, this.now).recoverInterrupted(
      storeId,
    );
    const pushed = await this.pushUnlocked(storeId);
    const reviewAdopted = this.options.commercialReview
      ? await this.database.getFirstAsync<{ value: string }>(
          "SELECT value FROM app_metadata WHERE key = ?",
          `commercial-review:${storeId}`,
        )
      : { value: "1" };
    const choicesAdopted = this.options.commercialChoices
      ? await this.database.getFirstAsync(
          "SELECT value FROM app_metadata WHERE key=?",
          `commercial-choices:${storeId}`,
        )
      : true;
    const visualAdopted = this.options.commercialVisual
      ? await this.database.getFirstAsync(
          "SELECT value FROM app_metadata WHERE key = ?",
          `commercial-visual:${storeId}`,
        )
      : { value: "1" };
    if (
      !(await this.readCursor(storeId)) ||
      !reviewAdopted ||
      !visualAdopted ||
      !choicesAdopted
    ) {
      await this.bootstrapUnlocked(storeId);
    }
    const pulled = await this.pullUnlocked(storeId);
    return {
      ...pushed,
      ...pulled,
      startedAt,
      completedAt: this.now(),
    };
  }

  private async bootstrapUnlocked(storeId: string) {
    const snapshot = await this.withRetry(() =>
      this.transport.bootstrap(storeId),
    );
    await applyBootstrap(this.database, storeId, snapshot);
  }

  private async pushUnlocked(storeId: string): Promise<PushSummary> {
    const summary = { pushed: 0, conflicts: 0, failed: 0 };
    for (let retry = 0; retry <= this.maxRetries; retry += 1) {
      const commands = await new OutboxRepository(
        this.database,
        this.now,
      ).listPending(storeId);
      if (commands.length === 0) return summary;
      const batch = await this.pushBatch(storeId, commands);
      summary.pushed += batch.pushed;
      summary.conflicts += batch.conflicts;
      summary.failed += batch.failed;
      if (batch.retryable === 0) {
        const next = await new OutboxRepository(
          this.database,
          this.now,
        ).listPending(storeId);
        if (
          !next.some(
            (item) =>
              ["product_alias", "commercial_offer_choice"].includes(
                item.entityType,
              ) &&
              commands.some(
                (prior) =>
                  prior.entityType === item.entityType &&
                  prior.entityId === item.entityId,
              ),
          )
        )
          return summary;
        retry -= 1;
        continue;
      }
      if (retry >= this.maxRetries) {
        summary.failed += batch.retryable;
        return summary;
      }
      await this.sleep(this.baseRetryDelayMs * 2 ** retry);
    }
    return summary;
  }

  private async pushBatch(storeId: string, commands: OutboxCommand[]) {
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const outbox = new OutboxRepository(transaction, this.now);
      for (const command of commands) {
        await outbox.markSyncing(command.commandId);
      }
    });

    let response: SyncPushResponse;
    try {
      response = await this.withRetry(() =>
        this.transport.push(this.toPushRequest(storeId, commands)),
      );
    } catch (error) {
      await this.returnCommandsToPending(commands, errorCode(error));
      throw error;
    }

    let pushed = 0;
    let conflicts = 0;
    let failed = 0;
    let retryable = 0;
    const results = new Map(
      response.results.map((result) => [result.commandId, result]),
    );
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const outbox = new OutboxRepository(transaction, this.now);
      const conflictsRepository = new ConflictRepository(transaction, this.now);
      for (const command of commands) {
        const result = results.get(command.commandId);
        const code = result?.error?.code ?? "SYNC_RESULT_MISSING";
        if (!result || result.status === "RETRYABLE_ERROR") {
          await outbox.markPendingForRetry(command.commandId, code);
          retryable += 1;
        } else if (
          result.status === "APPLIED" ||
          result.status === "ALREADY_APPLIED"
        ) {
          if (
            typeof result.remoteVersion === "number" &&
            ["product", "product_identifier", "product_alias"].includes(
              command.entityType,
            )
          ) {
            const localVersion =
              typeof command.payload === "object" &&
              command.payload !== null &&
              "version" in command.payload &&
              typeof command.payload.version === "number"
                ? command.payload.version
                : undefined;
            await applyProductMasterChange(
              transaction,
              storeId,
              {
                entityType: command.entityType,
                entityId: command.entityId,
                entityVersion: result.remoteVersion,
                operation: command.commandType.endsWith("_DELETE")
                  ? "DELETE"
                  : "UPSERT",
                ...(result.remoteEntity === undefined
                  ? {}
                  : { entity: result.remoteEntity }),
              },
              localVersion,
            );
          }
          if (command.entityType === "waste_receipt_publication")
            await applyWastePublication(
              transaction,
              storeId,
              result.remoteEntity,
            );
          if (command.entityType === "commercial_offer_choice") {
            await applyCommercialChoice(
              transaction,
              storeId,
              result.remoteEntity,
              (command.payload as { version: number }).version,
            );
          }
          if (command.entityType === "commercial_review_decision")
            await applyCommercialReviewEntity(
              transaction,
              storeId,
              command.entityType,
              result.remoteEntity,
            );
          await outbox.markAcknowledged(command.commandId);
          if (
            command.entityType === "product_alias" &&
            command.commandType === "PRODUCT_ALIAS_UPSERT" &&
            command.expectedRemoteVersion == null &&
            typeof result.remoteVersion === "number"
          ) {
            // Only rebase an unsent delete after our own creation was acknowledged.
            await transaction.runAsync(
              `UPDATE sync_outbox SET expected_remote_version = ?
               WHERE store_id = ? AND entity_type = 'product_alias' AND entity_id = ?
                 AND command_type = 'PRODUCT_ALIAS_DELETE' AND status = 'PENDING'
                 AND attempt_count = 0 AND expected_remote_version IS NULL
                 AND local_sequence > ?`,
              result.remoteVersion,
              storeId,
              command.entityId,
              command.localSequence,
            );
          }
          pushed += 1;
        } else if (result.status === "CONFLICT") {
          if (
            command.entityType === "commercial_review_decision" &&
            result.remoteEntity
          )
            await applyCommercialReviewEntity(
              transaction,
              storeId,
              command.entityType,
              result.remoteEntity,
            );
          if (command.entityType === "commercial_offer_choice")
            await transaction.runAsync(
              "UPDATE commercial_offer_choices SET sync_state='CONFLICT' WHERE id=? AND store_id=?",
              command.entityId,
              storeId,
            );
          await conflictsRepository.recordPushConflict(command, result);
          await outbox.markConflict(command.commandId, code);
          conflicts += 1;
        } else {
          if (command.entityType === "commercial_offer_choice")
            await transaction.runAsync(
              "UPDATE commercial_offer_choices SET sync_state='ERROR' WHERE id=? AND store_id=?",
              command.entityId,
              storeId,
            );
          await outbox.markFailed(command.commandId, code);
          failed += 1;
        }
      }
    });
    return { pushed, conflicts, failed, retryable };
  }

  private async pullUnlocked(storeId: string): Promise<PullSummary> {
    let cursor = await this.readCursor(storeId);
    if (!cursor) {
      await this.bootstrapUnlocked(storeId);
      cursor = await this.readCursor(storeId);
    }
    if (!cursor) throw new Error("Synchronization cursor is unavailable.");
    let pulled = 0;
    let hasMore = true;
    while (hasMore) {
      const page = await this.withRetry(() =>
        this.transport.pull(storeId, cursor as string),
      );
      await applyPullPage(this.database, storeId, page);
      cursor = page.nextCursor;
      pulled += page.changes.length;
      hasMore = page.hasMore;
    }
    return { pulled, cursor };
  }

  private toPushRequest(
    storeId: string,
    commands: OutboxCommand[],
  ): SyncPushRequest {
    return {
      syncProtocolVersion: SYNC_PROTOCOL_VERSION,
      appVersion: this.options.appVersion,
      deviceId: this.options.deviceId,
      storeId,
      commands: commands.map((command) =>
        syncCommandSchema.parse({
          commandId: command.commandId,
          localSequence: command.localSequence,
          type: command.commandType,
          entityType: command.entityType,
          entityId: command.entityId,
          expectedRemoteVersion: command.expectedRemoteVersion,
          createdAt: command.createdAt,
          payload: command.payload,
        }),
      ),
    };
  }

  private async returnCommandsToPending(
    commands: OutboxCommand[],
    code: string,
  ) {
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const outbox = new OutboxRepository(transaction, this.now);
      for (const command of commands) {
        await outbox.markPendingForRetry(command.commandId, code);
      }
    });
  }

  private async readCursor(storeId: string) {
    const state = await this.database.getFirstAsync<{ cursor: string | null }>(
      "SELECT cursor FROM sync_inbox_state WHERE store_id = ?",
      storeId,
    );
    return state?.cursor ?? null;
  }

  private async waitForActiveCycle(storeId: string) {
    await activeSyncCycles.get(storeId);
  }

  private async withRetry<T>(operation: () => Promise<T>) {
    let attempt = 0;
    while (true) {
      try {
        return await operation();
      } catch (error) {
        if (!isRetryable(error) || attempt >= this.maxRetries) throw error;
        await this.sleep(this.baseRetryDelayMs * 2 ** attempt);
        attempt += 1;
      }
    }
  }
}

function isRetryable(error: unknown) {
  return error instanceof ApiClientError && error.response.retryable;
}

function errorCode(error: unknown) {
  return error instanceof ApiClientError
    ? error.response.code
    : "SYNC_UNEXPECTED_ERROR";
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
