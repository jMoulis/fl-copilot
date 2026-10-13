import { captureCommercialPdf } from "../documents/commercial-pdf-capture";
import { SourceDocumentRepository } from "../documents/source-document-repository";
import { CopilotTurnDelivery } from "./turn-delivery";
import { receiveCopilotReply } from "./response-receiver";
import { CopilotLocalChatController } from "./local-chat-controller";
import { MobileSyncService } from "../sync/sync-service";
import type { BootstrapResponse } from "@fl-copilot/sync-contracts";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, expect } from "vitest";
import { runLocalMigrations, localMigrations } from "../db/migrations";
import type { OutboxDatabase } from "../sync/outbox-repository";
import {
  CopilotConversationRepository,
  applyCopilotRecord,
} from "./conversation-repository";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import { ConflictRepository } from "../sync/conflict-repository";
class Adapter implements OutboxDatabase {
  fail = false;
  constructor(readonly db: DatabaseSync) {}
  async execAsync(s: string) {
    this.db.exec(s);
  }
  async runAsync(s: string, ...p: Array<string | number | null>) {
    return this.db.prepare(s).run(...p);
  }
  async getFirstAsync<T>(s: string, ...p: Array<string | number | null>) {
    return (this.db.prepare(s).get(...p) as T) ?? null;
  }
  async getAllAsync<T>(s: string, ...p: Array<string | number | null>) {
    return this.db.prepare(s).all(...p) as T[];
  }
  async withExclusiveTransactionAsync(
    task: (tx: OutboxDatabase) => Promise<void>,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      await task(this);
      if (this.fail) throw Error("COMMIT_FAILED");
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}

const command = () => ({ commandId: randomUUID(), deviceId: randomUUID() });
it("creates offline history/draft/attachment references, clears draft atomically on send and survives restart with stable IDs and owner isolation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-chat_")),
    path = join(dir, "chat.db"),
    f = chatFixture(randomUUID);
  let db = new DatabaseSync(path);
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Error("NETWORK_DISABLED");
  };
  try {
    const adapter = new Adapter(db);
    await runLocalMigrations(adapter, localMigrations.slice(0, 33));
    await runLocalMigrations(adapter);
    const repo = new CopilotConversationRepository(adapter, f);
    await repo.save(f.conversation, command());
    await repo.saveDraft(f.conversation.id, {
      text: "brouillon",
      attachments: f.message.attachments,
      updatedAt: f.message.createdAt,
    });
    adapter.fail = true;
    await expect(repo.append(f.message, command())).rejects.toThrow(
      "COMMIT_FAILED",
    );
    expect((await repo.draft(f.conversation.id))?.text).toBe("brouillon");
    adapter.fail = false;
    await repo.append(f.message, command());
    await repo.append(f.message, command());
    expect(await repo.draft(f.conversation.id)).toBeNull();
    expect(
      db.prepare("SELECT count(*) AS n FROM sync_outbox").get(),
    ).toMatchObject({ n: 2 });
    db.close();
    db = new DatabaseSync(path);
    const restored = new CopilotConversationRepository(new Adapter(db), f);
    expect(
      (await restored.messages(f.conversation.id)).messages[0]!.entity,
    ).toEqual(f.message);
    expect((await restored.list())[0]!.entity.id).toBe(f.conversation.id);
    expect(
      await new CopilotConversationRepository(new Adapter(db), {
        ...f,
        ownerId: randomUUID(),
      }).list(),
    ).toEqual([]);
  } finally {
    globalThis.fetch = original;
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("paginates equal timestamps by UUID without missing messages and rejects editing/spoofed assistant/foreign parent", async () => {
  const db = new DatabaseSync(":memory:"),
    adapter = new Adapter(db),
    f = chatFixture(randomUUID);
  try {
    await runLocalMigrations(adapter);
    const repo = new CopilotConversationRepository(adapter, f);
    await repo.save(f.conversation, command());
    const ms = [
      f.message,
      { ...f.message, id: randomUUID(), text: "deux" },
      { ...f.message, id: randomUUID(), text: "trois" },
    ];
    for (const m of ms) await repo.append(m, command());
    const first = await repo.messages(f.conversation.id, 2),
      second = await repo.messages(f.conversation.id, 2, first.before!);
    expect(first.hasMore).toBe(true);
    expect(
      new Set([...first.messages, ...second.messages].map((m) => m.entity.id))
        .size,
    ).toBe(3);
    await expect(
      repo.append({ ...f.message, text: "changed" }, command()),
    ).rejects.toThrow("IMMUTABLE");
    await expect(
      repo.append(
        { ...f.message, id: randomUUID(), role: "ASSISTANT" },
        command(),
      ),
    ).rejects.toThrow("ROLE_INVALID");
    await expect(
      repo.append(
        { ...f.message, id: randomUUID(), ownerId: randomUUID() },
        command(),
      ),
    ).rejects.toThrow("SCOPE_INVALID");
  } finally {
    db.close();
  }
});
it("preserves a later local rename during an older acknowledgement and applies the matching revision without losing messages", async () => {
  const db = new DatabaseSync(":memory:"),
    a = new Adapter(db),
    f = chatFixture(randomUUID);
  try {
    await runLocalMigrations(a);
    const repo = new CopilotConversationRepository(a, f);
    await repo.save(f.conversation, command());
    const next = { ...f.conversation, title: "Mon titre", version: 2 };
    await repo.save(next, command());
    await applyCopilotRecord(a, f, "copilot_conversation", f.conversation, 1);
    expect((await repo.list())[0]).toMatchObject({
      entity: { title: "Mon titre" },
      syncState: "PENDING",
    });
    await applyCopilotRecord(a, f, "copilot_conversation", next, 2);
    expect((await repo.list())[0]!.syncState).toBe("SYNCED");
  } finally {
    db.close();
  }
});
it("preserves both titles and explicitly reconciles a version conflict without changing immutable message history", async () => {
  const db = new DatabaseSync(":memory:"),
    a = new Adapter(db),
    f = chatFixture(randomUUID);
  try {
    await runLocalMigrations(a);
    const repo = new CopilotConversationRepository(a, f),
      ctx = command();
    await repo.save(f.conversation, ctx);
    await repo.append(f.message, command());
    const remote = { ...f.conversation, title: "Autre appareil", version: 2 };
    const cf = await new ConflictRepository(a).recordPushConflict(
      {
        commandId: ctx.commandId,
        storeId: f.storeId,
        deviceId: f.deviceId,
        localSequence: 1,
        commandType: "COPILOT_CONVERSATION_UPSERT",
        entityType: "copilot_conversation",
        entityId: f.conversation.id,
        expectedRemoteVersion: null,
        payload: f.conversation,
        createdAt: f.conversation.createdAt,
        status: "CONFLICT",
        attemptCount: 0,
        lastAttemptAt: null,
        lastErrorCode: null,
      },
      {
        commandId: ctx.commandId,
        status: "CONFLICT",
        entityType: "copilot_conversation",
        entityId: f.conversation.id,
        remoteVersion: 2,
        remoteEntity: remote,
      },
    );
    await a.runAsync(
      "UPDATE copilot_conversations SET sync_state='CONFLICT' WHERE id=?",
      f.conversation.id,
    );
    await repo.resolve(cf.id, true, command());
    expect((await repo.list())[0]!.entity).toMatchObject({
      title: f.conversation.title,
      version: 3,
    });
    expect(
      (await repo.messages(f.conversation.id)).messages[0]!.entity,
    ).toEqual(f.message);
  } finally {
    db.close();
  }
});

it("bootstraps a capable second device, pulls server-authored history and rejects foreign owners transactionally", async () => {
  const db = new DatabaseSync(":memory:"),
    a = new Adapter(db),
    f = chatFixture(randomUUID);
  try {
    await runLocalMigrations(a);
    const snapshot: BootstrapResponse = {
      protocolVersion: 1,
      store: { id: f.storeId },
      snapshotRevision: "test",
      cursor: "snapshot",
      historyPolicy: { rawObservationDays: 90 },
      serverTime: f.message.createdAt,
      entities: {
        syncTestEntities: [],
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
        copilotHistoryOwnerId: f.ownerId,
        copilotConversations: [f.conversation],
        copilotMessages: [f.message],
        copilotHistoryPartial: true,
      },
    };
    const reply = {
      ...f.message,
      id: randomUUID(),
      role: "ASSISTANT" as const,
      text: "Proposition non exécutée",
      attachments: [],
      replyToMessageId: f.message.id,
      createdAt: "2026-10-11T12:01:00.000Z",
    };
    const sync = new MobileSyncService(
      a,
      {
        bootstrap: async () => snapshot,
        push: async () => ({ results: [], serverTime: f.message.createdAt }),
        pull: async () => ({
          changes: [
            {
              sequence: "2",
              entityType: "copilot_message",
              entityId: reply.id,
              entityVersion: 1,
              operation: "UPSERT",
              entity: reply,
              changedAt: reply.createdAt,
            },
          ],
          nextCursor: "next",
          hasMore: false,
          serverTime: reply.createdAt,
        }),
      },
      {
        appVersion: "test",
        deviceId: f.deviceId,
        copilotHistory: true,
        copilotOwnerId: f.ownerId,
      },
    );
    await sync.sync(f.storeId);
    const repo = new CopilotConversationRepository(a, f);
    expect(
      (await repo.messages(f.conversation.id)).messages.map(
        (m) => m.entity.role,
      ),
    ).toEqual(["USER", "ASSISTANT"]);
    await expect(
      applyCopilotRecord(
        a,
        { ...f, ownerId: randomUUID() },
        "copilot_message",
        reply,
      ),
    ).rejects.toThrow("SCOPE_INVALID");
    expect(
      db.prepare("SELECT count(*) AS n FROM sync_outbox").get(),
    ).toMatchObject({ n: 0 });
  } finally {
    db.close();
  }
});

it("serializes draft edits/send, keeps failed drafts, and restores local questions", async () => {
  const db = new DatabaseSync(":memory:"),
    f = chatFixture(randomUUID);
  try {
    const adapter = new Adapter(db);
    await runLocalMigrations(adapter, localMigrations.slice(0, 36));
    const repo = new CopilotConversationRepository(adapter, f);
    await repo.save(f.conversation, command());
    await repo.saveDraft(f.conversation.id, {
      text: "Avant migration",
      attachments: [],
      updatedAt: f.message.createdAt,
    });
    await runLocalMigrations(adapter);
    expect((await repo.draft(f.conversation.id))!.text).toBe("Avant migration");
    const controller = new CopilotLocalChatController(
      repo,
      f,
      randomUUID,
      () => f.message.createdAt,
    );
    const conversation = await controller.create("Analyser les ventes");
    const edit = controller.edit(conversation.id, {
      text: "Ma question",
      attachments: [],
    });
    const send = controller.send(conversation.id);
    await edit;
    const message = await send;
    expect(message.text).toBe("Ma question");
    const queued = (await controller.open(conversation.id)).pendingTurns;
    expect(queued).toHaveLength(1);
    expect(queued[0]!.userMessageId).toBe(message.id);
    expect((await controller.open(conversation.id)).draft).toBeNull();
    expect(
      (await controller.open(conversation.id)).messages[0]!.entity.id,
    ).toBe(message.id);
    await expect(controller.send(conversation.id)).rejects.toThrow(
      "COPILOT_DRAFT_EMPTY",
    );
    await controller.edit(conversation.id, {
      text: "Question suivante",
      attachments: [],
    });
    adapter.fail = true;
    await expect(controller.send(conversation.id)).rejects.toThrow(
      "COMMIT_FAILED",
    );
    adapter.fail = false;
    expect((await controller.open(conversation.id)).draft!.text).toBe(
      "Question suivante",
    );
    const restored = new CopilotLocalChatController(
      new CopilotConversationRepository(adapter, f),
      f,
      randomUUID,
    );
    expect((await restored.open(conversation.id)).pendingTurns).toEqual(queued);
    await restored.send(conversation.id);
    expect((await restored.open(conversation.id)).messages).toHaveLength(2);
    await receiveCopilotReply(adapter, f, queued[0]!, {
      message: {
        ...message,
        id: queued[0]!.replyId,
        role: "ASSISTANT",
        text: "Réponse enregistrée",
        replyToMessageId: message.id,
      },
      alreadyApplied: false,
    });
    const remaining = (await restored.open(conversation.id)).pendingTurns;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.replyId).not.toBe(queued[0]!.replyId);
    const foreign = { ...f, ownerId: randomUUID() };
    await expect(
      new CopilotLocalChatController(
        new CopilotConversationRepository(adapter, foreign),
        foreign,
        randomUUID,
      ).open(conversation.id),
    ).rejects.toThrow("COPILOT_CONVERSATION_UNAVAILABLE");
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM sync_outbox WHERE entity_type='copilot_message'",
        )
        .get()!.n,
    ).toBe(2);
  } finally {
    db.close();
  }
});

it("receives a scoped server reply atomically without creating a second Outbox command", async () => {
  const db = new DatabaseSync(":memory:"),
    f = chatFixture(randomUUID);
  try {
    const adapter = new Adapter(db);
    await runLocalMigrations(adapter);
    const repo = new CopilotConversationRepository(adapter, f);
    await repo.save(f.conversation, command());
    await repo.append(f.message, command());
    const message = {
      ...f.message,
      id: randomUUID(),
      role: "ASSISTANT" as const,
      text: "Les données sont disponibles.",
      attachments: [],
      replyToMessageId: f.message.id,
    };
    const request = {
      replyId: message.id,
      conversationId: f.conversation.id,
      userMessageId: f.message.id,
    };
    adapter.fail = true;
    await expect(
      receiveCopilotReply(adapter, f, request, {
        message,
        alreadyApplied: false,
      }),
    ).rejects.toThrow("COMMIT_FAILED");
    adapter.fail = false;
    expect((await repo.messages(f.conversation.id)).messages).toHaveLength(1);
    await receiveCopilotReply(adapter, f, request, {
      message,
      alreadyApplied: false,
    });
    await receiveCopilotReply(adapter, f, request, {
      message,
      alreadyApplied: true,
    });
    const page = await repo.messages(f.conversation.id);
    expect(page.messages).toHaveLength(2);
    expect(
      page.messages.find((m) => m.entity.id === message.id)!.syncState,
    ).toBe("SYNCED");
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM sync_outbox WHERE entity_type='copilot_message'",
        )
        .get()!.n,
    ).toBe(1);
    await expect(
      receiveCopilotReply(adapter, f, request, {
        message: { ...message, ownerId: randomUUID() },
        alreadyApplied: false,
      }),
    ).rejects.toThrow("COPILOT_REPLY_SCOPE_INVALID");
  } finally {
    db.close();
  }
});

it("delivers only synchronized questions and keeps the same pending identity after network failure", async () => {
  const db = new DatabaseSync(":memory:"),
    f = chatFixture(randomUUID);
  try {
    const adapter = new Adapter(db);
    await runLocalMigrations(adapter);
    const repo = new CopilotConversationRepository(adapter, f);
    const controller = new CopilotLocalChatController(repo, f, randomUUID);
    const conversation = await controller.create();
    await controller.edit(conversation.id, {
      text: "Question hors connexion",
      attachments: [],
    });
    const parent = await controller.send(conversation.id);
    const request = (await controller.open(conversation.id)).pendingTurns[0]!;
    let count = 0,
      fail = true;
    const dependencies = {
      sync: async () => {},
      ask: async (input: typeof request) => {
        count++;
        expect(input).toEqual(request);
        if (fail) throw Error("NETWORK_DOWN");
        return {
          message: {
            ...parent,
            id: request.replyId,
            role: "ASSISTANT",
            text: "Réponse reçue",
            replyToMessageId: parent.id,
          },
          alreadyApplied: false,
        };
      },
    };
    const delivery = new CopilotTurnDelivery(adapter, f, dependencies);
    expect(await delivery.deliver(conversation.id)).toBe("WAITING");
    expect(count).toBe(0);
    await adapter.runAsync(
      "UPDATE copilot_messages SET sync_state='SYNCED' WHERE id=?",
      parent.id,
    );
    await expect(delivery.deliver(conversation.id)).rejects.toThrow(
      "NETWORK_DOWN",
    );
    expect((await controller.open(conversation.id)).pendingTurns[0]).toEqual(
      request,
    );
    fail = false;
    const restored = new CopilotTurnDelivery(adapter, f, dependencies);
    const first = restored.deliver(conversation.id),
      second = restored.deliver(conversation.id);
    expect(first).toBe(second);
    expect(await first).toBe("RECEIVED");
    expect((await controller.open(conversation.id)).pendingTurns).toEqual([]);
    expect(await restored.deliver(conversation.id)).toBe("NONE");
    expect(count).toBe(2);
  } finally {
    db.close();
  }
});

it("drains queued questions in insertion order even with equal timestamps, bounds each batch and shares concurrent retries", async () => {
  const db = new DatabaseSync(":memory:"),
    f = chatFixture(randomUUID);
  try {
    const adapter = new Adapter(db);
    await runLocalMigrations(adapter);
    const repo = new CopilotConversationRepository(adapter, f);
    const controller = new CopilotLocalChatController(
      repo,
      f,
      randomUUID,
      () => "2026-10-13T08:00:00Z",
    );
    const conversation = await controller.create();
    const parents: Awaited<ReturnType<CopilotLocalChatController["send"]>>[] =
      [];
    for (let i = 0; i < 7; i++) {
      await controller.edit(conversation.id, {
        text: `Question ${i}`,
        attachments: [],
      });
      parents.push(await controller.send(conversation.id));
    }
    const requests = (await controller.open(conversation.id)).pendingTurns;
    expect(requests.map((r) => r.userMessageId)).toEqual(
      parents.map((p) => p.id),
    );
    const calls: string[] = [];
    const delivery = new CopilotTurnDelivery(adapter, f, {
      sync: async () => {
        for (const parent of parents)
          await adapter.runAsync(
            "UPDATE copilot_messages SET sync_state='SYNCED' WHERE id=?",
            parent.id,
          );
      },
      ask: async (request) => {
        calls.push(request.userMessageId);
        const parent = parents.find((p) => p.id === request.userMessageId)!;
        return {
          message: {
            ...parent,
            id: request.replyId,
            role: "ASSISTANT",
            text: "Réponse",
            replyToMessageId: parent.id,
          },
          alreadyApplied: false,
        };
      },
    });
    const first = delivery.deliver(conversation.id);
    expect(delivery.deliver(conversation.id)).toBe(first);
    expect(await first).toBe("RECEIVED");
    expect(calls).toEqual(parents.slice(0, 5).map((p) => p.id));
    expect((await controller.open(conversation.id)).pendingTurns).toEqual(
      requests.slice(5),
    );
    expect(await delivery.deliver(conversation.id)).toBe("RECEIVED");
    expect(calls).toEqual(parents.map((p) => p.id));
    expect((await controller.open(conversation.id)).pendingTurns).toEqual([]);
    expect(await delivery.deliver(conversation.id)).toBe("NONE");
    expect(
      (await repo.messages(conversation.id)).messages.filter(
        (m) => m.entity.role === "ASSISTANT",
      ),
    ).toHaveLength(7);
  } finally {
    db.close();
  }
});

it("keeps a received answer when the next call fails, resumes stable IDs after restart and never overtakes an unsynchronized parent", async () => {
  const db = new DatabaseSync(":memory:"),
    f = chatFixture(randomUUID);
  try {
    const adapter = new Adapter(db);
    await runLocalMigrations(adapter);
    const repo = new CopilotConversationRepository(adapter, f);
    const controller = new CopilotLocalChatController(repo, f, randomUUID);
    const conversation = await controller.create();
    const parents: Awaited<ReturnType<CopilotLocalChatController["send"]>>[] =
      [];
    for (let i = 0; i < 3; i++) {
      await controller.edit(conversation.id, {
        text: `Question ${i}`,
        attachments: [],
      });
      parents.push(await controller.send(conversation.id));
    }
    const requests = (await controller.open(conversation.id)).pendingTurns;
    for (const parent of parents.slice(0, 2))
      await adapter.runAsync(
        "UPDATE copilot_messages SET sync_state='SYNCED' WHERE id=?",
        parent.id,
      );
    let fail = true;
    const calls: string[] = [];
    const dependencies = {
      sync: async () => {},
      ask: async (request: (typeof requests)[number]) => {
        calls.push(request.replyId);
        if (request.replyId === requests[1]!.replyId && fail)
          throw Error("NETWORK_DOWN");
        const parent = parents.find((p) => p.id === request.userMessageId)!;
        return {
          message: {
            ...parent,
            id: request.replyId,
            role: "ASSISTANT",
            text: "Réponse",
            replyToMessageId: parent.id,
          },
          alreadyApplied: false,
        };
      },
    };
    await expect(
      new CopilotTurnDelivery(adapter, f, dependencies).deliver(
        conversation.id,
      ),
    ).rejects.toThrow("NETWORK_DOWN");
    expect((await controller.open(conversation.id)).pendingTurns).toEqual(
      requests.slice(1),
    );
    expect(
      (await repo.messages(conversation.id)).messages.filter(
        (m) => m.entity.role === "ASSISTANT",
      ),
    ).toHaveLength(1);
    fail = false;
    const restored = new CopilotTurnDelivery(adapter, f, dependencies);
    expect(await restored.deliver(conversation.id)).toBe("WAITING");
    expect((await controller.open(conversation.id)).pendingTurns).toEqual(
      requests.slice(2),
    );
    expect(calls).toEqual([
      requests[0]!.replyId,
      requests[1]!.replyId,
      requests[1]!.replyId,
    ]);
    await adapter.runAsync(
      "UPDATE copilot_messages SET sync_state='SYNCED' WHERE id=?",
      parents[2]!.id,
    );
    expect(await restored.deliver(conversation.id)).toBe("RECEIVED");
    expect((await controller.open(conversation.id)).pendingTurns).toEqual([]);
    expect(
      (await repo.messages(conversation.id)).messages.filter(
        (m) => m.entity.role === "ASSISTANT",
      ),
    ).toHaveLength(3);
  } finally {
    db.close();
  }
});

it("reads older controller pages offline across tied timestamps without changing the draft, writes or conversation scope", async () => {
  const db = new DatabaseSync(":memory:"),
    f = chatFixture(randomUUID);
  try {
    const adapter = new Adapter(db);
    await runLocalMigrations(adapter);
    const repo = new CopilotConversationRepository(adapter, f);
    const controller = new CopilotLocalChatController(
      repo,
      f,
      randomUUID,
      () => "2026-10-13T08:00:00Z",
    );
    const conversation = await controller.create();
    for (let i = 0; i < 103; i++) {
      await controller.edit(conversation.id, {
        text: `Message ${i}`,
        attachments: [],
      });
      await controller.send(conversation.id);
    }
    await controller.edit(conversation.id, {
      text: "Brouillon conservé",
      attachments: [],
    });
    const beforeCount = db
      .prepare("SELECT count(*) AS n FROM sync_outbox")
      .get();
    const first = await controller.open(conversation.id);
    const second = await controller.older(conversation.id, first.before!);
    const third = await controller.older(conversation.id, second.before!);
    expect([
      first.messages.length,
      second.messages.length,
      third.messages.length,
    ]).toEqual([50, 50, 3]);
    expect([first.hasMore, second.hasMore, third.hasMore]).toEqual([
      true,
      true,
      false,
    ]);
    const ids = [...third.messages, ...second.messages, ...first.messages].map(
      (m) => m.entity.id,
    );
    expect(new Set(ids).size).toBe(103);
    expect(ids).toEqual([...ids].sort());
    expect((await controller.open(conversation.id)).draft?.text).toBe(
      "Brouillon conservé",
    );
    expect(db.prepare("SELECT count(*) AS n FROM sync_outbox").get()).toEqual(
      beforeCount,
    );
    const foreign = new CopilotLocalChatController(
      new CopilotConversationRepository(adapter, {
        ...f,
        ownerId: randomUUID(),
      }),
      f,
      randomUUID,
    );
    await expect(foreign.older(conversation.id, first.before!)).rejects.toThrow(
      "COPILOT_CONVERSATION_UNAVAILABLE",
    );
    await repo.save(
      { ...conversation, status: "ARCHIVED", version: 2 },
      command(),
    );
    await expect(
      controller.older(conversation.id, first.before!),
    ).rejects.toThrow("COPILOT_CONVERSATION_UNAVAILABLE");
  } finally {
    db.close();
  }
});

it("refreshes through the previously displayed tail without a gap when more than one page arrives", async () => {
  const db = new DatabaseSync(":memory:"),
    f = chatFixture(randomUUID);
  try {
    const adapter = new Adapter(db);
    await runLocalMigrations(adapter);
    const repo = new CopilotConversationRepository(adapter, f);
    let time = 0;
    const controller = new CopilotLocalChatController(repo, f, randomUUID, () =>
      new Date(Date.UTC(2026, 9, 13, 8, 0, time++)).toISOString(),
    );
    const conversation = await controller.create();
    const parents: Awaited<ReturnType<CopilotLocalChatController["send"]>>[] =
      [];
    for (let i = 0; i < 3; i++) {
      await controller.edit(conversation.id, {
        text: "Initial",
        attachments: [],
      });
      parents.push(await controller.send(conversation.id));
    }
    const old = await controller.open(conversation.id);
    for (let i = 0; i < 105; i++) {
      await controller.edit(conversation.id, {
        text: "Nouveau",
        attachments: [],
      });
      parents.push(await controller.send(conversation.id));
    }
    const recent = await controller.open(
      conversation.id,
      old.messages.at(-1)!.entity,
    );
    expect(recent.messages.map((m) => m.entity.id)).toEqual(
      parents.map((p) => p.id),
    );
    expect(recent.hasMore).toBe(false);
  } finally {
    db.close();
  }
});

it("retains a PDF through the existing intake, preserves text while attaching, restores the draft and sends a file-only question", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-chat-pdf_")),
    path = join(dir, "chat.db"),
    f = chatFixture(randomUUID);
  let db = new DatabaseSync(path);
  try {
    let adapter = new Adapter(db);
    await runLocalMigrations(adapter);
    let repo = new CopilotConversationRepository(adapter, f);
    let controller = new CopilotLocalChatController(repo, f, randomUUID);
    const conversation = await controller.create();
    const sources = new SourceDocumentRepository(adapter),
      removed: string[] = [];
    const storage = {
      persist: async ({ filename }: { filename: string }) => ({
        localUri: `file:///retained/${filename}`,
        sizeBytes: 42,
        checksum: `sha256:${"a".repeat(64)}`,
      }),
      remove: async (uri: string) => {
        removed.push(uri);
      },
    };
    const input = {
      uri: "file:///selected/brief.pdf",
      originalFilename: "Prospectus.pdf",
      mimeType: "application/pdf",
      storeId: f.storeId,
      documentId: randomUUID(),
      fileId: randomUUID(),
      capturedAt: "2026-10-13T08:00:00Z",
    };
    const captured = await captureCommercialPdf(input, sources, storage);
    const duplicate = await captureCommercialPdf(
      { ...input, documentId: randomUUID(), fileId: randomUUID() },
      sources,
      storage,
    );
    expect(duplicate.document.id).toBe(captured.document.id);
    expect(removed).toHaveLength(1);
    const before = db.prepare("SELECT count(*) AS n FROM sync_outbox").get();
    await controller.editText(conversation.id, "Pendant la copie");
    const attach = controller.attachPdf(conversation.id, captured.document.id);
    const typing = controller.editText(conversation.id, "Texte conservé");
    await Promise.all([attach, typing]);
    await controller.attachPdf(conversation.id, captured.document.id);
    expect((await controller.open(conversation.id)).draft).toMatchObject({
      text: "Texte conservé",
      attachments: [
        {
          sourceDocumentId: captured.document.id,
          filename: "Prospectus.pdf",
          mediaType: "application/pdf",
        },
      ],
    });
    expect(db.prepare("SELECT count(*) AS n FROM sync_outbox").get()).toEqual(
      before,
    );
    await controller.removeAttachment(conversation.id, captured.document.id);
    expect((await controller.open(conversation.id)).draft?.attachments).toEqual(
      [],
    );
    expect(await sources.getDocument(captured.document.id)).not.toBeNull();
    expect(
      await sources.getFileForDocument(captured.document.id),
    ).toMatchObject({ retentionStatus: "RETAINED" });
    await controller.attachPdf(conversation.id, captured.document.id);
    await controller.editText(conversation.id, "");
    db.close();
    db = new DatabaseSync(path);
    adapter = new Adapter(db);
    repo = new CopilotConversationRepository(adapter, f);
    controller = new CopilotLocalChatController(repo, f, randomUUID);
    expect(
      (await controller.open(conversation.id)).draft?.attachments,
    ).toHaveLength(1);
    const sent = await controller.send(conversation.id);
    expect(sent.text).toBe("");
    expect(sent.attachments[0]?.sourceDocumentId).toBe(captured.document.id);
    expect((await controller.open(conversation.id)).draft).toBeNull();
    expect((await controller.open(conversation.id)).pendingTurns).toHaveLength(
      1,
    );
    await expect(
      new SourceDocumentRepository(adapter).getDocument(captured.document.id),
    ).resolves.not.toBeNull();
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("refuses missing/foreign/deleted PDFs, caps draft attachments and rolls back failed or cancelled binding while retaining the sources", async () => {
  const db = new DatabaseSync(":memory:"),
    f = chatFixture(randomUUID);
  try {
    const adapter = new Adapter(db);
    await runLocalMigrations(adapter);
    const repo = new CopilotConversationRepository(adapter, f),
      controller = new CopilotLocalChatController(repo, f, randomUUID),
      sources = new SourceDocumentRepository(adapter);
    const conversation = await controller.create();
    await controller.editText(conversation.id, "Brouillon sûr");
    const ids: string[] = [];
    for (let index = 0; index < 11; index++) {
      const id = randomUUID();
      ids.push(id);
      await captureCommercialPdf(
        {
          uri: "file:///selected.pdf",
          originalFilename: `Brief ${index}.pdf`,
          storeId: f.storeId,
          documentId: id,
          fileId: randomUUID(),
          capturedAt: "2026-10-13T08:00:00Z",
        },
        sources,
        {
          persist: async ({ filename }) => ({
            localUri: `file:///retained/${filename}`,
            sizeBytes: 42,
            checksum: `sha256:${index.toString(16).padStart(64, "0")}`,
          }),
          remove: async () => {},
        },
      );
    }
    await expect(
      controller.attachPdf(conversation.id, randomUUID()),
    ).rejects.toThrow("COPILOT_ATTACHMENT_SOURCE_UNAVAILABLE");
    await adapter.runAsync(
      "UPDATE source_documents SET store_id=? WHERE id=?",
      randomUUID(),
      ids[0]!,
    );
    await expect(
      controller.attachPdf(conversation.id, ids[0]!),
    ).rejects.toThrow("COPILOT_ATTACHMENT_SOURCE_UNAVAILABLE");
    await adapter.runAsync(
      "UPDATE source_documents SET store_id=?,deleted_at=? WHERE id=?",
      f.storeId,
      "2026-10-13T09:00:00Z",
      ids[0]!,
    );
    await expect(
      controller.attachPdf(conversation.id, ids[0]!),
    ).rejects.toThrow("COPILOT_ATTACHMENT_SOURCE_UNAVAILABLE");
    await adapter.runAsync(
      "UPDATE source_documents SET deleted_at=NULL WHERE id=?",
      ids[0]!,
    );
    adapter.fail = true;
    await expect(
      controller.attachPdf(conversation.id, ids[0]!),
    ).rejects.toThrow("COMMIT_FAILED");
    adapter.fail = false;
    expect((await controller.open(conversation.id)).draft?.attachments).toEqual(
      [],
    );
    expect(await sources.getDocument(ids[0]!)).not.toBeNull();
    const abort = new AbortController(),
      original = adapter.runAsync.bind(adapter);
    adapter.runAsync = async (sql, ...params) => {
      const result = await original(sql, ...params);
      if (sql.startsWith("INSERT OR REPLACE INTO copilot_drafts"))
        abort.abort();
      return result;
    };
    await expect(
      controller.attachPdf(conversation.id, ids[0]!, abort.signal),
    ).rejects.toThrow("COPILOT_ATTACHMENT_CANCELLED");
    adapter.runAsync = original;
    expect((await controller.open(conversation.id)).draft?.attachments).toEqual(
      [],
    );
    for (const id of ids.slice(0, 10))
      await controller.attachPdf(conversation.id, id);
    await expect(
      controller.attachPdf(conversation.id, ids[10]!),
    ).rejects.toThrow("COPILOT_ATTACHMENT_LIMIT");
    expect((await controller.open(conversation.id)).draft).toMatchObject({
      text: "Brouillon sûr",
      attachments: expect.any(Array),
    });
    expect(
      (await controller.open(conversation.id)).draft?.attachments,
    ).toHaveLength(10);
    expect(await sources.getDocument(ids[10]!)).not.toBeNull();
  } finally {
    db.close();
  }
});
