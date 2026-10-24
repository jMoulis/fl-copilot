import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import {
  visualRecoveryActionFixture,
  recoveryActionDigest,
} from "../../../../scripts/test-visual-recovery-action-fixtures";
import { serializedTestDatabase } from "../../../../scripts/test-serialized-sqlite";
import { CopilotVisualActionController } from "./visual-action-controller";
import type { VisualEntityType } from "@fl-copilot/domain";
const kinds = [
  "visual_asset",
  "visual_identity",
  "product_visual_link",
] as const;
type Fixture = Awaited<ReturnType<typeof visualRecoveryActionFixture>>;
function snapshot(s: Fixture) {
  return [
    "products",
    "product_identifiers",
    "product_aliases",
    "visual_assets",
    "visual_identities",
    "product_visual_links",
    "sync_outbox",
    "visual_conflict_history",
    "local_jobs",
    "copilot_tool_results",
  ].map((t) => s.db.raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all());
}
for (const kind of kinds)
  for (const known of [false, true])
    it(`retries the exact ${kind}, ${known ? "known baseline" : "strict create"}, once with canonical history and no source rewrite`, async () => {
      const s = await visualRecoveryActionFixture(kind, known);
      try {
        expect(s.preview.status).toBe("REVIEW_LOCAL");
        expect(s.state.status).toBe("READY");
        expect(s.selected.review.canRetry).toBe(true);
        const before = snapshot(s),
          original = s.selected.review.current.entity;
        const r = await s.controller.confirmRecovery(s.message, s.request);
        expect(r.status).toBe("COMPLETED");
        expect(r.result).toMatchObject({
          action: "REVIEW_RECOVERY",
          kind,
          entityId: s.targetId,
          syncState: "PENDING",
        });
        const current = (await s.library.get(kind, s.f.storeId, s.targetId))!;
        expect(current.entity.id).toBe(original.id);
        if (kind === "visual_asset")
          expect(current.entity).toMatchObject({
            contentHash: s.f.asset.contentHash,
            provenance: s.f.asset.provenance,
          });
        expect(s.db.raw.prepare("SELECT * FROM products").all()).toEqual(
          before[0],
        );
        expect(
          s.db.raw
            .prepare("SELECT COUNT(*) n FROM visual_conflict_history")
            .get()!.n,
        ).toBe(1);
        expect(
          s.db.raw.prepare("SELECT COUNT(*) n FROM copilot_tool_results").get()!
            .n,
        ).toBe(1);
        const pending = (await s.outbox.listPending(s.f.storeId)).filter(
          (c) => c.entityId === s.targetId,
        );
        expect(pending).toHaveLength(1);
        expect(pending[0]!.commandId).not.toBe(s.failedCommand);
        expect(pending[0]!.expectedRemoteVersion).toBe(known ? 1 : null);
        const after = snapshot(s);
        expect(
          (await s.controller.confirmRecovery(s.message, s.request)).result,
        ).toEqual(r.result);
        expect(snapshot(s)).toEqual(after);
        await expect(
          s.controller.confirmRecovery(s.message, {
            ...s.request,
            recoveryAction: "RETIRE_LOCAL",
          }),
        ).rejects.toThrow("VISUAL_ACTION_DECISION_CHANGED");
      } finally {
        s.db.raw.close();
      }
    });
it.each([
  "REMOVE_LINK",
  "RETIRE_ASSET",
  "RETIRE_IDENTITY",
  "ADOPT_ASSET",
  "ADOPT_IDENTITY",
  "ADOPT_LINK",
] as const)("uses the manual canonical recovery action %s", async (mode) => {
  const kind: VisualEntityType = mode.includes("IDENTITY")
    ? "visual_identity"
    : mode.includes("LINK")
      ? "product_visual_link"
      : "visual_asset";
  const known = mode.startsWith("ADOPT");
  const s = await visualRecoveryActionFixture(kind, known);
  try {
    const action =
      mode === "REMOVE_LINK"
        ? "REMOVE_LINK"
        : known
          ? "ADOPT_REMOTE"
          : "RETIRE_LOCAL";
    const result = await s.controller.confirmRecovery(s.message, {
      ...s.request,
      recoveryAction: action,
    });
    expect(result.result!.recoveryAction).toBe(action);
    const current = (await s.library.get(kind, s.f.storeId, s.targetId))!;
    if (known) {
      expect(current.entity).toEqual(s.selected.review.remote);
      expect(current.syncState).toBe("SYNCED");
      expect(
        (await s.outbox.listPending(s.f.storeId)).filter(
          (c) => c.entityId === s.targetId,
        ),
      ).toEqual([]);
    } else expect(current.entity.deletedAt).not.toBeNull();
    expect(
      s.db.raw.prepare("SELECT COUNT(*) n FROM visual_conflict_history").get()!
        .n,
    ).toBe(1);
  } finally {
    s.db.raw.close();
  }
});
it.each([
  "ROLE",
  "ABORT",
  "BASIS",
  "TARGET",
  "RIGHTS",
  "PRIVATE_MESSAGE",
  "DELETED_QUESTION",
  "COHORT",
  "PRODUCT",
  "CANCEL_DURING_WRITE",
  "RESULT_FAILURE",
] as const)(
  "refuses %s with no partial metadata, command, history or result write",
  async (mode) => {
    const s = await visualRecoveryActionFixture();
    try {
      const a = new AbortController();
      let allowed = true;
      if (mode === "ABORT") a.abort();
      if (mode === "PRIVATE_MESSAGE" || mode === "DELETED_QUESTION")
        await s.db.runAsync(
          "UPDATE copilot_conversations SET payload_json=? WHERE id=?",
          JSON.stringify({
            ...s.chat.conversation,
            deletedMessageIds: [
              mode === "PRIVATE_MESSAGE" ? s.message.id : s.chat.message.id,
            ],
          }),
          s.chat.conversation.id,
        );
      if (mode === "COHORT")
        await s.db.runAsync(
          "UPDATE visual_identities SET sync_state='ERROR' WHERE id=?",
          s.f.identity.id,
        );
      if (mode === "PRODUCT")
        await s.db.runAsync(
          "UPDATE products SET label='Changement' WHERE id=?",
          s.f.product.id,
        );
      const original = s.db.transaction.runAsync.bind(s.db.transaction);
      if (mode === "CANCEL_DURING_WRITE")
        s.db.transaction.runAsync = async (sql, ...params) => {
          const r = await original(sql, ...params);
          if (sql.startsWith("INSERT INTO visual_conflict_history"))
            allowed = false;
          return r;
        };
      if (mode === "RESULT_FAILURE")
        s.db.raw.exec(
          "CREATE TRIGGER refuse_result BEFORE INSERT ON copilot_tool_results BEGIN SELECT RAISE(ABORT,'RESULT_FAILURE'); END",
        );
      const before = snapshot(s),
        controller =
          mode === "ROLE"
            ? new CopilotVisualActionController(
                s.db,
                { ...s.scope, canManageVisualLibrary: false },
                recoveryActionDigest,
                randomUUID,
              )
            : s.controller;
      await expect(
        controller.confirmRecovery(
          s.message,
          {
            ...s.request,
            ...(mode === "BASIS" ? { basisHash: "0".repeat(64) } : {}),
            ...(mode === "TARGET" ? { entityId: randomUUID() } : {}),
            ...(mode === "RIGHTS" ? { rightsConfirmed: false } : {}),
          },
          a.signal,
          () => allowed,
        ),
      ).rejects.toThrow();
      expect(snapshot(s)).toEqual(before);
    } finally {
      s.db.raw.close();
    }
  },
);
it("keeps a manager's local cleanup available with no synchronized product proof, and with a missing local parent", async () => {
  const s = await visualRecoveryActionFixture(
    "product_visual_link",
    false,
    ":memory:",
    false,
  );
  try {
    await s.db.runAsync("DELETE FROM products WHERE id=?", s.f.product.id);
    const state = await s.controller.openRecovery(s.message);
    expect(state.status).toBe("READY");
    expect(state.review!.targets[0]!.review.canRetry).toBe(false);
    expect(state.review!.targets[0]!.review.canRemove).toBe(true);
    await s.controller.confirmRecovery(s.message, {
      ...s.request,
      basisHash: state.review!.basisHash,
      recoveryAction: "REMOVE_LINK",
    });
    expect(
      (await s.library.get("product_visual_link", s.f.storeId, s.f.link.id))!
        .entity.deletedAt,
    ).not.toBeNull();
  } finally {
    s.db.raw.close();
  }
});
it("reopens a committed decision from disk without a second retry or fabricated acknowledgement", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-visual-recovery-chat-")),
    path = join(dir, "device.db");
  const s = await visualRecoveryActionFixture("visual_asset", false, path);
  let reopened: ReturnType<typeof serializedTestDatabase> | undefined;
  try {
    const result = await s.controller.confirmRecovery(s.message, s.request);
    s.db.raw.close();
    reopened = serializedTestDatabase(new DatabaseSync(path));
    const controller = new CopilotVisualActionController(
      reopened,
      s.scope,
      recoveryActionDigest,
      randomUUID,
    );
    expect((await controller.openRecovery(s.message)).result).toEqual(
      result.result,
    );
    expect(
      (await controller.confirmRecovery(s.message, s.request)).result,
    ).toEqual(result.result);
    expect(
      reopened.raw
        .prepare("SELECT COUNT(*) n FROM visual_conflict_history")
        .get()!.n,
    ).toBe(1);
  } finally {
    try {
      s.db.raw.close();
    } catch {
      /* already closed */
    }
    reopened?.raw.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("cancels while queued behind the canonical writer and never applies a retained confirmation", async () => {
  const s = await visualRecoveryActionFixture();
  let release: () => void = () => {};
  let entered: () => void = () => {};
  try {
    const held = new Promise<void>((resolve) => {
        release = resolve;
      }),
      started = new Promise<void>((resolve) => {
        entered = resolve;
      });
    const blocker = s.db.withExclusiveTransactionAsync(async () => {
      entered();
      await held;
    });
    await started;
    let allowed = true;
    const before = snapshot(s),
      pending = s.controller.confirmRecovery(
        s.message,
        s.request,
        undefined,
        () => allowed,
      );
    allowed = false;
    release();
    await blocker;
    await expect(pending).rejects.toThrow();
    expect(snapshot(s)).toEqual(before);
  } finally {
    release();
    s.db.raw.close();
  }
});
