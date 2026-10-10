import { queueSubstitutionEvidence } from "../substitution-evidence-work.js";
import { randomUUID } from "node:crypto";
import { Long } from "mongodb";
import type { MongoCommandMutationContext } from "./processed-command-service.js";

export const syncChangeOperations = ["UPSERT", "DELETE"] as const;
export type SyncChangeOperation = (typeof syncChangeOperations)[number];

export interface SyncChangeDocument {
  _id: string;
  storeId: string;
  sequence: Long;
  entityType: string;
  entityId: string;
  operation: SyncChangeOperation;
  entityVersion: number;
  changedAt: Date;
  payloadRevision: string | null;
}

export interface AppendSyncChangeInput {
  storeId: string;
  entityType: string;
  entityId: string;
  operation: SyncChangeOperation;
  entityVersion: number;
  payloadRevision?: string | null;
}

export interface SyncChangeStore<TContext> {
  allocateSequence(context: TContext, storeId: string): Promise<Long>;
  insert(context: TContext, change: SyncChangeDocument): Promise<void>;
}

export class SyncChangeService<TContext> {
  constructor(
    private readonly store: SyncChangeStore<TContext>,
    private readonly now: () => Date = () => new Date(),
    private readonly generateId: () => string = randomUUID,
  ) {}

  async append(context: TContext, input: AppendSyncChangeInput) {
    if (!Number.isSafeInteger(input.entityVersion) || input.entityVersion < 1) {
      throw new Error("Sync change entity version must be a positive integer.");
    }
    const sequence = await this.store.allocateSequence(context, input.storeId);
    if (sequence.lessThanOrEqual(Long.ZERO)) {
      throw new Error("Sync change sequence must be positive.");
    }
    const change: SyncChangeDocument = {
      _id: this.generateId(),
      storeId: input.storeId,
      sequence,
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation,
      entityVersion: input.entityVersion,
      changedAt: this.now(),
      payloadRevision: input.payloadRevision ?? null,
    };
    await this.store.insert(context, change);
    return change;
  }
}

interface SyncStoreCounterDocument {
  _id: string;
  nextSequence: Long;
}

class MongoSyncChangeStore implements SyncChangeStore<MongoCommandMutationContext> {
  async allocateSequence(
    { database, session }: MongoCommandMutationContext,
    storeId: string,
  ) {
    const counter = await database
      .collection<SyncStoreCounterDocument>("syncStoreCounters")
      .findOneAndUpdate(
        { _id: storeId },
        { $inc: { nextSequence: Long.ONE } },
        {
          upsert: true,
          returnDocument: "after",
          promoteLongs: false,
          session,
        },
      );
    if (!counter) {
      throw new Error(`Sync sequence allocation failed for store ${storeId}.`);
    }
    return counter.nextSequence;
  }

  async insert(
    { database, session }: MongoCommandMutationContext,
    change: SyncChangeDocument,
  ) {
    await database
      .collection<SyncChangeDocument>("syncChanges")
      .insertOne(change, { session });
    await queueSubstitutionEvidence({ database, session }, change);
  }
}

export function createMongoSyncChangeService(
  now?: () => Date,
  generateId?: () => string,
) {
  return new SyncChangeService(new MongoSyncChangeStore(), now, generateId);
}
