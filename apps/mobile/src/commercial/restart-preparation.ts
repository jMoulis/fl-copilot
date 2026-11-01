import {
  commercialWeekPreparationSchema,
  type CommercialWeekPreparation,
  type CommercialProcessingReview,
} from "@fl-copilot/sync-contracts";
import {
  joinedMutationDatabase,
  type AtomicMutationDatabase,
} from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { CommercialPreparationRepository } from "./week-preparation-repository";
import { CommercialAnalysisRecoveryRepository } from "../documents/commercial-analysis-recovery";

type Database = AtomicMutationDatabase & OutboxDatabase;
type Context = {
  storeId: string;
  ownerId: string;
  deviceId: string;
  weekStart: string;
  canChange(): boolean;
  signal?: AbortSignal;
};
/** Compose the existing draft writer and durable analysis queue in one local transaction.
 * The confirmed snapshot cannot discard a later edit or a changed account/week. */
export async function restartCommercialPreparation(
  db: Database,
  digest: (s: string) => Promise<string>,
  id: () => string,
  input: {
    context: Context;
    previous: CommercialWeekPreparation | null;
    resetDraft: boolean;
    analysis?: CommercialProcessingReview;
  },
  now = () => new Date().toISOString(),
) {
  const { context: ctx } = input;
  const check = () => {
    ctx.signal?.throwIfAborted();
    if (!ctx.canChange()) throw Error("COMMERCIAL_RESTART_FORBIDDEN");
  };
  check();
  if (!input.resetDraft && !input.analysis)
    throw Error("COMMERCIAL_RESTART_EMPTY");
  let cleared: CommercialWeekPreparation | null = null;
  await db.withExclusiveTransactionAsync(async (tx) => {
    check();
    const joined = joinedMutationDatabase(tx),
      repo = new CommercialPreparationRepository(joined, digest);
    if (input.resetDraft) {
      const record = await repo.get(ctx.storeId, ctx.weekStart);
      if (
        JSON.stringify(record?.entity ?? null) !==
        JSON.stringify(input.previous)
      )
        throw Error("COMMERCIAL_RESTART_CHANGED");
      if (record && ["CONFLICT", "ERROR"].includes(record.syncState))
        throw Error("COMMERCIAL_RESTART_CONFLICT");
      if (record) {
        const stamp = now();
        cleared = commercialWeekPreparationSchema.parse({
          ...record.entity,
          offerRefs: [],
          placements: [],
          tgCapacity: null,
          note: "",
          physicalAllocation: null,
          version: record.entity.version + 1,
          updatedAt: stamp,
        });
        await tx.runAsync(
          "INSERT INTO commercial_preparation_history(action_id,preparation_id,store_id,payload_json,action,created_at) VALUES(?,?,?,?,?,?)",
          id(),
          record.entity.id,
          ctx.storeId,
          JSON.stringify(record.entity),
          "BEFORE_RESET",
          stamp,
        );
        await repo.save(cleared, { commandId: id(), deviceId: ctx.deviceId });
      }
    }
    if (input.analysis)
      await new CommercialAnalysisRecoveryRepository(joined, id, now).queue(
        ctx.storeId,
        ctx.ownerId,
        input.analysis.sourceDocumentId,
        input.analysis.basisHash,
        { canResume: ctx.canChange, signal: ctx.signal },
        "RESTART",
      );
    check();
  });
  return cleared as CommercialWeekPreparation | null;
}

/** Restore the reset baseline only while the cleared revision is still current. */
export async function restoreResetPreparation(
  db: Database,
  digest: (s: string) => Promise<string>,
  id: () => string,
  context: Context,
  expected: CommercialWeekPreparation,
) {
  let restored: CommercialWeekPreparation | undefined;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const check = () => {
      context.signal?.throwIfAborted();
      if (!context.canChange()) throw Error("COMMERCIAL_RESTART_FORBIDDEN");
    };
    check();
    const repo = new CommercialPreparationRepository(
        joinedMutationDatabase(tx),
        digest,
      ),
      current = await repo.get(context.storeId, context.weekStart);
    if (JSON.stringify(current?.entity) !== JSON.stringify(expected))
      throw Error("COMMERCIAL_RESTART_CHANGED");
    const baseline = await tx.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM commercial_preparation_history WHERE preparation_id=? AND store_id=? AND action='BEFORE_RESET' ORDER BY rowid DESC LIMIT 1",
      expected.id,
      context.storeId,
    );
    if (!baseline) throw Error("COMMERCIAL_RESET_BASELINE_MISSING");
    const previous = commercialWeekPreparationSchema.parse(
      JSON.parse(baseline.payload_json),
    );
    if (
      previous.version + 1 !== expected.version ||
      previous.id !== expected.id
    )
      throw Error("COMMERCIAL_RESTART_CHANGED");
    restored = commercialWeekPreparationSchema.parse({
      ...previous,
      version: expected.version + 1,
      updatedAt: new Date().toISOString(),
    });
    await repo.save(restored, { commandId: id(), deviceId: context.deviceId });
    check();
  });
  return restored!;
}

export async function canRestoreResetPreparation(
  db: OutboxDatabase,
  current: CommercialWeekPreparation,
) {
  const row = await db.getFirstAsync<{ payload_json: string }>(
    "SELECT payload_json FROM commercial_preparation_history WHERE preparation_id=? AND store_id=? AND action='BEFORE_RESET' ORDER BY rowid DESC LIMIT 1",
    current.id,
    current.storeId,
  );
  if (!row) return false;
  const previous = commercialWeekPreparationSchema.parse(
    JSON.parse(row.payload_json),
  );
  return previous.id === current.id && previous.version + 1 === current.version;
}
