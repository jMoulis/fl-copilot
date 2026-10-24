import { CopilotTurnDelivery } from "./turn-delivery";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { nativeConversationConflictFixture } from "../../../../scripts/test-conversation-conflict-fixtures";
import {
  ReceiptTestDatabase,
  receiptReviewDigest,
} from "../../../../scripts/test-receipt-publication-sqlite";
import {
  CopilotConversationRepository,
  applyCopilotRecord,
} from "./conversation-repository";
import { ConflictRepository } from "../sync/conflict-repository";
import { OutboxRepository } from "../sync/outbox-repository";
import {
  copilotConversationSchema,
  copilotMessageIsDeleted,
} from "@fl-copilot/domain";
const stamp = "2026-10-15T14:00:00.000Z";
type Fixture = Awaited<ReturnType<typeof nativeConversationConflictFixture>>;
async function context(s: Fixture) {
  return {
    ...s.ctx(),
    ...s.scope,
    reviewCaptureId: randomUUID(),
    reviewHash: (await s.review.repo.review(s.f.conversation.id)).hash,
    canResolve: () => true,
  };
}
async function snapshot(s: Fixture) {
  return {
    parent: await s.a.getFirstAsync(
      "SELECT * FROM copilot_conversations WHERE id=?",
      s.f.conversation.id,
    ),
    commands: await s.a.getAllAsync(
      "SELECT * FROM sync_outbox ORDER BY local_sequence",
    ),
    conflicts: await s.a.getAllAsync(
      "SELECT * FROM sync_conflicts ORDER BY id",
    ),
    history: await s.a.getAllAsync(
      "SELECT * FROM copilot_conversation_history ORDER BY action_id",
    ),
  };
}
for (const mode of ["GROUP", "PULL"] as const)
  it.each([true, false])(
    `refuses stale ${mode} comparison for choice %s without losing commands`,
    async (local) => {
      const s = await nativeConversationConflictFixture();
      try {
        const ctx = await context(s),
          remote = { ...s.review.remote, title: "Non examiné", version: 3 };
        if (mode === "PULL")
          await applyCopilotRecord(
            s.a,
            s.scope,
            "copilot_conversation",
            remote,
          );
        else {
          const command = await new OutboxRepository(s.a).enqueue({
            ...s.review.command,
            commandId: randomUUID(),
          });
          await new ConflictRepository(s.a).recordPushConflict(command, {
            commandId: command.commandId,
            status: "CONFLICT",
            entityType: command.entityType,
            entityId: remote.id,
            remoteVersion: 3,
            remoteEntity: remote,
          });
        }
        const before = await snapshot(s);
        await expect(
          s.review.repo.resolve(remote.id, local, ctx),
        ).rejects.toThrow("REVIEW_CHANGED");
        expect(await snapshot(s)).toEqual(before);
        const fresh = await context(s);
        await s.review.repo.resolve(remote.id, local, fresh);
        expect((await s.review.repo.get(remote.id))!.title).toBe(
          local ? "Titre local" : "Non examiné",
        );
        expect(
          await new ConflictRepository(s.a).listOpen(s.scope.storeId),
        ).toEqual([]);
        expect(
          (await s.review.repo.messages(remote.id)).messages[0]!.entity,
        ).toEqual(s.f.message);
      } finally {
        s.db.close();
      }
    },
  );
for (const deletion of ["CONVERSATION", "MESSAGE"] as const)
  it(`projects a received ${deletion} deletion into the actual local header and suppresses pending replay without erasing intent`, async () => {
    const s = await nativeConversationConflictFixture();
    try {
      const pending = s.db.prepare("SELECT * FROM copilot_pending_turns").all(),
        packets = s.db.prepare("SELECT * FROM sync_outbox").all(),
        draft = await s.review.repo.draft(s.f.conversation.id),
        remote = copilotConversationSchema.parse({
          ...s.review.remote,
          version: 3,
          updatedAt: stamp,
          ...(deletion === "CONVERSATION"
            ? { status: "ARCHIVED", deletedAt: stamp }
            : { deletedMessageIds: [s.f.message.id] }),
        });
      await applyCopilotRecord(s.a, s.scope, "copilot_conversation", remote);
      const parent = (await s.review.repo.get(remote.id))!;
      expect(copilotMessageIsDeleted(s.f.message, parent)).toBe(true);
      const persisted = JSON.parse(
        s.db.prepare("SELECT payload_json FROM copilot_conversations").get()!
          .payload_json as string,
      );
      expect(copilotMessageIsDeleted(s.f.message, persisted)).toBe(true);
      expect(await s.review.repo.pendingTurns(remote.id)).toEqual([]);
      expect(s.db.prepare("SELECT * FROM copilot_pending_turns").all()).toEqual(
        pending,
      );
      expect(s.db.prepare("SELECT * FROM sync_outbox").all()).toEqual(packets);
      expect(await s.review.repo.draft(remote.id)).toEqual(draft);
      expect(
        (await s.review.repo.messages(remote.id)).messages[0]!.entity
          .attachments,
      ).toEqual(s.f.message.attachments);
    } finally {
      s.db.close();
    }
  });
for (const deletion of ["CONVERSATION", "MESSAGE"] as const)
  it.each([true, false])(
    `never undoes local ${deletion} deletion when choosing metadata %s`,
    async (local) => {
      const s = await nativeConversationConflictFixture(":memory:", deletion);
      try {
        const ctx = await context(s),
          old = s.review.command.payload;
        expect(
          copilotMessageIsDeleted(
            s.f.message,
            (await s.review.repo.get(s.f.conversation.id))!,
          ),
        ).toBe(true);
        await s.review.repo.resolve(s.f.conversation.id, local, ctx);
        const resolved = (await s.review.repo.get(s.f.conversation.id))!;
        expect(copilotMessageIsDeleted(s.f.message, resolved)).toBe(true);
        expect(resolved.title).toBe(
          local ? s.review.local.title : s.review.remote.title,
        );
        expect(resolved.version).toBe(3);
        const packets = (
          await new OutboxRepository(s.a).listPending(s.scope.storeId)
        ).filter((c) => c.entityType === "copilot_conversation");
        expect(packets).toHaveLength(1);
        expect(packets[0]).toMatchObject({
          commandId: ctx.commandId,
          expectedRemoteVersion: 2,
          payload: resolved,
        });
        const oldCommand = s.db
          .prepare(
            "SELECT payload_json,status FROM sync_outbox WHERE command_id=?",
          )
          .get(s.review.command.commandId)!;
        expect(JSON.parse(oldCommand.payload_json as string)).toEqual(old);
        expect(oldCommand.status).toBe("FAILED");
        await expect(
          s.review.repo.resolve(resolved.id, local, ctx),
        ).rejects.toThrow("REVIEW_CHANGED");
      } finally {
        s.db.close();
      }
    },
  );
it("retains the canonical whole-deletion timestamp and both sets of deleted messages, regardless of metadata choice", async () => {
  const s = await nativeConversationConflictFixture(":memory:", "CONVERSATION");
  try {
    const remote = {
      ...s.review.remote,
      version: 3,
      status: "ARCHIVED",
      deletedAt: "2026-10-16T14:00:00.000Z",
      updatedAt: "2026-10-16T14:00:00.000Z",
      deletedMessageIds: [s.f.message.id],
    };
    await applyCopilotRecord(s.a, s.scope, "copilot_conversation", remote);
    await s.review.repo.resolve(remote.id, true, await context(s));
    expect(await s.review.repo.get(remote.id)).toMatchObject({
      deletedAt: remote.deletedAt,
      deletedMessageIds: remote.deletedMessageIds,
      status: "ARCHIVED",
    });
  } finally {
    s.db.close();
  }
});
it.each(["OWNER", "STORE", "CANCEL", "SIGNAL", "COMMIT", "CAPTURE"] as const)(
  "refuses or rolls back a %s change with exact retained snapshots",
  async (mode) => {
    const s = await nativeConversationConflictFixture();
    try {
      const ctx = await context(s),
        before = await snapshot(s),
        abort = new AbortController();
      if (mode === "OWNER") ctx.ownerId = randomUUID();
      if (mode === "STORE") ctx.storeId = randomUUID();
      if (mode === "CANCEL") ctx.canResolve = () => false;
      if (mode === "SIGNAL") abort.abort();
      if (mode === "COMMIT") s.a.fail = true;
      if (mode === "CAPTURE") ctx.reviewCaptureId = ctx.commandId;
      await expect(
        s.review.repo.resolve(s.f.conversation.id, true, {
          ...ctx,
          signal: abort.signal,
        }),
      ).rejects.toThrow();
      expect(await snapshot(s)).toEqual(before);
    } finally {
      s.db.close();
    }
  },
);
it.each([
  "CACHE",
  "FOREIGN_COMMAND",
  "FOREIGN_CONFLICT",
  "SYNCING",
  "NULL_REMOTE",
  "TOO_MANY",
] as const)(
  "disables both choices with %s and preserves state",
  async (mode) => {
    const s = await nativeConversationConflictFixture();
    try {
      if (mode === "CACHE")
        await s.a.runAsync(
          "UPDATE copilot_conversations SET remote_version=99",
        );
      if (mode === "FOREIGN_COMMAND")
        await s.a.runAsync(
          "UPDATE sync_outbox SET payload_json=? WHERE command_id=?",
          JSON.stringify({ ...s.review.local, ownerId: randomUUID() }),
          s.review.command.commandId,
        );
      if (mode === "FOREIGN_CONFLICT")
        await s.a.runAsync(
          "UPDATE sync_conflicts SET local_payload_json=?",
          JSON.stringify({ ...s.review.local, ownerId: randomUUID() }),
        );
      if (mode === "SYNCING")
        await s.a.runAsync(
          "UPDATE sync_outbox SET status='SYNCING' WHERE command_id=?",
          s.review.command.commandId,
        );
      if (mode === "NULL_REMOTE") {
        await s.a.runAsync("DELETE FROM sync_conflicts");
        await s.a.runAsync(
          "UPDATE copilot_conversations SET remote_payload_json=NULL,remote_version=NULL",
        );
      }
      if (mode === "TOO_MANY")
        for (let n = 0; n < 100; n++) {
          const command = await new OutboxRepository(s.a).enqueue({
            ...s.review.command,
            commandId: randomUUID(),
          });
          await new ConflictRepository(s.a).recordPushConflict(command, {
            commandId: command.commandId,
            status: "CONFLICT",
            entityType: command.entityType,
            entityId: command.entityId,
            remoteVersion: 2,
            remoteEntity: s.review.remote,
          });
        }
      const review = await s.review.repo.review(s.f.conversation.id),
        before = await snapshot(s);
      expect(review.ready).toBe(false);
      expect(review.canKeepLocal).toBe(false);
      expect(review.canAdoptRemote).toBe(false);
      await expect(
        s.review.repo.resolve(s.f.conversation.id, false, await context(s)),
      ).rejects.toThrow();
      expect(await snapshot(s)).toEqual(before);
    } finally {
      s.db.close();
    }
  },
);
it("captures a newer pull baseline independently of the new command and survives ACK, another conflict and offline restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-conversation-review-")),
    path = join(dir, "chat.db"),
    s = await nativeConversationConflictFixture(path);
  let closed = false;
  try {
    const remote = { ...s.review.remote, version: 3, title: "Base après pull" };
    await applyCopilotRecord(s.a, s.scope, "copilot_conversation", remote);
    const ctx = await context(s);
    await s.review.repo.resolve(remote.id, true, ctx);
    const command = (
      await new OutboxRepository(s.a).listPending(s.scope.storeId)
    ).find((c) => c.commandId === ctx.commandId)!;
    const newer = { ...remote, version: 4, title: "Conflit ultérieur" };
    await new ConflictRepository(s.a).recordPushConflict(command, {
      commandId: command.commandId,
      status: "CONFLICT",
      entityType: command.entityType,
      entityId: command.entityId,
      remoteVersion: 4,
      remoteEntity: newer,
    });
    const captures = s.db
      .prepare("SELECT * FROM sync_conflicts WHERE id=?")
      .get(ctx.reviewCaptureId)!;
    expect(JSON.parse(captures.remote_payload_json as string)).toEqual(remote);
    expect(captures.command_id).toBeNull();
    expect(
      (await new ConflictRepository(s.a).getById(ctx.commandId))!.status,
    ).toBe("OPEN");
    await applyCopilotRecord(
      s.a,
      s.scope,
      "copilot_conversation",
      command.payload,
      4,
    );
    s.db.close();
    closed = true;
    const reopened = new DatabaseSync(path);
    try {
      const repo = new CopilotConversationRepository(
        new ReceiptTestDatabase(reopened),
        s.scope,
        receiptReviewDigest,
      );
      expect((await repo.get(remote.id))!.title).toBe("Titre local");
      expect((await repo.messages(remote.id)).messages[0]!.entity).toEqual(
        s.f.message,
      );
      expect(await repo.draft(remote.id)).not.toBeNull();
      expect(
        JSON.parse(
          reopened
            .prepare(
              "SELECT remote_payload_json FROM sync_conflicts WHERE id=?",
            )
            .get(ctx.reviewCaptureId)!.remote_payload_json as string,
        ),
      ).toEqual(remote);
    } finally {
      reopened.close();
    }
  } finally {
    if (!closed) s.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it.each([true, false])(
  "recovers an owned legacy ERROR with verified cache (%s) without inventing an absent remote",
  async (local) => {
    const s = await nativeConversationConflictFixture();
    try {
      await s.a.runAsync("DELETE FROM sync_conflicts");
      await s.a.runAsync("UPDATE copilot_conversations SET sync_state='ERROR'");
      expect((await s.review.repo.review(s.f.conversation.id)).ready).toBe(
        true,
      );
      await s.review.repo.resolve(s.f.conversation.id, local, await context(s));
      expect((await s.review.repo.get(s.f.conversation.id))!.title).toBe(
        local ? "Titre local" : "Titre synchronisé",
      );
    } finally {
      s.db.close();
    }
  },
);

it("rolls back a resolution if authority is lost after its first SQLite write", async () => {
  const s = await nativeConversationConflictFixture();
  try {
    let active = true;
    const ctx = { ...(await context(s)), canResolve: () => active },
      before = await snapshot(s);
    s.a.afterRun = (sql) => {
      if (sql.startsWith("UPDATE sync_outbox")) active = false;
    };
    await expect(
      s.review.repo.resolve(s.f.conversation.id, true, ctx),
    ).rejects.toThrow("FORBIDDEN");
    expect(await snapshot(s)).toEqual(before);
  } finally {
    s.db.close();
  }
});
it("a matching acknowledgement cannot erase a locally retained deletion; the exact remote cache remains reviewable", async () => {
  const s = await nativeConversationConflictFixture(":memory:", "MESSAGE");
  try {
    await applyCopilotRecord(
      s.a,
      s.scope,
      "copilot_conversation",
      s.review.remote,
      2,
    );
    const parent = (await s.review.repo.get(s.f.conversation.id))!;
    expect(copilotMessageIsDeleted(s.f.message, parent)).toBe(true);
    expect(
      s.db.prepare("SELECT sync_state FROM copilot_conversations").get()!
        .sync_state,
    ).toBe("ERROR");
    const review = await s.review.repo.review(parent.id);
    expect(review.ready).toBe(true);
    expect(review.group.remote).toEqual(s.review.remote);
    expect(review.remoteChoiceNeedsSend).toBe(true);
  } finally {
    s.db.close();
  }
});

it.each(["CONVERSATION", "MESSAGE"] as const)(
  "does not call the AI after %s deletion arrives during question synchronization",
  async (deletion) => {
    const s = await nativeConversationConflictFixture();
    try {
      let calls = 0;
      const remote = copilotConversationSchema.parse({
          ...s.review.remote,
          version: 3,
          updatedAt: stamp,
          ...(deletion === "CONVERSATION"
            ? { status: "ARCHIVED", deletedAt: stamp }
            : { deletedMessageIds: [s.f.message.id] }),
        }),
        delivery = new CopilotTurnDelivery(s.a, s.scope, {
          sync: async () => {
            await s.a.runAsync(
              "UPDATE copilot_messages SET sync_state='SYNCED' WHERE id=?",
              s.f.message.id,
            );
            await applyCopilotRecord(
              s.a,
              s.scope,
              "copilot_conversation",
              remote,
            );
          },
          ask: async () => {
            calls++;
            throw Error("MUST_NOT_CALL_PROVIDER");
          },
        });
      await expect(delivery.deliver(s.f.conversation.id)).rejects.toThrow(
        /COPILOT_(CONVERSATION_UNAVAILABLE|REPLY_PARENT_INVALID)/,
      );
      expect(calls).toBe(0);
      expect(await s.review.repo.pendingTurns(s.f.conversation.id)).toEqual([]);
      expect(s.count("copilot_pending_turns")).toBe(1);
      expect(
        copilotMessageIsDeleted(
          s.f.message,
          (await s.review.repo.get(s.f.conversation.id))!,
        ),
      ).toBe(true);
    } finally {
      s.db.close();
    }
  },
);
