import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import { readStoreConflictProposal } from "@fl-copilot/domain";
import { nativeCommercialConflictFixture } from "../../../../scripts/test-commercial-conflict-fixtures";
import {
  ReceiptTestDatabase,
  receiptReviewDigest,
} from "../../../../scripts/test-receipt-publication-sqlite";
import { CopilotStoreConflictController } from "./store-conflict-controller";
import { readStoreConflictCurrent } from "./store-conflict-review";
import { OutboxRepository } from "../sync/outbox-repository";
const kinds = [
  "COMMERCIAL_CHOICE",
  "COMMERCIAL_PREPARATION",
  "COMMERCIAL_PLAN",
] as const;
it.each(kinds)(
  "resolves both %s versions exactly once across restart without declaring execution",
  async (kind) => {
    for (const decision of ["KEEP_LOCAL", "ADOPT_REMOTE"] as const) {
      const dir = mkdtempSync(join(tmpdir(), "commercial-conflict-")),
        path = join(dir, "local.db"),
        s = await nativeCommercialConflictFixture(kind, path);
      let reopened: DatabaseSync | undefined;
      try {
        const r = s.review;
        expect(r.state.status).toBe("READY");
        expect(r.state.review?.canKeepLocal).toBe(true);
        expect(readStoreConflictProposal(r.message).content.schemaVersion).toBe(
          3,
        );
        const counts = [
          "sales_observations",
          "waste_observations",
          "commercial_execution_tasks",
        ].map((t) => s.count(t));
        const result = await r.controller.confirm(
          r.message,
          r.state.review!.basisHash,
          decision,
          true,
        );
        expect(result.status).toBe("COMPLETED");
        const current = await readStoreConflictCurrent(
          s.a,
          readStoreConflictProposal(r.message).content,
          receiptReviewDigest,
        );
        expect(current?.entity.version).toBe(decision === "KEEP_LOCAL" ? 3 : 2);
        if (decision === "ADOPT_REMOTE")
          expect(current?.entity).toEqual(r.remote);
        const commands = (
          await new OutboxRepository(s.a).listPending(s.scope.storeId)
        ).filter((c) => c.entityType === r.entityType);
        expect(commands).toHaveLength(decision === "KEEP_LOCAL" ? 1 : 0);
        if (commands[0]) expect(commands[0].expectedRemoteVersion).toBe(2);
        if (kind === "COMMERCIAL_PLAN") {
          expect(s.count("commercial_operations")).toBeGreaterThan(0);
          expect(s.count("offers")).toBeGreaterThan(0);
        }
        expect(
          [
            "sales_observations",
            "waste_observations",
            "commercial_execution_tasks",
          ].map((t) => s.count(t)),
        ).toEqual(counts);
        const before = s.db
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
        ).toEqual(before);
        await expect(
          new CopilotStoreConflictController(
            new ReceiptTestDatabase(reopened),
            {
              ...r.scope,
              canManageCommercialChoices: false,
              canPrepareCommercialWeek: false,
              canValidateCommercialPlan: false,
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
  "rejects stale %s review, changed dependencies, cancellation and failed commit atomically",
  async (kind) => {
    const s = await nativeCommercialConflictFixture(kind);
    try {
      const r = s.review,
        hash = r.state.review!.basisHash;
      await expect(
        r.controller.confirm(r.message, hash, "KEEP_LOCAL", false),
      ).rejects.toThrow();
      const before = s.db.prepare(`SELECT * FROM ${r.table}`).all(),
        commands = s.db
          .prepare("SELECT * FROM sync_outbox ORDER BY local_sequence")
          .all();
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
      expect(s.count("copilot_tool_results")).toBe(0);
      if (kind === "COMMERCIAL_CHOICE")
        await s.a.runAsync(
          "UPDATE products SET sales_unit='PIECE',version=version+1 WHERE id=?",
          r.fixture.product.id,
        );
      else
        await s.a.runAsync(
          "UPDATE commercial_offer_choices SET sync_state='CONFLICT' WHERE id=?",
          r.fixture.choice.id,
        );
      await expect(
        r.controller.confirm(r.message, hash, "KEEP_LOCAL", true),
      ).rejects.toThrow();
      const next = await r.controller.open(r.message);
      expect(next.review?.canKeepLocal).toBe(false);
      expect(next.review?.canAdoptRemote).toBe(true);
      expect(
        (
          await r.controller.confirm(
            r.message,
            next.review!.basisHash,
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
it.each(["LOCAL", "REMOTE"] as const)(
  "requires separate consent to reverse a %s withdrawn choice",
  async (side) => {
    const s = await nativeCommercialConflictFixture(
      "COMMERCIAL_CHOICE",
      ":memory:",
      side,
    );
    try {
      const r = s.review,
        decision = side === "LOCAL" ? "ADOPT_REMOTE" : "KEEP_LOCAL";
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
            false,
            true,
          )
        ).status,
      ).toBe("COMPLETED");
      expect(
        (
          await r.controller.confirm(
            r.message,
            r.state.review!.basisHash,
            decision,
            true,
            undefined,
            false,
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
  "blocks %s when the synchronized identity or sending state changes",
  async (kind) => {
    const s = await nativeCommercialConflictFixture(kind);
    try {
      const r = s.review;
      await s.a.runAsync(
        "UPDATE sync_outbox SET status='SYNCING' WHERE command_id=?",
        r.command.commandId,
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
      expect(s.count("copilot_tool_results")).toBe(0);
    } finally {
      s.db.close();
    }
  },
);

it.each(kinds)(
  "refuses changed %s target identity and revoked private authority",
  async (kind) => {
    const s = await nativeCommercialConflictFixture(kind);
    try {
      const r = s.review,
        content = readStoreConflictProposal(r.message).content;
      const foreign = { ...r.remote, storeId: randomUUID() };
      await s.a.runAsync(
        "UPDATE sync_conflicts SET remote_payload_json=? WHERE id=?",
        JSON.stringify(foreign),
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
      expect(s.count("copilot_tool_results")).toBe(0);
      await s.a.runAsync(
        "UPDATE sync_conflicts SET remote_payload_json=? WHERE id=?",
        JSON.stringify(r.remote),
        r.conflict.id,
      );
      const altered = {
        ...r.message,
        text: JSON.stringify({
          ...content,
          basis: { ...content.basis, remoteHash: "a".repeat(64) },
        }),
      };
      await expect(r.controller.open(altered)).rejects.toThrow();
    } finally {
      s.db.close();
    }
  },
);

it("does not refresh a plan's products or PDF preferences silently", async () => {
  const s = await nativeCommercialConflictFixture("COMMERCIAL_PLAN");
  try {
    const r = s.review;
    await s.a.runAsync(
      "UPDATE products SET label='Nouveau libellé',version=version+1 WHERE id=?",
      r.fixture.product.id,
    );
    const state = await r.controller.open(r.message);
    expect(state.review?.canKeepLocal).toBe(false);
    expect(state.review?.canAdoptRemote).toBe(true);
    expect(s.count("copilot_tool_results")).toBe(0);
  } finally {
    s.db.close();
  }
});

it.each(kinds)(
  "does not authorize %s retention from an oversized dependency set",
  async (kind) => {
    const s = await nativeCommercialConflictFixture(kind);
    try {
      const r = s.review;
      await s.a.runAsync(
        "UPDATE commercial_visual_readings SET payload_json=payload_json || ? WHERE id=?",
        " ".repeat(1000001),
        r.fixture.reading.id,
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
