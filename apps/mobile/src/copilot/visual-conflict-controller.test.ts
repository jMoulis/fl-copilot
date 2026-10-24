import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  copilotVisualKinds,
  readStoreConflictProposal,
  storeConflictV6InputSchema,
} from "@fl-copilot/domain";
import { nativeVisualChatConflictFixture } from "../../../../scripts/test-visual-chat-conflict-fixtures";
import { OutboxRepository } from "../sync/outbox-repository";
it.each(copilotVisualKinds)(
  "confirms both %s choices with canonical metadata/history and explicit rights",
  async (kind) => {
    for (const decision of ["KEEP_LOCAL", "ADOPT_REMOTE"] as const) {
      const s = await nativeVisualChatConflictFixture(kind);
      try {
        expect(s.state.status).toBe("READY");
        expect(readStoreConflictProposal(s.message).content.schemaVersion).toBe(
          7,
        );
        expect(
          storeConflictV6InputSchema.safeParse({
            kind,
            entityId: s.review.remote.id,
          }).success,
        ).toBe(false);
        expect(s.message.text).not.toMatch(
          /sourceUrl|confirmedBy|license|storageKey|localUri|https:/,
        );
        const before = s.db.prepare("SELECT * FROM products ORDER BY id").all();
        const result = await s.controller.confirm(
          s.message,
          s.state.review!.basisHash,
          decision,
          true,
          undefined,
          {
            confirmVisualRights:
              kind === "VISUAL_ASSET" && decision === "KEEP_LOCAL",
          },
        );
        expect(result.status).toBe("COMPLETED");
        const after = await s.library.get(
          s.kind,
          s.scope.storeId,
          s.review.remote.id,
        );
        expect(after!.entity.version).toBe(decision === "KEEP_LOCAL" ? 3 : 2);
        expect(
          (await new OutboxRepository(s.a).listPending(s.scope.storeId)).filter(
            (x) => x.entityType === s.kind,
          ),
        ).toHaveLength(decision === "KEEP_LOCAL" ? 1 : 0);
        expect(
          s.db.prepare("SELECT * FROM products ORDER BY id").all(),
        ).toEqual(before);
        expect(
          s.db
            .prepare(
              "SELECT status,last_error_code FROM sync_outbox WHERE command_id=?",
            )
            .get(s.review.command.commandId),
        ).toEqual({
          status: "FAILED",
          last_error_code: "VISUAL_LIBRARY_SUPERSEDED",
        });
        expect(
          s.db.prepare("SELECT COUNT(*) n FROM visual_conflict_history").get()!
            .n,
        ).toBe(1);
        expect(
          (
            await s.controller.confirm(
              s.message,
              s.state.review!.basisHash,
              decision,
              true,
              undefined,
              { confirmVisualRights: true },
            )
          ).result,
        ).toEqual(result.result);
      } finally {
        s.db.close();
      }
    }
  },
);
it("does not infer user-upload rights from the comparison switch", async () => {
  const s = await nativeVisualChatConflictFixture("VISUAL_ASSET");
  try {
    const before = s.db.prepare("SELECT * FROM visual_assets").all();
    await expect(
      s.controller.confirm(
        s.message,
        s.state.review!.basisHash,
        "KEEP_LOCAL",
        true,
      ),
    ).rejects.toThrow();
    expect(s.db.prepare("SELECT * FROM visual_assets").all()).toEqual(before);
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM visual_conflict_history").get()!.n,
    ).toBe(0);
  } finally {
    s.db.close();
  }
});
it.each(copilotVisualKinds)(
  "replays %s after a real SQLite close/reopen without another command",
  async (kind) => {
    const { DatabaseSync } = await import("node:sqlite"),
      { mkdtempSync, rmSync } = await import("node:fs"),
      { join } = await import("node:path"),
      { tmpdir } = await import("node:os"),
      { ReceiptTestDatabase, receiptReviewDigest } =
        await import("../../../../scripts/test-receipt-publication-sqlite"),
      { CopilotStoreConflictController } =
        await import("./store-conflict-controller");
    const dir = mkdtempSync(join(tmpdir(), "visual-chat-")),
      s = await nativeVisualChatConflictFixture(kind, join(dir, "local.db"));
    let reopened: InstanceType<typeof DatabaseSync> | undefined;
    try {
      const consent = { confirmVisualRights: kind === "VISUAL_ASSET" },
        saved = await s.controller.confirm(
          s.message,
          s.state.review!.basisHash,
          "KEEP_LOCAL",
          true,
          undefined,
          consent,
        ),
        before = s.db
          .prepare("SELECT * FROM sync_outbox ORDER BY command_id")
          .all();
      s.db.close();
      reopened = new DatabaseSync(join(dir, "local.db"));
      const controller = new CopilotStoreConflictController(
        new ReceiptTestDatabase(reopened),
        s.chatScope,
        receiptReviewDigest,
        randomUUID,
      );
      expect(
        (
          await controller.confirm(
            s.message,
            s.state.review!.basisHash,
            "KEEP_LOCAL",
            true,
            undefined,
            consent,
          )
        ).result,
      ).toEqual(saved.result);
      expect(
        reopened.prepare("SELECT * FROM sync_outbox ORDER BY command_id").all(),
      ).toEqual(before);
    } finally {
      if (reopened) reopened.close();
      else s.db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
it.each(copilotVisualKinds)(
  "requires an explicit %s reactivation independently of upload rights",
  async (kind) => {
    const s = await nativeVisualChatConflictFixture(kind, ":memory:", "REMOTE");
    try {
      const before = s.db.prepare(`SELECT * FROM ${s.review.table}`).all();
      await expect(
        s.controller.confirm(
          s.message,
          s.state.review!.basisHash,
          "KEEP_LOCAL",
          true,
          undefined,
          { confirmVisualRights: true },
        ),
      ).rejects.toThrow();
      expect(s.db.prepare(`SELECT * FROM ${s.review.table}`).all()).toEqual(
        before,
      );
      await s.controller.confirm(
        s.message,
        s.state.review!.basisHash,
        "KEEP_LOCAL",
        true,
        undefined,
        {
          confirmVisualRights: kind === "VISUAL_ASSET",
          reactivateRejected: true,
        },
      );
      expect(
        (await s.library.get(s.kind, s.scope.storeId, s.review.local.id))!
          .entity.deletedAt,
      ).toBeNull();
    } finally {
      s.db.close();
    }
  },
);
for (const kind of copilotVisualKinds)
  it.each(["ROLE", "HASH", "ABORT"] as const)(
    `${kind} refuses %s without metadata, history or journal changes`,
    async (scenario) => {
      const s = await nativeVisualChatConflictFixture(kind);
      try {
        const { CopilotStoreConflictController } =
            await import("./store-conflict-controller"),
          { receiptReviewDigest } =
            await import("../../../../scripts/test-receipt-publication-sqlite");
        const controller =
            scenario === "ROLE"
              ? new CopilotStoreConflictController(
                  s.a,
                  {
                    ...s.chatScope,
                    canManageProducts: true,
                    canManageVisualLibrary: false,
                  },
                  receiptReviewDigest,
                  randomUUID,
                )
              : s.controller,
          abort = new AbortController();
        if (scenario === "ABORT") abort.abort();
        const snapshot = () =>
            [
              s.review.table,
              "visual_conflict_history",
              "sync_outbox",
              "sync_conflicts",
              "copilot_tool_results",
            ].map((t) =>
              s.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
            ),
          before = snapshot();
        await expect(
          controller.confirm(
            s.message,
            scenario === "HASH" ? "0".repeat(64) : s.state.review!.basisHash,
            "KEEP_LOCAL",
            true,
            abort.signal,
            { confirmVisualRights: true },
          ),
        ).rejects.toThrow();
        expect(snapshot()).toEqual(before);
      } finally {
        s.db.close();
      }
    },
  );
