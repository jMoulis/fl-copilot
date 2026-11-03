import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { runLocalMigrations } from "../db/migrations";
import { MercalysTestDatabase } from "../../../../scripts/test-mercalys-sync-fixtures";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import { buildPreparationProposalMessages } from "../../../api/src/copilot/preparation-proposal-messages";
import {
  copilotMessageSchema,
  readCopilotPreparationProposal,
} from "@fl-copilot/domain";
import {
  applyCopilotRecord,
  CopilotConversationRepository,
} from "./conversation-repository";
import { CopilotLocalChatController } from "./local-chat-controller";

async function fixture() {
  const db = new MercalysTestDatabase();
  await runLocalMigrations(db);
  const f = chatFixture(randomUUID);
  await applyCopilotRecord(db, f, "copilot_conversation", f.conversation);
  const repo = new CopilotConversationRepository(db, f);
  const messages = Array.from({ length: 125 }, (_, i) =>
    copilotMessageSchema.parse({
      ...f.message,
      id: randomUUID(),
      attachments: [],
      createdAt: new Date(
        Date.parse(f.message.createdAt) + i * 1000,
      ).toISOString(),
    }),
  );
  const assistant = copilotMessageSchema.parse({
    ...messages[0],
    role: "ASSISTANT",
    replyToMessageId: f.message.id,
  });
  const card = buildPreparationProposalMessages(assistant, [
    {
      input: {
        weekStart: "2026-11-09",
        create: { choiceIds: [] },
        patch: {
          tgCapacity: 2,
          tgAdditions: [{ label: "TG1", theme: "Agrumes", offerIds: [] }],
        },
      },
      status: "READY",
      basis: { preparation: null, creationStoreId: f.storeId, choices: [] },
      evidence: [
        {
          id: "strategy",
          sourceId: f.storeId,
          sourceType: "DATA_QUALITY",
          sourceVersion: null,
          label: "Brouillon",
          value: "À confirmer",
          factKind: "QUALITY",
        },
      ],
    },
  ])[0]!;
  messages.splice(1, 0, card);
  const page = (rows = messages, hasMore = false) => ({
    storeId: f.storeId,
    ownerId: f.ownerId,
    conversationId: f.conversation.id,
    conversations: [],
    messages: rows,
    hasMore,
    before: rows[0] ? { createdAt: rows[0].createdAt, id: rows[0].id } : null,
  });
  const read = vi.fn(
    async (_id: string, before?: { createdAt: string; id: string }) => {
      const rows = messages.filter(
        (m) =>
          !before ||
          m.createdAt < before.createdAt ||
          (m.createdAt === before.createdAt && m.id < before.id),
      );
      return page(rows.slice(-50), rows.length > 50);
    },
  );
  const controller = new CopilotLocalChatController(
    repo,
    f,
    randomUUID,
    undefined,
    read,
  );
  return { db, f, repo, messages, card, page, read, controller };
}
it("restores the missing historical preparation card in bounded pages, retaining local drafts and creating no intent", async () => {
  const f = await fixture();
  try {
    for (const m of f.messages.slice(-5))
      await applyCopilotRecord(f.db, f.f, "copilot_message", m);
    await f.repo.saveDraft(f.f.conversation.id, {
      text: "Mon brouillon en cours",
      attachments: [],
      updatedAt: f.f.message.createdAt,
    });
    expect(
      (await f.controller.open(f.f.conversation.id)).messages,
    ).toHaveLength(5);
    expect(f.read).not.toHaveBeenCalled();
    let state = await f.controller.refreshHistory(f.f.conversation.id);
    expect(state.messages).toHaveLength(50);
    const first = await f.controller.older(f.f.conversation.id, state.before!);
    const second = await f.controller.older(f.f.conversation.id, first.before!);
    expect(first.messages).toHaveLength(50);
    expect(second.messages).toHaveLength(26);
    expect(second.hasMore).toBe(false);
    expect(f.read).toHaveBeenCalledTimes(3);
    const restored = second.messages.find(
      (m) => m.entity.id === f.card.id,
    )!.entity;
    expect(restored).toEqual(f.card);
    expect(
      readCopilotPreparationProposal(restored).content.input.weekStart,
    ).toBe("2026-11-09");
    state = await f.controller.open(f.f.conversation.id, f.messages[0]);
    expect(state.messages).toHaveLength(126);
    expect(state.draft?.text).toBe("Mon brouillon en cours");
    expect(
      (await f.db.getFirstAsync<{ n: number }>(
        "SELECT COUNT(*) n FROM sync_outbox",
      ))!.n,
    ).toBe(0);
    await f.controller.refreshHistory(f.f.conversation.id);
    expect(
      (await f.repo.messages(f.f.conversation.id, 100)).messages,
    ).toHaveLength(100);
  } finally {
    f.db.db.close();
  }
});
it("opens and pages cached history offline even when the remote read fails", async () => {
  const f = await fixture();
  try {
    for (const m of f.messages)
      await applyCopilotRecord(f.db, f.f, "copilot_message", m);
    f.read.mockRejectedValue(Error("OFFLINE"));
    const local = await f.controller.open(f.f.conversation.id);
    expect(local.messages).toHaveLength(50);
    await expect(
      f.controller.refreshHistory(f.f.conversation.id),
    ).rejects.toThrow("OFFLINE");
    const older = await f.controller.older(f.f.conversation.id, local.before!);
    expect(older.messages).toHaveLength(50);
    expect(older.hasMore).toBe(true);
    expect(f.read).toHaveBeenCalledTimes(1);
  } finally {
    f.db.db.close();
  }
});
it.each(["owner", "conversation"])(
  "rejects a foreign %s before caching any message",
  async (kind) => {
    const f = await fixture();
    try {
      const page = f.page();
      if (kind === "owner") page.ownerId = randomUUID();
      else
        page.messages = [
          { ...page.messages[0]!, conversationId: randomUUID() },
        ];
      f.read.mockResolvedValue(page);
      await expect(
        f.controller.refreshHistory(f.f.conversation.id),
      ).rejects.toThrow("SCOPE_INVALID");
      expect(
        (await f.repo.messages(f.f.conversation.id)).messages,
      ).toHaveLength(0);
    } finally {
      f.db.db.close();
    }
  },
);
it("does not resurrect deleted messages or write after cancellation", async () => {
  const f = await fixture();
  try {
    const abort = new AbortController();
    abort.abort();
    await expect(
      f.controller.refreshHistory(f.f.conversation.id, abort.signal),
    ).rejects.toThrow("CANCELLED");
    expect((await f.repo.messages(f.f.conversation.id)).messages).toHaveLength(
      0,
    );
    await applyCopilotRecord(f.db, f.f, "copilot_conversation", {
      ...f.f.conversation,
      version: 2,
      deletedMessageIds: [f.messages.at(-1)!.id],
    });
    await f.controller.refreshHistory(f.f.conversation.id);
    expect(
      (await f.repo.messages(f.f.conversation.id)).messages.some(
        (m) => m.entity.id === f.messages.at(-1)!.id,
      ),
    ).toBe(false);
  } finally {
    f.db.db.close();
  }
});
it("rejects a non-advancing remote cursor without applying the invalid page", async () => {
  const f = await fixture();
  try {
    await f.controller.refreshHistory(f.f.conversation.id);
    f.read.mockImplementation(async () => f.page(f.messages.slice(-50), true));
    await expect(
      f.controller.older(f.f.conversation.id, {
        createdAt: f.messages[0]!.createdAt,
        id: f.messages[0]!.id,
      }),
    ).rejects.toThrow("CURSOR_INVALID");
  } finally {
    f.db.db.close();
  }
});
it("refuses a late page after the conversation is archived and rolls back a mixed invalid page", async () => {
  const f = await fixture();
  try {
    await expect(
      f.repo.restoreHistory(f.f.conversation.id, {
        ...f.page([
          f.messages[0]!,
          { ...f.messages[1]!, ownerId: randomUUID() },
        ]),
      }),
    ).rejects.toThrow("SCOPE_INVALID");
    expect((await f.repo.messages(f.f.conversation.id)).messages).toHaveLength(
      0,
    );
    let release!: (page: ReturnType<typeof f.page>) => void;
    f.read.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const request = f.controller.refreshHistory(f.f.conversation.id);
    await vi.waitFor(() => expect(release).toBeDefined());
    await applyCopilotRecord(f.db, f.f, "copilot_conversation", {
      ...f.f.conversation,
      status: "ARCHIVED",
      version: 2,
    });
    release(f.page());
    await expect(request).rejects.toThrow("UNAVAILABLE");
    expect((await f.repo.messages(f.f.conversation.id)).messages).toHaveLength(
      0,
    );
  } finally {
    f.db.db.close();
  }
});
it("fills a gap between old cached messages and recent sync without moving the local anchor forward", async () => {
  const f = await fixture();
  try {
    for (const m of [...f.messages.slice(0, 20), ...f.messages.slice(-5)])
      await applyCopilotRecord(f.db, f.f, "copilot_message", m);
    const current = await f.controller.refreshHistory(f.f.conversation.id);
    const first = await f.controller.older(
      f.f.conversation.id,
      current.before!,
    );
    const anchor = first.before!;
    const second = await f.controller.older(f.f.conversation.id, anchor);
    expect(second.before).toEqual(anchor);
    expect(second.hasMore).toBe(true);
    const third = await f.controller.older(f.f.conversation.id, second.before!);
    expect(third.before).toEqual(anchor);
    expect(third.hasMore).toBe(false);
    const all = await f.controller.open(f.f.conversation.id, f.messages[0]);
    expect(all.messages.map((m) => m.entity.id)).toEqual(
      f.messages.map((m) => m.id),
    );
  } finally {
    f.db.db.close();
  }
});
it("does not rewind remote paging when the initial background read arrives late", async () => {
  const f = await fixture();
  try {
    let release!: (page: ReturnType<typeof f.page>) => void;
    f.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const initial = f.controller.refreshHistory(f.f.conversation.id);
    await vi.waitFor(() => expect(release).toBeDefined());
    const first = await f.controller.older(f.f.conversation.id);
    const second = await f.controller.older(f.f.conversation.id, first.before!);
    release(f.page(f.messages.slice(-50), true));
    await initial;
    const third = await f.controller.older(f.f.conversation.id, second.before!);
    expect(third.messages).toHaveLength(26);
    expect(third.hasMore).toBe(false);
    expect(f.read).toHaveBeenCalledTimes(4);
  } finally {
    f.db.db.close();
  }
});
