import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CopilotDecisionRepository } from "./decision-repository";
import { decisionDigest } from "../../../../scripts/test-copilot-decision-fixtures";
import { MercalysTestDatabase } from "../../../../scripts/test-mercalys-sync-fixtures";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  decisionNativeFixture,
  saveDecision,
  decisionChoiceFixture,
} from "../../../../scripts/test-copilot-decision-fixtures";
import { applyDecisionRecord } from "./decision-repository";
import { OutboxRepository } from "../sync/outbox-repository";
import { ConflictRepository } from "../sync/conflict-repository";
import { recommendationDecisionSchema } from "@fl-copilot/domain";
async function fixture() {
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
  const packets = await f.db.getAllAsync<{ command_id: string }>(
      "SELECT command_id FROM sync_outbox ORDER BY local_sequence",
    ),
    command = (await new OutboxRepository(f.db).getById(
      packets[0]!.command_id,
    ))!;
  const conflict = await new ConflictRepository(f.db).recordPushConflict(
    command,
    {
      commandId: command.commandId,
      entityType: "copilot_decision",
      entityId: f.recommendationId,
      status: "CONFLICT",
      remoteEntity: remote,
      remoteVersion: 1,
    },
  );
  await f.db.runAsync(
    "UPDATE copilot_decisions SET sync_state='CONFLICT' WHERE id=?",
    f.recommendationId,
  );
  await f.db.runAsync(
    "UPDATE sync_outbox SET status='CONFLICT' WHERE command_id=?",
    command.commandId,
  );
  return { ...f, local, remote, command, conflict };
}
it("allows a complete owned multi-conflict decision group to be reviewed", async () => {
  const f = await fixture();
  try {
    const command = await new OutboxRepository(f.db).enqueue({
      ...f.command,
      commandId: randomUUID(),
    });
    await new ConflictRepository(f.db).recordPushConflict(command, {
      commandId: command.commandId,
      entityType: "copilot_decision",
      entityId: f.recommendationId,
      status: "CONFLICT",
      remoteEntity: f.remote,
      remoteVersion: 1,
    });
    expect((await f.repo.open(f.card)).canResolve).toBe(true);
  } finally {
    f.db.db.close();
  }
});
it.each([
  "NULL_SNAPSHOT",
  "FOREIGN_SNAPSHOT",
  "REMOTE_VERSION",
  "CACHE_VERSION",
] as const)(
  "refuses resolution from an incomplete or inconsistent %s review",
  async (mode) => {
    const f = await fixture();
    try {
      if (mode === "NULL_SNAPSHOT")
        await f.db.runAsync(
          "UPDATE sync_conflicts SET remote_payload_json='null' WHERE id=?",
          f.conflict.id,
        );
      if (mode === "FOREIGN_SNAPSHOT")
        await f.db.runAsync(
          "UPDATE sync_conflicts SET remote_payload_json=? WHERE id=?",
          JSON.stringify({ ...f.remote, ownerId: randomUUID() }),
          f.conflict.id,
        );
      if (mode === "REMOTE_VERSION")
        await f.db.runAsync(
          "UPDATE sync_conflicts SET remote_version=99 WHERE id=?",
          f.conflict.id,
        );
      if (mode === "CACHE_VERSION")
        await f.db.runAsync(
          "UPDATE copilot_decisions SET remote_version=99 WHERE id=?",
          f.recommendationId,
        );
      const review = await f.repo.open(f.card);
      await expect(
        f.repo.resolve(f.card, false, review.review),
      ).rejects.toThrow();
    } finally {
      f.db.db.close();
    }
  },
);
it("rolls back a private decision when permission is revoked after the first resolution write", async () => {
  const f = await fixture();
  try {
    const review = await f.repo.open(f.card),
      run = f.db.runAsync.bind(f.db);
    f.db.runAsync = async (sql, ...params) => {
      const result = await run(sql, ...params);
      if (sql.startsWith("UPDATE sync_outbox")) f.scope.canDecide = false;
      return result;
    };
    await expect(f.repo.resolve(f.card, true, review.review)).rejects.toThrow();
  } finally {
    f.db.db.close();
  }
});

async function ownedGroup() {
  return (
    await import("../../../../scripts/test-recommendation-decision-conflict-fixtures")
  ).nativeRecommendationDecisionConflictFixture();
}
type Group = Awaited<ReturnType<typeof ownedGroup>>;
function advance(s: Group, previous = s.review.remote) {
  return recommendationDecisionSchema.parse({
    ...previous,
    version: previous.version + 1,
    revisions: [
      ...previous.revisions,
      {
        ...previous.revisions.at(-1)!,
        ...decisionChoiceFixture("ACCEPT"),
        version: previous.version + 1,
      },
    ],
  });
}
async function addConflict(s: Group, remote: ReturnType<typeof advance>) {
  const command = await new OutboxRepository(s.a).enqueue({
    ...s.review.command,
    commandId: randomUUID(),
  });
  await new ConflictRepository(s.a).recordPushConflict(command, {
    commandId: command.commandId,
    entityType: command.entityType,
    entityId: command.entityId,
    status: "CONFLICT",
    remoteEntity: remote,
    remoteVersion: remote.version,
  });
}
async function snapshot(s: Group) {
  return Promise.all(
    [
      "copilot_decisions",
      "sync_outbox",
      "sync_conflicts",
      "copilot_messages",
      "copilot_conversations",
    ].map((table) => s.a.getAllAsync(`SELECT * FROM ${table} ORDER BY rowid`)),
  );
}
for (const mode of ["GROUP", "PULL"] as const)
  it.each([true, false])(
    `refuses a stale ${mode} decision, then resolves the complete latest group (local=%s)`,
    async (local) => {
      const s = await ownedGroup();
      try {
        const before = await s.f.repo.open(s.f.card),
          remote = advance(s);
        if (mode === "GROUP") await addConflict(s, remote);
        else await applyDecisionRecord(s.a, s.scope, remote);
        const unchanged = await snapshot(s);
        await expect(
          s.f.repo.resolve(s.f.card, local, before.review),
        ).rejects.toThrow("REVIEW");
        expect(await snapshot(s)).toEqual(unchanged);
        const review = await s.f.repo.open(s.f.card);
        expect(review.remote).toEqual(remote);
        await s.f.repo.resolve(s.f.card, local, review.review);
        const row = await s.f.repo.open(s.f.card);
        expect(row.decision!.version).toBe(local ? 3 : 2);
        expect(row.decision!.revisions.at(-1)!.type).toBe(
          local ? "MODIFY" : "ACCEPT",
        );
        expect(row.decision!.revisions.slice(0, remote.version)).toEqual(
          remote.revisions,
        );
        expect(
          await new ConflictRepository(s.a).listOpen(s.scope.storeId),
        ).toEqual([]);
        const capture = s.db
          .prepare(
            "SELECT * FROM sync_conflicts WHERE conflict_type='COPILOT_DECISION_REVIEW_CAPTURE'",
          )
          .get()!;
        expect(JSON.parse(capture.remote_payload_json as string)).toEqual(
          remote,
        );
        expect(JSON.parse(capture.local_payload_json as string)).toEqual(
          s.review.local,
        );
        expect(capture.command_id).toBeNull();
        const command = (
          await new OutboxRepository(s.a).listPending(s.scope.storeId)
        ).filter((c) => c.entityType === "copilot_decision");
        expect(command).toHaveLength(local ? 1 : 0);
        if (local) {
          expect(command[0]!.expectedRemoteVersion).toBe(2);
          expect(command[0]!.commandId).not.toBe(capture.id);
        }
        const packets = s.db
          .prepare("SELECT payload_json FROM sync_outbox WHERE command_id=?")
          .get(s.review.command.commandId)!;
        expect(JSON.parse(packets.payload_json as string)).toEqual(
          s.review.command.payload,
        );
        expect(
          (await s.a.getFirstAsync<{ n: number }>(
            "SELECT COUNT(*) n FROM commercial_execution_tasks",
          ))!.n,
        ).toBe(0);
      } finally {
        s.db.close();
      }
    },
  );
it.each([
  "PREFIX",
  "SAME_VERSION",
  "FOREIGN_LOCAL",
  "FOREIGN_COMMAND",
  "OVERSIZED",
] as const)(
  "refuses a %s group without consuming a command or conflict",
  async (mode) => {
    const s = await ownedGroup();
    try {
      if (mode === "PREFIX") {
        const next = advance(s);
        next.revisions[0] = {
          ...next.revisions[0]!,
          ...decisionChoiceFixture("ACCEPT"),
        };
        await addConflict(s, next);
      }
      if (mode === "SAME_VERSION")
        await addConflict(
          s,
          recommendationDecisionSchema.parse({
            ...s.review.remote,
            revisions: [
              {
                ...s.review.remote.revisions[0]!,
                ...decisionChoiceFixture("ACCEPT"),
              },
            ],
          }),
        );
      if (mode === "FOREIGN_LOCAL")
        await s.a.runAsync(
          "UPDATE sync_conflicts SET local_payload_json=?",
          JSON.stringify({ ...s.review.local, ownerId: randomUUID() }),
        );
      if (mode === "FOREIGN_COMMAND")
        await s.a.runAsync(
          "UPDATE sync_outbox SET payload_json=? WHERE command_id=?",
          JSON.stringify({ ...s.review.local, ownerId: randomUUID() }),
          s.review.command.commandId,
        );
      if (mode === "OVERSIZED")
        for (let n = 0; n < 100; n++) await addConflict(s, s.review.remote);
      const review = await s.f.repo.open(s.f.card),
        before = await snapshot(s);
      expect(review.canResolve).toBe(false);
      await expect(
        s.f.repo.resolve(s.f.card, false, review.review),
      ).rejects.toThrow();
      expect(await snapshot(s)).toEqual(before);
    } finally {
      s.db.close();
    }
  },
);
it.each([true, false])(
  "recovers an owned ERROR with a complete verified cache and preserves its history (local=%s)",
  async (local) => {
    const s = await ownedGroup();
    try {
      await s.a.runAsync("DELETE FROM sync_conflicts");
      await s.a.runAsync("UPDATE copilot_decisions SET sync_state='ERROR'");
      const review = await s.f.repo.open(s.f.card);
      expect(review.status).toBe("ERROR");
      expect(review.canResolve).toBe(true);
      await s.f.repo.resolve(s.f.card, local, review.review);
      expect(
        (await s.f.repo.open(s.f.card)).decision!.revisions.at(-1)!.type,
      ).toBe(local ? "MODIFY" : "REJECT");
    } finally {
      s.db.close();
    }
  },
);
it.each(["NO_REMOTE", "ARCHIVED_SOURCE", "HISTORY_LIMIT"] as const)(
  "retains source and choice when %s prevents new local decisions",
  async (mode) => {
    const s = await ownedGroup();
    try {
      if (mode === "NO_REMOTE") {
        await s.a.runAsync("DELETE FROM sync_conflicts");
        await s.a.runAsync(
          "UPDATE copilot_decisions SET remote_payload_json=NULL,remote_version=NULL,sync_state='ERROR'",
        );
      }
      if (mode === "ARCHIVED_SOURCE")
        await s.a.runAsync(
          "UPDATE copilot_conversations SET payload_json=json_set(payload_json,'$.status','ARCHIVED')",
        );
      if (mode === "HISTORY_LIMIT") {
        let remote = s.review.remote;
        for (let n = 1; n < 50; n++) remote = advance(s, remote);
        await applyDecisionRecord(s.a, s.scope, remote);
      }
      const review = await s.f.repo.open(s.f.card),
        before = await snapshot(s);
      if (mode === "NO_REMOTE") {
        expect(review.canResolve).toBe(false);
        await expect(
          s.f.repo.resolve(s.f.card, false, review.review),
        ).rejects.toThrow("REVIEW");
      } else {
        expect(review.canRetainLocal).toBe(false);
        await expect(
          s.f.repo.resolve(s.f.card, true, review.review),
        ).rejects.toThrow("SOURCE_UNAVAILABLE");
      }
      expect(await snapshot(s)).toEqual(before);
      if (mode !== "NO_REMOTE")
        await s.f.repo.resolve(s.f.card, false, review.review);
    } finally {
      s.db.close();
    }
  },
);
it.each(["CANCEL", "CALLBACK", "COMMIT", "RETURN_READ"] as const)(
  "rolls back the whole resolution on %s, without a misleading post-commit read failure",
  async (mode) => {
    const s = await ownedGroup();
    try {
      const review = await s.f.repo.open(s.f.card),
        before = await snapshot(s),
        abort = new AbortController();
      let active = true;
      if (mode === "COMMIT") s.a.fail = true;
      if (mode === "RETURN_READ") {
        const read = s.a.getFirstAsync.bind(s.a);
        let changed = false;
        s.a.afterRun = (sql) => {
          if (sql.startsWith("UPDATE sync_outbox")) changed = true;
        };
        s.a.getFirstAsync = async <T>(
          sql: string,
          ...params: Array<string | number | null>
        ) => {
          if (changed && sql.includes("FROM copilot_messages"))
            throw Error("RETURN_READ_FAILED");
          return read<T>(sql, ...params);
        };
      } else
        s.a.afterRun = (sql) => {
          if (sql.startsWith("UPDATE sync_outbox")) {
            if (mode === "CANCEL") abort.abort();
            if (mode === "CALLBACK") active = false;
          }
        };
      await expect(
        s.f.repo.resolve(
          s.f.card,
          true,
          review.review,
          abort.signal,
          () => active,
        ),
      ).rejects.toThrow();
      expect(await snapshot(s)).toEqual(before);
    } finally {
      s.db.close();
    }
  },
);

it("retains a pulled comparison after ACK and a later command conflict, then reopens offline with the same identities", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-decision-review-")),
    path = join(dir, "private.db"),
    s = await (
      await import("../../../../scripts/test-recommendation-decision-conflict-fixtures")
    ).nativeRecommendationDecisionConflictFixture(path);
  let closed = false;
  try {
    const remote = advance(s);
    await applyDecisionRecord(s.a, s.scope, remote);
    const review = await s.f.repo.open(s.f.card);
    await s.f.repo.resolve(s.f.card, true, review.review);
    const capture = s.db
        .prepare(
          "SELECT * FROM sync_conflicts WHERE conflict_type='COPILOT_DECISION_REVIEW_CAPTURE'",
        )
        .get()!,
      packet = (
        await new OutboxRepository(s.a).listPending(s.scope.storeId)
      )[0]!;
    await new OutboxRepository(s.a).markSyncing(packet.commandId);
    await applyDecisionRecord(s.a, s.scope, packet.payload, 3);
    await new OutboxRepository(s.a).markAcknowledged(packet.commandId);
    expect(
      JSON.parse(
        s.db
          .prepare("SELECT remote_payload_json FROM sync_conflicts WHERE id=?")
          .get(capture.id as string)!.remote_payload_json as string,
      ),
    ).toEqual(remote);
    const fresh = await s.f.repo.open(s.f.card);
    await s.f.repo.save(
      s.f.card,
      decisionChoiceFixture("ACCEPT"),
      fresh.review,
    );
    const command = (
        await new OutboxRepository(s.a).listPending(s.scope.storeId)
      )[0]!,
      previous = recommendationDecisionSchema.parse(packet.payload),
      latest = recommendationDecisionSchema.parse({
        ...previous,
        version: 4,
        revisions: [
          ...previous.revisions,
          {
            ...previous.revisions.at(-1)!,
            ...decisionChoiceFixture("REJECT"),
            version: 4,
          },
        ],
      });
    await applyDecisionRecord(s.a, s.scope, latest);
    await new ConflictRepository(s.a).recordPushConflict(command, {
      commandId: command.commandId,
      entityType: command.entityType,
      entityId: command.entityId,
      status: "CONFLICT",
      remoteVersion: 4,
      remoteEntity: latest,
    });
    await s.a.runAsync("UPDATE copilot_decisions SET sync_state='CONFLICT'");
    await s.a.runAsync(
      "UPDATE sync_outbox SET status='CONFLICT' WHERE command_id=?",
      command.commandId,
    );
    expect(command.commandId).not.toBe(capture.id);
    s.db.close();
    closed = true;
    const reopened = new MercalysTestDatabase(new DatabaseSync(path)),
      fetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw Error("OFFLINE");
    };
    try {
      const repo = new CopilotDecisionRepository(
          reopened,
          s.scope,
          decisionDigest,
          randomUUID,
        ),
        state = await repo.open(s.f.card);
      expect(state.canResolve).toBe(true);
      expect(state.remote).toEqual(latest);
      expect(state.decision!.revisions.at(-1)!.type).toBe("ACCEPT");
      expect(
        (await new ConflictRepository(reopened).getById(capture.id as string))!
          .status,
      ).toBe("RESOLVED_LOCAL");
      expect(
        (await new ConflictRepository(reopened).getById(command.commandId))!
          .status,
      ).toBe("OPEN");
    } finally {
      globalThis.fetch = fetch;
      reopened.db.close();
    }
  } finally {
    if (!closed) s.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
