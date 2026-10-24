import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decisionFixture,
  decisionNativeFixture,
  decisionDigest,
  decisionChoiceFixture,
  saveDecision,
} from "../../../../scripts/test-copilot-decision-fixtures";
import { MercalysTestDatabase } from "../../../../scripts/test-mercalys-sync-fixtures";
import {
  CopilotDecisionRepository,
  applyDecisionRecord,
} from "./decision-repository";
import { OutboxRepository } from "../sync/outbox-repository";
import { ConflictRepository } from "../sync/conflict-repository";
import { recommendationDecisionSchema } from "@fl-copilot/domain";
it("persists four explicit decisions offline with their origin, restarts and replays an identical choice without extra commands", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-decisions-")),
    path = join(dir, "device.db");
  let db = new MercalysTestDatabase(new DatabaseSync(path));
  const f = await decisionNativeFixture(decisionFixture(), db);
  try {
    for (const type of ["ACCEPT", "MODIFY", "POSTPONE", "REJECT"] as const)
      await saveDecision(f, type);
    const s = await f.repo.open(f.card);
    expect(s.decision?.revisions.map((r) => r.type)).toEqual([
      "ACCEPT",
      "MODIFY",
      "POSTPONE",
      "REJECT",
    ]);
    expect(s.decision?.createdAt).toBe(f.source.createdAt);
    expect(s.decision?.version).toBe(4);
    await saveDecision(f, "REJECT");
    expect(
      await db.getFirstAsync(
        "SELECT COUNT(*) AS n FROM sync_outbox WHERE entity_type='copilot_decision'",
      ),
    ).toEqual({ n: 4 });
    db.db.close();
    db = new MercalysTestDatabase(new DatabaseSync(path));
    const repo = new CopilotDecisionRepository(
      db,
      f.scope,
      decisionDigest,
      randomUUID,
    );
    expect((await repo.open(f.card)).decision).toEqual(s.decision);
    expect(
      (await new OutboxRepository(db).listPending(f.storeId)).map(
        (c) => c.expectedRemoteVersion,
      ),
    ).toEqual([null]);
    expect(
      await db.getFirstAsync(
        "SELECT COUNT(*) AS n FROM commercial_execution_tasks",
      ),
    ).toEqual({ n: 0 });
  } finally {
    db.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("keeps a newer local choice on pull and only acknowledges its exact revision", async () => {
  const f = await decisionNativeFixture();
  try {
    const first = (await saveDecision(f, "ACCEPT")).decision!;
    const second = (await saveDecision(f, "MODIFY")).decision!;
    await applyDecisionRecord(f.db, f.scope, first, 1);
    expect((await f.repo.open(f.card)).decision).toEqual(second);
    expect((await f.repo.open(f.card)).syncState).toBe("PENDING");
    await applyDecisionRecord(f.db, f.scope, second, 2);
    expect((await f.repo.open(f.card)).syncState).toBe("SYNCED");
    await expect(
      applyDecisionRecord(f.db, { ...f.scope, ownerId: randomUUID() }, first),
    ).rejects.toThrow("SCOPE");
  } finally {
    f.db.db.close();
  }
});
it("rejects stale review, missing source, revoked permission and past postpone dates without changing the decision", async () => {
  const f = await decisionNativeFixture();
  try {
    const before = await f.repo.open(f.card);
    await saveDecision(f, "ACCEPT");
    await expect(
      f.repo.save(f.card, decisionChoiceFixture("REJECT"), before.review),
    ).rejects.toThrow("REVIEW");
    const current = await f.repo.open(f.card);
    await expect(
      f.repo.save(
        f.card,
        { ...decisionChoiceFixture("POSTPONE"), postponeUntil: "2026-10-01" },
        current.review,
      ),
    ).rejects.toThrow("DATE");
    await expect(
      new CopilotDecisionRepository(
        f.db,
        { ...f.scope, canDecide: false },
        decisionDigest,
        randomUUID,
      ).save(f.card, decisionChoiceFixture("REJECT"), current.review),
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      new CopilotDecisionRepository(
        f.db,
        { ...f.scope, ownerId: randomUUID() },
        decisionDigest,
        randomUUID,
      ).open(f.card),
    ).rejects.toThrow("SCOPE");
    await f.db.runAsync("DELETE FROM copilot_messages WHERE id=?", f.source.id);
    expect((await f.repo.open(f.card)).sourceLocallyAvailable).toBe(false);
    expect((await f.repo.open(f.card)).decision?.version).toBe(1);
  } finally {
    f.db.db.close();
  }
});
it("rolls back a failed enqueue and an aborted save with its whole history", async () => {
  const f = await decisionNativeFixture();
  try {
    const commandId = randomUUID(),
      repo = new CopilotDecisionRepository(
        f.db,
        f.scope,
        decisionDigest,
        () => commandId,
        () => "2026-10-18T12:00:00.000Z",
      );
    let s = await repo.open(f.card);
    await repo.save(f.card, decisionChoiceFixture("ACCEPT"), s.review);
    s = await repo.open(f.card);
    await expect(
      repo.save(f.card, decisionChoiceFixture("REJECT"), s.review),
    ).rejects.toThrow();
    expect((await repo.open(f.card)).decision?.version).toBe(1);
    const abort = new AbortController(),
      cancelling = new CopilotDecisionRepository(
        f.db,
        f.scope,
        decisionDigest,
        () => {
          abort.abort();
          return randomUUID();
        },
        () => "2026-10-18T12:01:00.000Z",
      );
    await expect(
      cancelling.save(
        f.card,
        decisionChoiceFixture("MODIFY"),
        s.review,
        abort.signal,
      ),
    ).rejects.toThrow("CANCELLED");
    expect((await repo.open(f.card)).decision?.version).toBe(1);
    expect(
      await f.db.getFirstAsync("SELECT COUNT(*) AS n FROM sync_outbox"),
    ).toEqual({ n: 1 });
  } finally {
    f.db.db.close();
  }
});
async function conflicting() {
  const f = await decisionNativeFixture();
  await saveDecision(f, "ACCEPT");
  const local = (await saveDecision(f, "MODIFY")).decision!,
    remote = recommendationDecisionSchema.parse({
      ...local,
      version: 1,
      revisions: [
        { ...local.revisions[0]!, ...decisionChoiceFixture("REJECT") },
      ],
      updatedAt: local.revisions[0]!.decidedAt,
    });
  await applyDecisionRecord(f.db, f.scope, remote);
  const command = (
    await f.db.getAllAsync<{ command_id: string }>(
      "SELECT command_id FROM sync_outbox ORDER BY local_sequence",
    )
  )[0]!;
  const outbox = new OutboxRepository(f.db),
    c = await outbox.getById(command.command_id);
  await new ConflictRepository(f.db).recordPushConflict(c!, {
    commandId: c!.commandId,
    entityType: "copilot_decision",
    entityId: f.recommendationId,
    status: "CONFLICT",
    remoteEntity: remote,
    remoteVersion: 1,
  });
  await f.db.runAsync(
    "UPDATE copilot_decisions SET sync_state='CONFLICT' WHERE id=?",
    f.recommendationId,
  );
  await f.db.runAsync(
    "UPDATE sync_outbox SET status='CONFLICT' WHERE command_id=?",
    c!.commandId,
  );
  return { ...f, remote };
}
it.each([true, false])(
  "resolves concurrent decisions explicitly, retaining source and history with once-only replay (local=%s)",
  async (useLocal) => {
    const f = await conflicting();
    try {
      const s = await f.repo.open(f.card);
      expect(s.status).toBe("CONFLICT");
      expect(s.canResolve).toBe(true);
      const resolved = await f.repo.resolve(f.card, useLocal, s.review);
      expect(resolved.decision?.revisions.map((r) => r.type)).toEqual(
        useLocal ? ["REJECT", "MODIFY"] : ["REJECT"],
      );
      expect(resolved.syncState).toBe(useLocal ? "PENDING" : "SYNCED");
      expect(
        await new ConflictRepository(f.db).listOpen(f.storeId),
      ).toHaveLength(0);
      await expect(f.repo.resolve(f.card, useLocal, s.review)).rejects.toThrow(
        "REVIEW",
      );
      expect(
        await new OutboxRepository(f.db).listPending(f.storeId),
      ).toHaveLength(useLocal ? 1 : 0);
      expect(
        await f.db.getFirstAsync(
          "SELECT COUNT(*) AS n FROM sync_conflicts WHERE status IN ('RESOLVED_LOCAL','RESOLVED_REMOTE') AND conflict_type!='COPILOT_DECISION_REVIEW_CAPTURE'",
        ),
      ).toEqual({ n: 1 });
    } finally {
      f.db.db.close();
    }
  },
);
it("requires a fresh comparison after a newer pull and permits remote adoption for an archived source only", async () => {
  const f = await conflicting();
  try {
    const before = await f.repo.open(f.card),
      newRemote = recommendationDecisionSchema.parse({
        ...f.remote,
        version: 2,
        updatedAt: "2026-10-18T12:01:00.000Z",
        revisions: [
          ...f.remote.revisions,
          {
            ...decisionChoiceFixture("POSTPONE"),
            proposalMessageId: f.card.id,
            version: 2,
            decidedAt: "2026-10-18T12:01:00.000Z",
          },
        ],
      });
    await applyDecisionRecord(f.db, f.scope, newRemote);
    await expect(f.repo.resolve(f.card, false, before.review)).rejects.toThrow(
      "REVIEW",
    );
    await f.db.runAsync(
      "UPDATE copilot_conversations SET payload_json=? WHERE id=?",
      JSON.stringify({ ...f.conversation, status: "ARCHIVED", version: 2 }),
      f.conversation.id,
    );
    const latest = await f.repo.open(f.card);
    expect(latest.canRetainLocal).toBe(false);
    await expect(f.repo.resolve(f.card, true, latest.review)).rejects.toThrow(
      "SOURCE",
    );
    expect(
      (await f.repo.resolve(f.card, false, latest.review)).decision,
    ).toEqual(newRemote);
  } finally {
    f.db.db.close();
  }
});
it("refuses a conflict resolution while a command is in flight", async () => {
  const f = await conflicting();
  try {
    await f.db.runAsync(
      "UPDATE sync_outbox SET status='SYNCING' WHERE entity_id=?",
      f.recommendationId,
    );
    const s = await f.repo.open(f.card);
    await expect(f.repo.resolve(f.card, false, s.review)).rejects.toThrow(
      "SYNCING",
    );
  } finally {
    f.db.db.close();
  }
});

it("keeps one workflow when the same advice is prepared again in a later answer", async () => {
  const { buildRecommendationTrackingMessages } =
    await import("../../../api/src/copilot/recommendation-tracking-messages");
  const { applyCopilotRecord } = await import("./conversation-repository");
  const f = await decisionNativeFixture();
  try {
    await saveDecision(f, "ACCEPT");
    const assistant = {
      ...f.assistant,
      id: randomUUID(),
      createdAt: "2026-10-11T12:00:04.000Z",
    };
    const card = buildRecommendationTrackingMessages(assistant, [
      f.preview,
    ])[0]!;
    await applyCopilotRecord(f.db, f.scope, "copilot_message", assistant);
    await applyCopilotRecord(f.db, f.scope, "copilot_message", card);
    const s = await f.repo.open(card);
    expect(s.decision?.revisions.at(-1)?.type).toBe("ACCEPT");
    const saved = await f.repo.save(
      card,
      decisionChoiceFixture("MODIFY"),
      s.review,
    );
    expect(saved.decision?.id).toBe(f.recommendationId);
    expect(saved.decision?.version).toBe(2);
    expect(saved.decision?.revisions.at(-1)?.proposalMessageId).toBe(card.id);
    expect(
      await f.db.getFirstAsync("SELECT COUNT(*) AS n FROM copilot_decisions"),
    ).toEqual({ n: 1 });
  } finally {
    f.db.db.close();
  }
});

it("keeps a recommendation actionable after its answer receives navigation metadata", async () => {
  const { packAnalyticsDestinations } = await import("@fl-copilot/domain");
  const { largeAnalyticalContext } =
    await import("../../../../scripts/test-analytics-destination-fixtures");
  const { applyCopilotRecord } = await import("./conversation-repository");
  const { recommendationSourceDigest } =
    await import("../../../api/src/copilot/recommendation-tracking-tool");
  const f = await decisionNativeFixture();
  try {
    const enriched = {
      ...f.source,
      analyticsDestinations: packAnalyticsDestinations([
        largeAnalyticalContext(),
      ]),
    };
    expect(recommendationSourceDigest(enriched)).toBe(
      f.preview.basis.sourceDigest,
    );
    expect(
      recommendationSourceDigest({ ...enriched, text: "changed" }),
    ).not.toBe(f.preview.basis.sourceDigest);
    await applyCopilotRecord(f.db, f.scope, "copilot_message", enriched);
    expect((await f.repo.open(f.card)).status).toBe("READY");
    await saveDecision(f, "ACCEPT");
    expect((await f.repo.open(f.card)).decision?.revisions[0]?.type).toBe(
      "ACCEPT",
    );
  } finally {
    f.db.db.close();
  }
});
