import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import {
  illustrationPreparationFixture,
  illustrationDigest,
} from "../../../../scripts/test-layout-illustration-preparations";
import { AllocationSqliteAdapter } from "../../../../scripts/test-physical-allocation-sqlite";
import {
  LayoutIllustrationRepository,
  applyLayoutIllustrationRecord,
} from "./layout-illustration-repository";
import { OutboxRepository } from "../sync/outbox-repository";
import { readPendingWork } from "../sync/pending-work";
import { applyCopilotRecord } from "./conversation-repository";
import { MobileSyncService } from "../sync/sync-service";
import { runLocalMigrations } from "../db/migrations";
import type {
  BootstrapResponse,
  CopilotHistoryPage,
} from "@fl-copilot/sync-contracts";
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

it("records a private unpaid preparation and Outbox once offline, survives file restart and keeps exact historical bindings", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-illustration-")),
    path = join(dir, "local.db"),
    f = await illustrationPreparationFixture(path);
  try {
    const before = JSON.stringify(f.reference),
      e = await f.repo.prepare(f.card, f.ids);
    expect(e.intent).toBe("PREPARATION_ONLY");
    expect(e.physicalRevisionId).toBe(f.reference.revisionId);
    expect(
      await new OutboxRepository(f.a).listPending(f.scope.storeId),
    ).toHaveLength(1);
    expect(await f.repo.prepare(f.card, f.ids)).toEqual(e);
    expect(
      await f.repo.prepare(f.card, {
        ...f.ids,
        id: randomUUID(),
        commandId: randomUUID(),
      }),
    ).toEqual(e);
    expect(
      await new OutboxRepository(f.a).listPending(f.scope.storeId),
    ).toHaveLength(1);
    f.db.close();
    const db = new DatabaseSync(path),
      a = new AllocationSqliteAdapter(db),
      repo = new LayoutIllustrationRepository(
        a,
        f.scope,
        illustrationDigest,
        f.now,
      );
    expect((await repo.find(f.card))?.entity).toEqual(e);
    expect((await repo.find(f.card))?.syncState).toBe("PENDING");
    expect(JSON.stringify(f.reference)).toBe(before);
    db.close();
  } finally {
    if (f.db.isOpen) f.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it.each([
  "cancel",
  "outbox",
  "permission",
  "missing",
  "deleted",
  "changed-product",
])(
  "keeps all business data and refuses/rolls back %s preparation",
  async (kind) => {
    const f = await illustrationPreparationFixture(
      ":memory:",
      kind !== "missing",
    );
    try {
      const before = f.db
        .prepare("SELECT COUNT(*) n FROM store_layout_revisions")
        .get()!.n;
      const cancel = new AbortController();
      if (kind === "cancel") cancel.abort();
      const run = f.a.runAsync.bind(f.a);
      if (kind === "outbox")
        vi.spyOn(f.a, "runAsync").mockImplementation(
          async (sql, ...parameters) => {
            if (sql.includes("INSERT INTO sync_outbox"))
              throw Error("DISK_FULL");
            return run(sql, ...parameters);
          },
        );
      if (kind === "permission") f.scope.canPrepare = false;
      if (kind === "deleted")
        await f.a.runAsync(
          "UPDATE copilot_conversations SET payload_json=? WHERE id=?",
          JSON.stringify({
            ...f.conversation,
            deletedMessageIds: [f.user.id],
            version: 2,
          }),
          f.conversation.id,
        );
      if (kind === "changed-product")
        await f.a.runAsync(
          "UPDATE products SET version=version+1 WHERE id=?",
          f.product.id,
        );
      await expect(
        f.repo.prepare(f.card, f.ids, cancel.signal),
      ).rejects.toThrow();
      expect(
        f.db
          .prepare("SELECT COUNT(*) n FROM copilot_layout_illustrations")
          .get()!.n,
      ).toBe(0);
      expect(
        await new OutboxRepository(f.a).listPending(f.scope.storeId),
      ).toHaveLength(0);
      expect(
        f.db.prepare("SELECT COUNT(*) n FROM store_layout_revisions").get()!.n,
      ).toBe(before);
    } finally {
      vi.restoreAllMocks();
      f.db.close();
    }
  },
);
it("rejects forged immutable records and hides private preparation after changing account or deleting its source", async () => {
  const f = await illustrationPreparationFixture();
  try {
    const e = await f.repo.prepare(f.card, f.ids);
    await expect(
      new LayoutIllustrationRepository(
        f.a,
        { ...f.scope, ownerId: randomUUID() },
        illustrationDigest,
      ).find(f.card),
    ).rejects.toThrow();
    await expect(
      applyLayoutIllustrationRecord(f.a, f.scope, {
        ...e,
        scenarioHash: `sha256:${"a".repeat(64)}`,
      }),
    ).rejects.toThrow("IMMUTABLE");
    await applyCopilotRecord(f.a, f.scope, "copilot_conversation", {
      ...f.conversation,
      version: 2,
      deletedMessageIds: [f.assistant.id],
    });
    await expect(f.repo.prepare(f.card, f.ids)).rejects.toThrow();
    await expect(f.repo.find(f.card)).rejects.toThrow();
  } finally {
    f.db.close();
  }
});
it("a pull retains a pending command until ACK, and a normal sync ACK clears the prepared row exactly once", async () => {
  const f = await illustrationPreparationFixture();
  try {
    const e = await f.repo.prepare(f.card, f.ids);
    await applyLayoutIllustrationRecord(f.a, f.scope, e);
    expect((await f.repo.find(f.card))?.syncState).toBe("PENDING");
    const push = vi.fn(async () => ({
      serverTime: f.now(),
      results: [
        {
          commandId: f.ids.commandId,
          status: "APPLIED" as const,
          entityType: "copilot_layout_illustration",
          entityId: e.id,
          remoteVersion: 1,
          remoteEntity: e,
        },
      ],
    }));
    const sync = new MobileSyncService(
      f.a,
      {
        bootstrap: async () => bootstrapFixture(f.scope.storeId),
        push,
        pull: async () => ({
          changes: [],
          nextCursor: "cursor",
          hasMore: false,
          serverTime: f.now(),
        }),
      },
      {
        appVersion: "test",
        deviceId: f.ids.deviceId,
        copilotOwnerId: f.scope.ownerId,
        maxRetries: 0,
        now: f.now,
      },
    );
    await sync.sync(f.scope.storeId);
    expect((await f.repo.find(f.card))?.syncState).toBe("SYNCED");
    await sync.sync(f.scope.storeId);
    expect(push).toHaveBeenCalledTimes(1);
  } finally {
    f.db.close();
  }
});
it("rolls back the preparation, sequence and Outbox when cancelled after enqueue", async () => {
  const f = await illustrationPreparationFixture(),
    cancel = new AbortController(),
    run = f.a.runAsync.bind(f.a);
  try {
    vi.spyOn(f.a, "runAsync").mockImplementation(async (sql, ...parameters) => {
      const r = await run(sql, ...parameters);
      if (sql.includes("INSERT INTO sync_outbox")) cancel.abort();
      return r;
    });
    await expect(f.repo.prepare(f.card, f.ids, cancel.signal)).rejects.toThrow(
      "CANCELLED",
    );
    expect(
      f.db.prepare("SELECT COUNT(*) n FROM copilot_layout_illustrations").get()!
        .n,
    ).toBe(0);
    expect(f.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()!.n).toBe(0);
  } finally {
    vi.restoreAllMocks();
    f.db.close();
  }
});
it("does not show a private preparation in another account’s pending counters or failures", async () => {
  const f = await illustrationPreparationFixture();
  try {
    await f.repo.prepare(f.card, f.ids);
    const outbox = new OutboxRepository(f.a);
    expect(
      (await outbox.countActive(f.scope.storeId, f.scope.ownerId))
        .pending_count,
    ).toBe(1);
    expect(
      (await outbox.countActive(f.scope.storeId, randomUUID())).pending_count,
    ).toBe(0);
    expect(await readPendingWork(f.a, f.scope.storeId, randomUUID())).toEqual(
      [],
    );
    await outbox.markSyncing(f.ids.commandId);
    await outbox.markFailed(f.ids.commandId, "SOURCE_INVALID");
    expect(
      (await outbox.listFailures(f.scope.storeId, randomUUID())).items,
    ).toEqual([]);
  } finally {
    f.db.close();
  }
});
it.each(["scope", "cursor"])(
  "keeps partial restored rows, refuses %s history and marks adoption only after a valid final page",
  async (failure) => {
    const f = await illustrationPreparationFixture(),
      db = new DatabaseSync(":memory:"),
      a = new AllocationSqliteAdapter(db);
    try {
      const e = await f.repo.prepare(f.card, f.ids);
      await runLocalMigrations(a);
      const snapshot = bootstrapFixture(f.scope.storeId);
      Object.assign(snapshot.entities, {
        layoutIllustrations: [e],
        layoutIllustrationOwnerId: f.scope.ownerId,
        layoutIllustrationHistoryRequired: true,
      });
      let valid = false;
      const page: CopilotHistoryPage = {
        storeId: f.scope.storeId,
        ownerId: f.scope.ownerId,
        conversationId: null,
        conversations: [],
        messages: [],
        layoutIllustrations: [e],
        hasMore: false,
        before: { id: e.id, createdAt: e.createdAt },
      };
      const sync = new MobileSyncService(
        a,
        {
          bootstrap: async () => snapshot,
          illustrationHistoryPage: async () =>
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
          layoutIllustrations: true,
          maxRetries: 0,
        },
      );
      await expect(sync.sync(f.scope.storeId)).rejects.toThrow(
        "LAYOUT_ILLUSTRATION_HISTORY",
      );
      expect(
        db.prepare("SELECT COUNT(*) n FROM copilot_layout_illustrations").get()!
          .n,
      ).toBe(1);
      expect(
        await a.getFirstAsync(
          "SELECT value FROM app_metadata WHERE key=?",
          `layout-illustrations:${f.scope.storeId}:${f.scope.ownerId}`,
        ),
      ).toBeNull();
      valid = true;
      await sync.sync(f.scope.storeId);
      expect(
        await a.getFirstAsync(
          "SELECT value FROM app_metadata WHERE key=?",
          `layout-illustrations:${f.scope.storeId}:${f.scope.ownerId}`,
        ),
      ).toEqual({ value: "1" });
    } finally {
      f.db.close();
      db.close();
    }
  },
);
