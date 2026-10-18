import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import {
  readStoreConflictProposal,
  productSubstitutionSchema,
} from "@fl-copilot/domain";
import { nativeNeedConflictFixture } from "../../../../scripts/test-need-conflict-fixtures";
import {
  ReceiptTestDatabase,
  receiptReviewDigest,
} from "../../../../scripts/test-receipt-publication-sqlite";
import { CopilotStoreConflictController } from "./store-conflict-controller";
import { readStoreConflictCurrent } from "./store-conflict-review";
import { OutboxRepository } from "../sync/outbox-repository";
const kinds = ["NEED", "MEMBERSHIP", "SUBSTITUTION"] as const;
it.each(kinds)(
  "resolves both %s choices locally and replays after reopen with no duplicate command",
  async (kind) => {
    for (const decision of ["KEEP_LOCAL", "ADOPT_REMOTE"] as const) {
      const dir = mkdtempSync(join(tmpdir(), "fl-need-conflict-")),
        path = join(dir, "native.db"),
        s = await nativeNeedConflictFixture(kind, path);
      let reopened: DatabaseSync | undefined;
      try {
        const r = s.review;
        expect(r.state.status).toBe("READY");
        expect(readStoreConflictProposal(r.message).content.schemaVersion).toBe(
          2,
        );
        expect(
          (
            await r.controller.confirm(
              r.message,
              r.state.review!.basisHash,
              decision,
              true,
            )
          ).status,
        ).toBe("COMPLETED");
        const content = readStoreConflictProposal(r.message).content,
          current = await readStoreConflictCurrent(
            s.a,
            content,
            receiptReviewDigest,
          );
        expect(current!.entity.version).toBe(decision === "KEEP_LOCAL" ? 3 : 2);
        if (decision === "ADOPT_REMOTE")
          expect(current!.entity).toEqual(r.remote);
        if (kind === "SUBSTITUTION") {
          const e = productSubstitutionSchema.parse(current!.entity),
            remote = productSubstitutionSchema.parse(r.remote);
          expect(e).toMatchObject({
            sourceProductId: r.product.id,
            substituteProductId: r.substitute.id,
            observedSubstitution: remote.observedSubstitution,
            relationshipScore: remote.relationshipScore,
            confidence: remote.confidence,
            evidenceCount: remote.evidenceCount,
            lastEvidenceAt: remote.lastEvidenceAt,
          });
          expect(s.count("product_substitutions")).toBe(1);
        }
        const commands = (
          await new OutboxRepository(s.a).listPending(s.scope.storeId)
        ).filter((c) => c.entityType === r.entityType);
        expect(commands).toHaveLength(decision === "KEEP_LOCAL" ? 1 : 0);
        if (commands[0]) expect(commands[0].expectedRemoteVersion).toBe(2);
        expect(s.count("sales_observations")).toBe(0);
        expect(s.count("waste_observations")).toBe(0);
        const outbox = s.db
          .prepare("SELECT * FROM sync_outbox ORDER BY local_sequence")
          .all();
        s.db.close();
        reopened = new DatabaseSync(path);
        const controller = new CopilotStoreConflictController(
          new ReceiptTestDatabase(reopened),
          r.scope,
          receiptReviewDigest,
          randomUUID,
        );
        expect(
          (
            await controller.confirm(
              r.message,
              r.state.review!.basisHash,
              decision,
              true,
            )
          ).status,
        ).toBe("COMPLETED");
        expect(
          reopened
            .prepare("SELECT * FROM sync_outbox ORDER BY local_sequence")
            .all(),
        ).toEqual(outbox);
        r.scope.canManageProducts = false;
        await expect(controller.open(r.message)).rejects.toThrow("FORBIDDEN");
      } finally {
        if (reopened) reopened.close();
        else s.db.close();
        rmSync(dir, { recursive: true, force: true });
      }
    }
  },
);
it.each([
  "RIGHTS",
  "UNCHECKED",
  "LOCAL",
  "REMOTE",
  "COMMAND",
  "DELETED",
  "ARCHIVED",
  "PRODUCT",
  "NEED",
  "PARENT_CONFLICT",
  "COMMIT",
  "CANCEL",
])(
  "preserves versions, history and commands on refusal or stale state (%s)",
  async (mode) => {
    for (const kind of kinds) {
      const s = await nativeNeedConflictFixture(kind);
      try {
        const r = s.review,
          cancel = new AbortController();
        if (mode === "RIGHTS") {
          r.scope.canManageProducts = false;
          r.scope.canCaptureStoreEvents = true;
          r.scope.canManageStoreSettings = true;
        }
        if (mode === "LOCAL")
          await s.a.runAsync(
            `UPDATE ${r.table} SET payload_json=json_set(payload_json,'$.version',99) WHERE id=?`,
            r.remote.id,
          );
        if (mode === "REMOTE")
          await s.a.runAsync(
            "UPDATE sync_conflicts SET remote_payload_json=json_set(remote_payload_json,'$.version',99) WHERE id=?",
            r.conflict.id,
          );
        if (mode === "COMMAND")
          await s.a.runAsync(
            "UPDATE sync_outbox SET status='SYNCING' WHERE command_id=?",
            r.command.commandId,
          );
        if (mode === "DELETED")
          await s.a.runAsync(
            "DELETE FROM copilot_messages WHERE id=?",
            s.f.chat.message.id,
          );
        if (mode === "ARCHIVED")
          await s.a.runAsync(
            "UPDATE copilot_conversations SET payload_json=json_set(payload_json,'$.status','ARCHIVED') WHERE id=?",
            s.f.chat.conversation.id,
          );
        if (mode === "PRODUCT" && kind !== "NEED")
          await s.a.runAsync(
            "UPDATE products SET status='INACTIVE' WHERE id=?",
            r.product.id,
          );
        if (mode === "NEED" && kind !== "NEED")
          await s.a.runAsync(
            "UPDATE need_units SET payload_json=json_set(payload_json,'$.status','INACTIVE') WHERE id=?",
            r.need.id,
          );
        if (mode === "PARENT_CONFLICT" && kind !== "NEED")
          await s.a.runAsync(
            "UPDATE products SET sync_state='CONFLICT' WHERE id=?",
            r.product.id,
          );
        if (
          ["PRODUCT", "NEED", "PARENT_CONFLICT"].includes(mode) &&
          kind === "NEED"
        )
          continue;
        const before = s.db.prepare(`SELECT * FROM ${r.table}`).all(),
          commands = s.db
            .prepare("SELECT * FROM sync_outbox ORDER BY local_sequence")
            .all(),
          conflicts = s.db
            .prepare("SELECT * FROM sync_conflicts ORDER BY id")
            .all();
        if (mode === "COMMIT") s.a.fail = true;
        if (mode === "CANCEL")
          s.a.afterRun = (sql) => {
            if (sql.includes("UPDATE sync_conflicts SET status="))
              cancel.abort();
          };
        await expect(
          r.controller.confirm(
            r.message,
            r.state.review!.basisHash,
            "KEEP_LOCAL",
            mode !== "UNCHECKED",
            cancel.signal,
          ),
        ).rejects.toThrow();
        expect(s.db.prepare(`SELECT * FROM ${r.table}`).all()).toEqual(before);
        expect(
          s.db
            .prepare("SELECT * FROM sync_outbox ORDER BY local_sequence")
            .all(),
        ).toEqual(commands);
        expect(
          s.db.prepare("SELECT * FROM sync_conflicts ORDER BY id").all(),
        ).toEqual(conflicts);
        expect(s.count("copilot_tool_results")).toBe(0);
      } finally {
        s.db.close();
      }
    }
  },
);
it.each(["MEMBERSHIP", "SUBSTITUTION"] as const)(
  "requires separate reactivation consent on either side of a refused %s",
  async (kind) => {
    for (const refusal of ["LOCAL", "REMOTE"] as const) {
      const s = await nativeNeedConflictFixture(kind, ":memory:", refusal);
      try {
        const r = s.review,
          decision = refusal === "LOCAL" ? "ADOPT_REMOTE" : "KEEP_LOCAL";
        expect(r.state.status).toBe("READY");
        expect(
          refusal === "LOCAL"
            ? r.state.review!.needPolicy!.reactivateRemote
            : r.state.review!.needPolicy!.reactivateLocal,
        ).toBe(true);
        await expect(
          r.controller.confirm(
            r.message,
            r.state.review!.basisHash,
            decision,
            true,
          ),
        ).rejects.toThrow();
        expect(s.count("copilot_tool_results")).toBe(0);
        expect(
          (
            await r.controller.confirm(
              r.message,
              r.state.review!.basisHash,
              decision,
              true,
              undefined,
              true,
            )
          ).status,
        ).toBe("COMPLETED");
      } finally {
        s.db.close();
      }
    }
  },
);
it.each(["MEMBERSHIP", "SUBSTITUTION"] as const)(
  "does not retarget an existing %s identity",
  async (kind) => {
    const s = await nativeNeedConflictFixture(kind);
    try {
      const r = s.review,
        field = kind === "MEMBERSHIP" ? "productId" : "sourceProductId";
      await s.a.runAsync(
        `UPDATE ${r.table} SET payload_json=json_set(payload_json,?,?) WHERE id=?`,
        `$.${field}`,
        randomUUID(),
        r.remote.id,
      );
      const state = await r.controller.open(r.message);
      expect(state.status).toBe("BLOCKED");
      expect(s.count("copilot_tool_results")).toBe(0);
    } finally {
      s.db.close();
    }
  },
);
it("does not promote a declared substitution into learning while resolving a conflict", async () => {
  const s = await nativeNeedConflictFixture("SUBSTITUTION");
  try {
    const r = s.review,
      remote = productSubstitutionSchema.parse(r.remote);
    await s.a.runAsync(
      "UPDATE product_substitutions SET payload_json=? WHERE id=?",
      JSON.stringify({ ...remote, needCompatibility: 0.4, status: "LEARNING" }),
      r.remote.id,
    );
    const state = await r.controller.open(r.message);
    expect(state.status).toBe("READY");
    expect(state.review!.canKeepLocal).toBe(false);
    expect(state.review!.canAdoptRemote).toBe(true);
    await expect(
      r.controller.confirm(
        r.message,
        state.review!.basisHash,
        "KEEP_LOCAL",
        true,
      ),
    ).rejects.toThrow();
    expect(
      (
        await r.controller.confirm(
          r.message,
          state.review!.basisHash,
          "ADOPT_REMOTE",
          true,
        )
      ).status,
    ).toBe("COMPLETED");
  } finally {
    s.db.close();
  }
});
it("cannot keep a changed need code while adopting the canonical identity remains possible", async () => {
  const s = await nativeNeedConflictFixture("NEED");
  try {
    const r = s.review;
    await s.a.runAsync(
      "UPDATE need_units SET payload_json=json_set(payload_json,'$.code','OTHER_CODE') WHERE id=?",
      r.remote.id,
    );
    const state = await r.controller.open(r.message);
    expect(state.status).toBe("READY");
    expect(state.review!.canKeepLocal).toBe(false);
    expect(
      (
        await r.controller.confirm(
          r.message,
          state.review!.basisHash,
          "ADOPT_REMOTE",
          true,
        )
      ).status,
    ).toBe("COMPLETED");
  } finally {
    s.db.close();
  }
});
