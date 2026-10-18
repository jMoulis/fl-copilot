import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, expect } from "vitest";
import {
  readStoreConflictProposal,
  commercialVersionDecisionSchema,
  commercialExecutionTaskSchema,
} from "@fl-copilot/domain";
import { nativeCommercialDecisionConflictFixture } from "../../../../scripts/test-commercial-decision-conflict-fixtures";
import {
  ReceiptTestDatabase,
  receiptReviewDigest,
} from "../../../../scripts/test-receipt-publication-sqlite";
import { CopilotStoreConflictController } from "./store-conflict-controller";
import { readStoreConflictCurrent } from "./store-conflict-review";
import { OutboxRepository } from "../sync/outbox-repository";
const kinds = ["COMMERCIAL_REFERENCE", "COMMERCIAL_EXECUTION"] as const;
it.each(kinds)(
  "resolves both %s choices offline and replays exactly once after restart",
  async (kind) => {
    for (const decision of ["KEEP_LOCAL", "ADOPT_REMOTE"] as const) {
      const dir = mkdtempSync(join(tmpdir(), "decision-conflict-")),
        path = join(dir, "local.db"),
        s = await nativeCommercialDecisionConflictFixture(kind, path, true);
      let reopened: DatabaseSync | undefined;
      try {
        const r = s.review;
        expect(r.state.status).toBe("READY");
        expect(r.state.review?.canKeepLocal).toBe(true);
        expect(readStoreConflictProposal(r.message).content.schemaVersion).toBe(
          4,
        );
        const tables = [
            "sales_observations",
            "waste_observations",
            "commercial_week_plans",
            "commercial_plan_revisions",
            "offers",
            "commercial_operations",
            "source_documents",
            "commercial_visual_readings",
          ],
          snapshot = () =>
            tables.map((t) => s.db.prepare(`SELECT * FROM ${t}`).all()),
          before = snapshot();
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
        const current = await readStoreConflictCurrent(
          s.a,
          readStoreConflictProposal(r.message).content,
          receiptReviewDigest,
        );
        expect(current?.entity.version).toBe(decision === "KEEP_LOCAL" ? 3 : 2);
        if (decision === "ADOPT_REMOTE")
          expect(current?.entity).toEqual(r.remote);
        if (kind === "COMMERCIAL_REFERENCE") {
          const e = commercialVersionDecisionSchema.parse(current!.entity),
            local = commercialVersionDecisionSchema.parse(r.local);
          expect(e.before).toEqual(
            commercialVersionDecisionSchema.parse(r.remote).before,
          );
          expect(
            e.preference === "KEEP_PREVIOUS"
              ? e.before.documentId
              : e.after.documentId,
          ).toBe(
            decision === "KEEP_LOCAL"
              ? local.before.documentId
              : local.after.documentId,
          );
        } else {
          const e = commercialExecutionTaskSchema.parse(current!.entity),
            local = commercialExecutionTaskSchema.parse(r.local);
          expect(e).toMatchObject({
            planId: local.planId,
            planRevisionId: local.planRevisionId,
            planChecksum: local.planChecksum,
            planVersion: local.planVersion,
            kind: local.kind,
            targetId: local.targetId,
            status: decision === "KEEP_LOCAL" ? "DONE" : "SKIPPED",
            completedAt: decision === "KEEP_LOCAL" ? local.completedAt : null,
          });
          expect(s.count("commercial_execution_tasks")).toBe(1);
        }
        expect(snapshot()).toEqual(before);
        const commands = (
          await new OutboxRepository(s.a).listPending(s.scope.storeId)
        ).filter((c) => c.entityType === r.entityType);
        expect(commands).toHaveLength(decision === "KEEP_LOCAL" ? 1 : 0);
        if (commands[0]) expect(commands[0].expectedRemoteVersion).toBe(2);
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
        await expect(
          new CopilotStoreConflictController(
            new ReceiptTestDatabase(reopened),
            {
              ...r.scope,
              canManageCommercialReferences: false,
              canDeclareCommercialExecution: false,
            },
            receiptReviewDigest,
            randomUUID,
          ).open(r.message),
        ).rejects.toThrow("FORBIDDEN");
      } finally {
        if (reopened) reopened.close();
        else s.db.close();
        rmSync(dir, { recursive: true, force: true });
      }
    }
  },
);
it.each(kinds)(
  "rolls back cancelled or failed %s resolutions and rejects stale proofs",
  async (kind) => {
    const s = await nativeCommercialDecisionConflictFixture(kind);
    try {
      const r = s.review,
        hash = r.state.review!.basisHash,
        before = s.db.prepare(`SELECT * FROM ${r.table}`).all(),
        commands = s.db
          .prepare("SELECT * FROM sync_outbox ORDER BY local_sequence")
          .all();
      await expect(
        r.controller.confirm(r.message, hash, "KEEP_LOCAL", false),
      ).rejects.toThrow();
      s.a.fail = true;
      await expect(
        r.controller.confirm(r.message, hash, "KEEP_LOCAL", true),
      ).rejects.toThrow();
      s.a.fail = false;
      expect(s.db.prepare(`SELECT * FROM ${r.table}`).all()).toEqual(before);
      expect(
        s.db.prepare("SELECT * FROM sync_outbox ORDER BY local_sequence").all(),
      ).toEqual(commands);
      expect(s.count("copilot_tool_results")).toBe(0);
      const abort = new AbortController();
      abort.abort();
      await expect(
        r.controller.confirm(r.message, hash, "KEEP_LOCAL", true, abort.signal),
      ).rejects.toThrow();
      await s.a.runAsync(
        "UPDATE sync_outbox SET status='SYNCING' WHERE command_id=?",
        r.command.commandId,
      );
      expect((await r.controller.open(r.message)).status).toBe("BLOCKED");
      await expect(
        r.controller.confirm(r.message, hash, "ADOPT_REMOTE", true),
      ).rejects.toThrow();
      expect(s.count("copilot_tool_results")).toBe(0);
    } finally {
      s.db.close();
    }
  },
);
it.each(kinds)(
  "keeps remote %s adoption available when complete supporting sources are missing",
  async (kind) => {
    const s = await nativeCommercialDecisionConflictFixture(kind);
    try {
      const r = s.review;
      if (kind === "COMMERCIAL_REFERENCE")
        await s.a.runAsync(
          "DELETE FROM commercial_visual_readings WHERE id=?",
          r.other.reading.id,
        );
      else {
        await s.a.runAsync(
          "DELETE FROM commercial_plan_revisions WHERE id=?",
          r.fixture.plan.revisionId,
        );
        await s.a.runAsync(
          "DELETE FROM commercial_week_plans WHERE id=?",
          r.fixture.plan.id,
        );
      }
      const state = await r.controller.open(r.message);
      expect(state.review?.canKeepLocal).toBe(false);
      expect(state.review?.canAdoptRemote).toBe(true);
      await expect(
        r.controller.confirm(
          r.message,
          r.state.review!.basisHash,
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
  },
);
it.each(kinds)(
  "blocks retargeted %s identities and tampered private artifacts",
  async (kind) => {
    const s = await nativeCommercialDecisionConflictFixture(kind);
    try {
      const r = s.review;
      const remote =
        kind === "COMMERCIAL_REFERENCE"
          ? {
              ...r.remote,
              before: {
                ...commercialVersionDecisionSchema.parse(r.remote).before,
                documentId: randomUUID(),
              },
            }
          : { ...r.remote, planRevisionId: randomUUID() };
      const preview = readStoreConflictProposal(r.message).content;
      await s.a.runAsync(
        "UPDATE sync_conflicts SET remote_payload_json=? WHERE id=?",
        JSON.stringify(remote),
        r.conflict.id,
      );
      expect((await r.controller.open(r.message)).status).toBe("BLOCKED");
      await expect(
        r.controller.confirm(
          r.message,
          r.state.review!.basisHash,
          "ADOPT_REMOTE",
          true,
        ),
      ).rejects.toThrow();
      await expect(
        r.controller.open({
          ...r.message,
          text: JSON.stringify({ ...preview, schemaVersion: 3 }),
        }),
      ).rejects.toThrow();
      expect(s.count("copilot_tool_results")).toBe(0);
    } finally {
      s.db.close();
    }
  },
);
it.each(kinds)(
  "never authorizes %s local retention from an oversized history",
  async (kind) => {
    const s = await nativeCommercialDecisionConflictFixture(kind);
    try {
      const r = s.review;
      if (kind === "COMMERCIAL_REFERENCE")
        await s.a.runAsync(
          "UPDATE commercial_visual_readings SET payload_json=payload_json||? WHERE id=?",
          " ".repeat(1000001),
          r.other.reading.id,
        );
      else
        await s.a.runAsync(
          "UPDATE commercial_plan_revisions SET payload_json=payload_json||? WHERE id=?",
          " ".repeat(1000001),
          r.fixture.plan.revisionId,
        );
      const state = await r.controller.open(r.message);
      expect(state.review?.canKeepLocal).toBe(false);
      expect(state.review?.canAdoptRemote).toBe(true);
      await expect(
        r.controller.confirm(
          r.message,
          state.review!.basisHash,
          "KEEP_LOCAL",
          true,
        ),
      ).rejects.toThrow();
      expect(s.count("copilot_tool_results")).toBe(0);
    } finally {
      s.db.close();
    }
  },
);
it("retains execution on an archived revision without relinking it to a newer current plan", async () => {
  const s = await nativeCommercialDecisionConflictFixture(
    "COMMERCIAL_EXECUTION",
  );
  try {
    const r = s.review;
    await s.a.runAsync(
      "DELETE FROM commercial_week_plans WHERE id=?",
      r.fixture.plan.id,
    );
    expect((await r.controller.open(r.message)).review?.canKeepLocal).toBe(
      true,
    );
    expect(
      (
        await r.controller.confirm(
          r.message,
          (await r.controller.open(r.message)).review!.basisHash,
          "KEEP_LOCAL",
          true,
        )
      ).status,
    ).toBe("COMPLETED");
    expect(
      commercialExecutionTaskSchema.parse(
        (await readStoreConflictCurrent(
          s.a,
          readStoreConflictProposal(r.message).content,
          receiptReviewDigest,
        ))!.entity,
      ).planRevisionId,
    ).toBe(r.fixture.plan.revisionId);
  } finally {
    s.db.close();
  }
});

it.each(kinds)(
  "invalidates a %s confirmation even when changed dependencies remain usable",
  async (kind) => {
    const s = await nativeCommercialDecisionConflictFixture(kind);
    try {
      const r = s.review;
      if (kind === "COMMERCIAL_REFERENCE")
        await s.a.runAsync(
          "UPDATE commercial_visual_readings SET payload_json=payload_json||' ' WHERE id=?",
          r.other.reading.id,
        );
      else
        await s.a.runAsync(
          "INSERT INTO commercial_plan_history(action_id,plan_id,store_id,payload_json,action,created_at) VALUES(?,?,?,?,?,?)",
          randomUUID(),
          r.fixture.plan.id,
          s.scope.storeId,
          JSON.stringify(r.fixture.plan),
          "SAVE_PLAN",
          r.fixture.plan.validatedAt,
        );
      const state = await r.controller.open(r.message);
      expect(state.review?.canKeepLocal).toBe(true);
      expect(state.review?.basisHash).not.toBe(r.state.review?.basisHash);
      await expect(
        r.controller.confirm(
          r.message,
          r.state.review!.basisHash,
          "KEEP_LOCAL",
          true,
        ),
      ).rejects.toThrow("STALE");
      expect(s.count("copilot_tool_results")).toBe(0);
      expect(
        (
          await r.controller.confirm(
            r.message,
            state.review!.basisHash,
            "KEEP_LOCAL",
            true,
          )
        ).status,
      ).toBe("COMPLETED");
    } finally {
      s.db.close();
    }
  },
);
