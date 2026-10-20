import { runLocalMigrations } from "../db/migrations";
import type { BootstrapResponse } from "@fl-copilot/sync-contracts";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { illustrationGenerationFixture } from "../../../../scripts/test-layout-illustration-generation";
import { AllocationSqliteAdapter } from "../../../../scripts/test-physical-allocation-sqlite";
import { illustrationDigest } from "../../../../scripts/test-layout-illustration-preparations";
import {
  LayoutIllustrationGenerationRepository,
  applyIllustrationGenerationRecord,
} from "./layout-illustration-generation-repository";
import { OutboxRepository } from "../sync/outbox-repository";
import { layoutIllustrationGenerationRecordSchema } from "@fl-copilot/domain";
function bootstrapFixture(storeId: string): BootstrapResponse {
  return {
    protocolVersion: 1,
    store: { id: storeId, name: "Test", role: "MANAGER" },
    snapshotRevision: "test",
    cursor: "test-cursor",
    historyPolicy: { rawObservationDays: 90 },
    serverTime: "2026-10-20T16:10:00.000Z",
    entities: {
      syncTestEntities: [],
      products: [],
      productAliases: [],
      productIdentifiers: [],
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
  };
}

function repository(
  f: Awaited<ReturnType<typeof illustrationGenerationFixture>>,
) {
  return new LayoutIllustrationGenerationRepository(
    f.a,
    f.scope,
    illustrationDigest,
    f.now,
  );
}
it("records one explicit paid-attempt decision with its private Outbox command, deduplicates the quote and persists offline across restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "fl-generation-local-")),
    path = join(root, "local.sqlite"),
    f = await illustrationGenerationFixture(path);
  let closed = false;
  try {
    const repo = repository(f),
      before = await f.a.getFirstAsync<{ n: number }>(
        "SELECT COUNT(*) n FROM sync_outbox",
      ),
      record = await repo.confirm(f.card, f.quote, f.ids);
    expect(record.status).toBe("QUEUED");
    expect(
      await repo.confirm(f.card, f.quote, { ...f.ids, id: randomUUID() }),
    ).toEqual(record);
    const pending = await new OutboxRepository(f.a).listPending(
      f.scope.storeId,
      50,
    );
    const command = pending.find((c) => c.commandId === record.id);
    expect(command?.entityType).toBe("copilot_layout_illustration_generation");
    expect(command?.payload).toEqual(record.decision);
    expect(
      (await f.a.getFirstAsync<{ n: number }>(
        "SELECT COUNT(*) n FROM sync_outbox",
      ))!.n,
    ).toBe(before!.n + 1);
    f.db.close();
    closed = true;
    const db = new DatabaseSync(path),
      a = new AllocationSqliteAdapter(db);
    try {
      expect(
        await new LayoutIllustrationGenerationRepository(
          a,
          f.scope,
          illustrationDigest,
          f.now,
        ).find(f.card),
      ).toEqual({ entity: record, syncState: "PENDING" });
    } finally {
      db.close();
    }
  } finally {
    if (!closed) f.db.close();
    await rm(root, { recursive: true, force: true });
  }
});
it("rolls back the decision and command together on cancellation or Outbox failure", async () => {
  for (const kind of ["cancel", "outbox"]) {
    const f = await illustrationGenerationFixture();
    try {
      const repo = repository(f),
        count = await f.a.getFirstAsync("SELECT COUNT(*) n FROM sync_outbox"),
        signal = new AbortController();
      if (kind === "cancel") signal.abort();
      else
        f.db.exec(
          "CREATE TRIGGER fail_generation_outbox BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT,'TEST_WRITE_FAILED'); END;",
        );
      await expect(
        repo.confirm(f.card, f.quote, f.ids, signal.signal),
      ).rejects.toThrow();
      expect(
        await f.a.getAllAsync(
          "SELECT * FROM copilot_layout_illustration_generations",
        ),
      ).toEqual([]);
      expect(
        await f.a.getFirstAsync("SELECT COUNT(*) n FROM sync_outbox"),
      ).toEqual(count);
    } finally {
      f.db.close();
    }
  }
});
it("refuses foreign/expired quotes, role loss, stale sources and deleted parents before storing any decision", async () => {
  for (const kind of ["foreign", "expired", "role", "stale", "deleted"]) {
    const f = await illustrationGenerationFixture();
    try {
      const q = structuredClone(f.quote);
      if (kind === "foreign") q.body.preparation.ownerId = randomUUID();
      if (kind === "stale")
        await f.a.runAsync("UPDATE products SET version=version+1");
      if (kind === "deleted")
        await f.a.runAsync(
          "UPDATE copilot_conversations SET payload_json=? WHERE id=?",
          JSON.stringify({ ...f.conversation, deletedMessageIds: [f.user.id] }),
          f.conversation.id,
        );
      const repo = new LayoutIllustrationGenerationRepository(
        f.a,
        { ...f.scope, canPrepare: kind !== "role" },
        illustrationDigest,
        kind === "expired" ? () => "2026-10-20T17:05:00.000Z" : f.now,
      );
      await expect(repo.confirm(f.card, q, f.ids)).rejects.toThrow();
      expect(
        await f.a.getAllAsync(
          "SELECT * FROM copilot_layout_illustration_generations",
        ),
      ).toEqual([]);
    } finally {
      f.db.close();
    }
  }
});
it("preserves a newer server result when a late ACK arrives, and only the real ACK clears the pending decision", async () => {
  const f = await illustrationGenerationFixture();
  try {
    const repo = repository(f),
      local = await repo.confirm(f.card, f.quote, f.ids),
      remote = {
        ...local,
        createdAt: "2026-10-20T17:00:11.000Z",
        updatedAt: "2026-10-20T17:00:11.000Z",
      };
    const complete = layoutIllustrationGenerationRecordSchema.parse({
      ...remote,
      version: 3,
      status: "SUCCEEDED",
      submittedAt: "2026-10-20T17:00:12.000Z",
      recoverAt: "2026-10-20T17:06:12.000Z",
      updatedAt: "2026-10-20T17:01:00.000Z",
    });
    await applyIllustrationGenerationRecord(f.a, f.scope, complete);
    expect(await repo.find(f.card)).toEqual({
      entity: complete,
      syncState: "PENDING",
    });
    await applyIllustrationGenerationRecord(f.a, f.scope, remote, 1);
    expect(await repo.find(f.card)).toEqual({
      entity: complete,
      syncState: "SYNCED",
    });
    await expect(
      applyIllustrationGenerationRecord(
        f.a,
        { ...f.scope, ownerId: randomUUID() },
        complete,
      ),
    ).rejects.toThrow("SCOPE_INVALID");
    await expect(
      applyIllustrationGenerationRecord(f.a, f.scope, {
        ...complete,
        decision: {
          ...complete.decision,
          confirmedAt: "2026-10-20T17:00:20.000Z",
        },
      }),
    ).rejects.toThrow("IMMUTABLE");
  } finally {
    f.db.close();
  }
});
it.each(["scope", "cursor"])(
  "preserves partial generation history and refuses %s pages until a valid final page adopts the capability",
  async (failure) => {
    const { MobileSyncService } = await import("../sync/sync-service"),
      f = await illustrationGenerationFixture(),
      db = new DatabaseSync(":memory:"),
      a = new AllocationSqliteAdapter(db);
    try {
      const entity = await repository(f).confirm(f.card, f.quote, f.ids);
      await runLocalMigrations(a);
      const snapshot = bootstrapFixture(f.scope.storeId);
      Object.assign(snapshot.entities, {
        layoutIllustrationGenerations: [entity],
        layoutIllustrationGenerationOwnerId: f.scope.ownerId,
        layoutIllustrationGenerationHistoryRequired: true,
      });
      const page = {
        storeId: f.scope.storeId,
        ownerId: f.scope.ownerId,
        conversationId: null,
        conversations: [],
        messages: [],
        layoutIllustrationGenerations: [entity],
        hasMore: false,
        before: { id: entity.id, createdAt: entity.createdAt },
      };
      let valid = false;
      const sync = new MobileSyncService(
        a,
        {
          bootstrap: async () => snapshot,
          illustrationGenerationHistoryPage: async () =>
            valid
              ? page
              : failure === "scope"
                ? { ...page, ownerId: randomUUID() }
                : { ...page, hasMore: true },
          push: async () => ({ results: [], serverTime: f.now() }),
          pull: async () => ({
            changes: [],
            nextCursor: "cursor",
            hasMore: false,
            serverTime: f.now(),
          }),
        },
        {
          appVersion: "test",
          deviceId: randomUUID(),
          copilotOwnerId: f.scope.ownerId,
          copilotHistory: true,
          layoutIllustrationGenerations: true,
          maxRetries: 0,
        },
      );
      await expect(sync.sync(f.scope.storeId)).rejects.toThrow(
        "LAYOUT_ILLUSTRATION_GENERATION_HISTORY",
      );
      expect(
        await a.getFirstAsync(
          "SELECT COUNT(*) n FROM copilot_layout_illustration_generations",
        ),
      ).toEqual({ n: 1 });
      expect(
        await a.getFirstAsync(
          "SELECT value FROM app_metadata WHERE key=?",
          `layout-illustration-generations:${f.scope.storeId}:${f.scope.ownerId}`,
        ),
      ).toBeNull();
      valid = true;
      await sync.sync(f.scope.storeId);
      expect(
        await a.getFirstAsync(
          "SELECT value FROM app_metadata WHERE key=?",
          `layout-illustration-generations:${f.scope.storeId}:${f.scope.ownerId}`,
        ),
      ).toEqual({ value: "1" });
    } finally {
      f.db.close();
      db.close();
    }
  },
);
