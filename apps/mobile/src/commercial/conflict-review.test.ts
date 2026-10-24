import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { nativeCommercialConflictFixture } from "../../../../scripts/test-commercial-conflict-fixtures";
import { nativeCommercialDecisionConflictFixture } from "../../../../scripts/test-commercial-decision-conflict-fixtures";
import {
  receiptReviewDigest,
  ReceiptTestDatabase,
} from "../../../../scripts/test-receipt-publication-sqlite";
import { storeConflictPreview } from "../../../../scripts/test-store-conflict-fixtures";
import { buildStoreConflictMessages } from "../../../api/src/copilot/store-conflict-messages";
import { applyCopilotRecord } from "../copilot/conversation-repository";
import { CopilotStoreConflictController } from "../copilot/store-conflict-controller";
import {
  CommercialChoiceRepository,
  applyCommercialChoice,
} from "./offer-choice-repository";
import {
  CommercialPreparationRepository,
  applyCommercialPreparation,
} from "./week-preparation-repository";
import {
  CommercialPlanRepository,
  applyCommercialPlan,
} from "./week-plan-repository";
import {
  CommercialVersionDecisionRepository,
  applyCommercialVersionDecision,
} from "./version-decision-repository";
import {
  CommercialExecutionRepository,
  applyCommercialExecution,
} from "./execution-repository";
import {
  commercialConflictKinds,
  type CommercialConflictKind,
} from "./conflict-review";
import { ConflictRepository } from "../sync/conflict-repository";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import { joinedMutationDatabase } from "../sync/atomic-local-mutation";
import { buildCommercialWeekPlan } from "@fl-copilot/commercial-core";
import {
  commercialWeekPlanSchema,
  commercialVersionDecisionSchema,
  commercialExecutionTaskSchema,
} from "@fl-copilot/domain";
import { readWeekPlanContext } from "./week-plan-context";
const kinds = [
  "COMMERCIAL_CHOICE",
  "COMMERCIAL_PREPARATION",
  "COMMERCIAL_PLAN",
  "COMMERCIAL_REFERENCE",
  "COMMERCIAL_EXECUTION",
] as const;
const fixture = (kind: CommercialConflictKind, path = ":memory:") =>
  kind === "COMMERCIAL_REFERENCE" || kind === "COMMERCIAL_EXECUTION"
    ? nativeCommercialDecisionConflictFixture(kind, path)
    : nativeCommercialConflictFixture(kind, path);
type Fixture = Awaited<ReturnType<typeof fixture>>;
const histories = {
  COMMERCIAL_CHOICE: "commercial_choice_history",
  COMMERCIAL_PREPARATION: "commercial_preparation_history",
  COMMERCIAL_PLAN: "commercial_plan_history",
  COMMERCIAL_REFERENCE: "commercial_version_decision_history",
  COMMERCIAL_EXECUTION: "commercial_execution_history",
};
const repository = (
  s: Fixture,
  db: ConstructorParameters<typeof CommercialChoiceRepository>[0] = s.a,
  digest = receiptReviewDigest,
) => {
  const k = s.review.kind;
  return k === "COMMERCIAL_CHOICE"
    ? new CommercialChoiceRepository(db, digest)
    : k === "COMMERCIAL_PREPARATION"
      ? new CommercialPreparationRepository(db, digest)
      : k === "COMMERCIAL_PLAN"
        ? new CommercialPlanRepository(db, digest)
        : k === "COMMERCIAL_REFERENCE"
          ? new CommercialVersionDecisionRepository(db, digest)
          : new CommercialExecutionRepository(db, digest);
};
const context = (s: Fixture, hash: string) => ({
  storeId: s.scope.storeId,
  deviceId: s.scope.deviceId,
  commandId: randomUUID(),
  remoteHistoryId: randomUUID(),
  reviewHash: hash,
  canResolve: () => true,
});
const tables = (s: Fixture) => [
  ...new Set([
    s.review.table,
    histories[s.review.kind],
    "sync_outbox",
    "sync_conflicts",
    "sales_observations",
    "waste_observations",
    "source_documents",
    "commercial_visual_readings",
    "commercial_operations",
    "offers",
    "commercial_plan_revisions",
    "commercial_execution_tasks",
  ]),
];
const snapshot = (s: Fixture) =>
  tables(s).map((t) => s.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all());
const pull = (s: Fixture, remote: unknown) =>
  (s.review.kind === "COMMERCIAL_CHOICE"
    ? applyCommercialChoice
    : s.review.kind === "COMMERCIAL_PREPARATION"
      ? applyCommercialPreparation
      : s.review.kind === "COMMERCIAL_PLAN"
        ? applyCommercialPlan
        : s.review.kind === "COMMERCIAL_REFERENCE"
          ? applyCommercialVersionDecision
          : applyCommercialExecution)(s.a, s.scope.storeId, remote);
async function remoteVersion(s: Fixture, version: number) {
  if (s.review.kind !== "COMMERCIAL_PLAN")
    return { ...s.review.remote, version };
  const p = commercialWeekPlanSchema.parse(s.review.remote);
  return buildCommercialWeekPlan(
    {
      preparation: p.preparation,
      version,
      createdAt: p.createdAt,
      validatedAt: "2026-10-11T14:00:00.000Z",
    },
    await readWeekPlanContext(s.a, p.preparation),
    receiptReviewDigest,
  );
}
async function currentEntity(s: Fixture) {
  const row = await s.a.getFirstAsync<{
    payload_json: string;
    remote_version: number;
  }>(
    `SELECT payload_json,remote_version FROM ${s.review.table} WHERE id=? AND store_id=?`,
    s.review.remote.id,
    s.scope.storeId,
  );
  return {
    entity: commercialConflictKinds[s.review.kind].schema.parse(
      JSON.parse(row!.payload_json),
    ),
    remoteVersion: row!.remote_version,
  };
}
async function add(s: Fixture, remote = s.review.remote) {
  const command = await new OutboxRepository(s.a).enqueue({
    ...s.review.command,
    commandId: randomUUID(),
  });
  return new ConflictRepository(s.a).recordPushConflict(command, {
    commandId: command.commandId,
    status: "CONFLICT",
    entityType: s.review.entityType,
    entityId: s.review.remote.id,
    remoteVersion: remote.version,
    remoteEntity: remote,
  });
}
async function freshCard(s: Fixture, remote = s.review.remote) {
  const message = buildStoreConflictMessages(s.f.assistant, [
    storeConflictPreview(s.review.kind, remote),
  ])[0]!;
  await s.a.withExclusiveTransactionAsync((tx) =>
    applyCopilotRecord(tx, s.f.chat, "copilot_message", message),
  );
  return message;
}
for (const kind of kinds) {
  it.each(["OLDER_GROUP", "NEW_PULL"] as const)(
    `${kind}: old comparison cannot consume a newer baseline (%s), both choices`,
    async (mode) => {
      for (const local of [true, false]) {
        const s = await fixture(kind);
        try {
          const repo = repository(s),
            old = await repo.review(s.scope.storeId, s.review.conflict.id),
            remote = await remoteVersion(s, 3);
          if (mode === "OLDER_GROUP") await add(s, remote);
          else await pull(s, remote);
          const before = snapshot(s);
          await expect(
            repo.resolve(s.review.conflict.id, local, context(s, old.hash)),
          ).rejects.toThrow("COMMERCIAL_CONFLICT_CHANGED");
          expect(snapshot(s)).toEqual(before);
          expect(
            (await s.review.controller.open(s.review.message)).status,
          ).toBe("BLOCKED");
          const message = await freshCard(s, remote),
            state = await s.review.controller.open(message);
          expect(state.status).toBe("READY");
          await s.review.controller.confirm(
            message,
            state.review!.basisHash,
            local ? "KEEP_LOCAL" : "ADOPT_REMOTE",
            true,
          );
          const current = await currentEntity(s);
          expect(current.entity.version).toBe(local ? 4 : 3);
          expect(current.remoteVersion).toBe(3);
          const commands = (
            await new OutboxRepository(s.a).listPending(s.scope.storeId)
          ).filter((c) => c.entityType === s.review.entityType);
          expect(commands).toHaveLength(local ? 1 : 0);
          if (commands[0]) expect(commands[0].expectedRemoteVersion).toBe(3);
          expect(
            await new ConflictRepository(s.a).listOpen(s.scope.storeId),
          ).toHaveLength(0);
          if (mode === "NEW_PULL")
            expect(
              s.db
                .prepare(
                  `SELECT payload_json FROM ${histories[kind]} WHERE action='RESOLUTION_REMOTE_BASELINE'`,
                )
                .all(),
            ).toEqual([{ payload_json: JSON.stringify(remote) }]);
          expect(s.count("sales_observations")).toBe(0);
          expect(s.count("waste_observations")).toBe(0);
        } finally {
          s.db.close();
        }
      }
    },
  );
  it.each([
    "NULL",
    "ENVELOPE",
    "CONTRADICTION",
    "FOREIGN",
    "SYNCING",
    "EXCESS",
  ] as const)(
    `${kind}: refuses an unverifiable comparison (%s) without losing local work`,
    async (mode) => {
      const s = await fixture(kind);
      try {
        const repo = repository(s),
          old = await repo.review(s.scope.storeId, s.review.conflict.id);
        if (mode === "NULL")
          await s.a.runAsync(
            "UPDATE sync_conflicts SET remote_payload_json='null',remote_version=NULL WHERE id=?",
            s.review.conflict.id,
          );
        if (mode === "ENVELOPE")
          await s.a.runAsync(
            "UPDATE sync_conflicts SET remote_version=99 WHERE id=?",
            s.review.conflict.id,
          );
        if (mode === "FOREIGN")
          await s.a.runAsync(
            "UPDATE sync_conflicts SET remote_payload_json=json_set(remote_payload_json,'$.storeId',?) WHERE id=?",
            randomUUID(),
            s.review.conflict.id,
          );
        if (mode === "CONTRADICTION")
          await add(s, {
            ...s.review.remote,
            updatedAt: "2026-10-24T01:00:00.000Z",
          });
        if (mode === "SYNCING")
          await s.a.runAsync(
            "UPDATE sync_outbox SET status='SYNCING' WHERE command_id=?",
            s.review.command.commandId,
          );
        if (mode === "EXCESS") for (let i = 0; i < 100; i++) await add(s);
        const before = snapshot(s),
          review = await repo.review(s.scope.storeId, s.review.conflict.id);
        expect(review.ready).toBe(false);
        expect(review.canKeepLocal).toBe(false);
        expect(review.canAdoptRemote).toBe(false);
        for (const local of [true, false])
          await expect(
            repo.resolve(s.review.conflict.id, local, context(s, old.hash)),
          ).rejects.toThrow();
        const chat = await s.review.controller.open(s.review.message);
        expect(chat.status).toBe("BLOCKED");
        expect(chat.review?.canKeepLocal).toBe(false);
        expect(chat.review?.canAdoptRemote).toBe(false);
        expect(snapshot(s)).toEqual(before);
      } finally {
        s.db.close();
      }
    },
  );
  it(`${kind}: resolves all 100 reviewed conflicts without a hundred sends or orphaned rows`, async () => {
    const s = await fixture(kind);
    try {
      for (let i = 0; i < 99; i++) await add(s, await remoteVersion(s, i + 3));
      const repo = repository(s),
        review = await repo.review(s.scope.storeId, s.review.conflict.id);
      expect(review.group.remote?.version).toBe(101);
      expect(review.ready).toBe(true);
      await repo.resolve(s.review.conflict.id, true, context(s, review.hash));
      expect(
        await new ConflictRepository(s.a).listOpen(s.scope.storeId),
      ).toHaveLength(0);
      const pending = (
        await new OutboxRepository(s.a).listPending(s.scope.storeId)
      ).filter((c) => c.entityType === s.review.entityType);
      expect(pending).toHaveLength(1);
      expect(pending[0]!.expectedRemoteVersion).toBe(101);
      expect(
        s.db
          .prepare(
            "SELECT COUNT(*) AS n FROM sync_outbox WHERE entity_type=? AND status='ACKNOWLEDGED' AND command_id=?",
          )
          .get(s.review.entityType, s.review.command.commandId)!.n,
      ).toBe(0);
      const after = snapshot(s);
      await expect(
        repo.resolve(s.review.conflict.id, true, context(s, review.hash)),
      ).rejects.toThrow();
      expect(snapshot(s)).toEqual(after);
    } finally {
      s.db.close();
    }
  });
  it.each([
    "LOCAL",
    "COMMAND",
    "FOREIGN_CONTEXT",
    "CANCELLED",
    "REVOKED_DURING_HASH",
    "REVOKED_BEFORE_COMMIT",
    "FAILED_COMMIT",
  ] as const)(
    `${kind}: fences decision changes and rolls the whole write back (%s)`,
    async (mode) => {
      const s = await fixture(kind);
      try {
        let authorized = true;
        const normal = repository(s),
          review = await normal.review(s.scope.storeId, s.review.conflict.id),
          ctx = { ...context(s, review.hash), canResolve: () => authorized },
          cancel = new AbortController();
        if (mode === "LOCAL")
          await s.a.runAsync(
            `UPDATE ${s.review.table} SET payload_json=json_set(payload_json,'$.updatedAt','2026-10-24T01:30:00.000Z') WHERE id=?`,
            s.review.remote.id,
          );
        if (mode === "COMMAND")
          await s.a.runAsync(
            "UPDATE sync_outbox SET payload_json='{}' WHERE command_id=?",
            s.review.command.commandId,
          );
        if (mode === "FOREIGN_CONTEXT") ctx.storeId = randomUUID();
        if (mode === "CANCELLED") cancel.abort();
        const db =
          mode === "FAILED_COMMIT" || mode === "REVOKED_BEFORE_COMMIT"
            ? {
                ...joinedMutationDatabase(s.a),
                withExclusiveTransactionAsync: async (
                  work: (tx: OutboxDatabase) => Promise<void>,
                ) =>
                  s.a.withExclusiveTransactionAsync(async (tx) => {
                    if (mode === "REVOKED_BEFORE_COMMIT") {
                      const run = tx.runAsync.bind(tx),
                        proxy = {
                          ...joinedMutationDatabase(tx),
                          runAsync: async (
                            sql: string,
                            ...params: (string | number | null)[]
                          ) => {
                            const result = await run(sql, ...params);
                            if (sql.includes("UPDATE sync_conflicts"))
                              authorized = false;
                            return result;
                          },
                        };
                      await work(proxy);
                    } else {
                      await work(tx);
                      throw Error("COMMIT_FAILED");
                    }
                  }),
              }
            : s.a;
        const repo = repository(s, db, async (text) => {
            const result = await receiptReviewDigest(text);
            if (mode === "REVOKED_DURING_HASH") authorized = false;
            return result;
          }),
          before = snapshot(s);
        await expect(
          repo.resolve(s.review.conflict.id, true, {
            ...ctx,
            signal: cancel.signal,
          }),
        ).rejects.toThrow();
        expect(snapshot(s)).toEqual(before);
      } finally {
        s.db.close();
      }
    },
  );
  it(`${kind}: manual decision persists offline and chat replay is exactly once after reopening SQLite`, async () => {
    for (const local of [true, false]) {
      const dir = mkdtempSync(join(tmpdir(), "fl-commercial-review-")),
        path = join(dir, "device.db"),
        s = await fixture(kind, path);
      let reopened: DatabaseSync | undefined;
      try {
        const repo = repository(s),
          review = await repo.review(s.scope.storeId, s.review.conflict.id);
        await repo.resolve(
          s.review.conflict.id,
          local,
          context(s, review.hash),
        );
        const before = snapshot(s);
        s.db.close();
        reopened = new DatabaseSync(path);
        expect(
          tables(s).map((t) =>
            reopened!.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
          ),
        ).toEqual(before);
        const controller = new CopilotStoreConflictController(
          new ReceiptTestDatabase(reopened),
          s.review.scope,
          receiptReviewDigest,
          randomUUID,
        );
        expect((await controller.open(s.review.message)).status).toBe(
          "UNCHANGED",
        );
        await expect(
          controller.confirm(
            s.review.message,
            s.review.state.review!.basisHash,
            local ? "KEEP_LOCAL" : "ADOPT_REMOTE",
            true,
          ),
        ).rejects.toThrow();
        expect(
          tables(s).map((t) =>
            reopened!.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
          ),
        ).toEqual(before);
      } finally {
        if (reopened) reopened.close();
        else s.db.close();
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
}
it.each(["LOCAL", "REMOTE"] as const)(
  "manual offer retention requires separate consent after withdrawal (%s)",
  async (withdrawal) => {
    const s = await nativeCommercialConflictFixture(
      "COMMERCIAL_CHOICE",
      ":memory:",
      withdrawal,
    );
    try {
      const repo = repository(s),
        review = await repo.review(s.scope.storeId, s.review.conflict.id),
        local = withdrawal === "REMOTE",
        before = snapshot(s);
      await expect(
        repo.resolve(s.review.conflict.id, local, context(s, review.hash)),
      ).rejects.toThrow("COMMERCIAL_CONFLICT_RETENTION_REQUIRED");
      expect(snapshot(s)).toEqual(before);
      await repo.resolve(s.review.conflict.id, local, {
        ...context(s, review.hash),
        retainWithdrawn: true,
      });
      expect((await currentEntity(s)).entity).toMatchObject({
        status: "RETAINED",
      });
    } finally {
      s.db.close();
    }
  },
);
it("retains the selected PDF across reversed remote order and a newer group without rewriting originals", async () => {
  const s = await nativeCommercialDecisionConflictFixture(
    "COMMERCIAL_REFERENCE",
    ":memory:",
    true,
  );
  try {
    const local = commercialVersionDecisionSchema.parse(s.review.local),
      selected =
        local.preference === "KEEP_PREVIOUS"
          ? local.before.documentId
          : local.after.documentId,
      originals = s.db
        .prepare("SELECT * FROM source_documents ORDER BY id")
        .all(),
      repo = repository(s),
      old = await repo.review(s.scope.storeId, s.review.conflict.id),
      remote = await remoteVersion(s, 3);
    await add(s, remote);
    await expect(
      repo.resolve(s.review.conflict.id, true, context(s, old.hash)),
    ).rejects.toThrow("COMMERCIAL_CONFLICT_CHANGED");
    const fresh = await repo.review(s.scope.storeId, s.review.conflict.id);
    await repo.resolve(s.review.conflict.id, true, context(s, fresh.hash));
    const saved = commercialVersionDecisionSchema.parse(
      (await currentEntity(s)).entity,
    );
    expect(
      saved.preference === "KEEP_PREVIOUS"
        ? saved.before.documentId
        : saved.after.documentId,
    ).toBe(selected);
    expect(saved.before).toEqual(
      commercialVersionDecisionSchema.parse(remote).before,
    );
    expect(
      s.db.prepare("SELECT * FROM source_documents ORDER BY id").all(),
    ).toEqual(originals);
  } finally {
    s.db.close();
  }
});
it("retaining a recorded completion on the latest task group does not create a new completion or change plan identity", async () => {
  const s = await fixture("COMMERCIAL_EXECUTION");
  try {
    const before = s.db
        .prepare(
          "SELECT payload_json FROM commercial_execution_tasks WHERE id=?",
        )
        .get(s.review.remote.id)!,
      local = JSON.parse(String(before.payload_json)),
      count = s.count("commercial_execution_tasks"),
      repo = repository(s);
    await add(s, await remoteVersion(s, 3));
    const fresh = await repo.review(s.scope.storeId, s.review.conflict.id);
    await repo.resolve(s.review.conflict.id, true, context(s, fresh.hash));
    expect((await currentEntity(s)).entity).toMatchObject({
      planId: local.planId,
      planRevisionId: local.planRevisionId,
      planChecksum: local.planChecksum,
      targetId: local.targetId,
      status: local.status,
      completedAt: local.completedAt,
      ...(local.actuals === undefined ? {} : { actuals: local.actuals }),
    });
    expect(
      commercialExecutionTaskSchema.parse((await currentEntity(s)).entity)
        .actuals,
    ).toEqual(local.actuals);
    expect(s.count("commercial_execution_tasks")).toBe(count);
  } finally {
    s.db.close();
  }
});
it.each([
  "COMMERCIAL_CHOICE",
  "COMMERCIAL_PREPARATION",
  "COMMERCIAL_PLAN",
] as const)(
  "%s: current dependencies are bound to manual consent while a valid remote adoption remains explicit",
  async (kind) => {
    const s = await fixture(kind);
    try {
      const repo = repository(s),
        old = await repo.review(s.scope.storeId, s.review.conflict.id);
      await s.a.runAsync(
        "UPDATE commercial_visual_readings SET payload_json=json_set(payload_json,'$.checksum','sha256:changed') WHERE store_id=?",
        s.scope.storeId,
      );
      const before = snapshot(s);
      await expect(
        repo.resolve(s.review.conflict.id, true, context(s, old.hash)),
      ).rejects.toThrow();
      expect(snapshot(s)).toEqual(before);
      const fresh = await repo.review(s.scope.storeId, s.review.conflict.id);
      // A preparation is still a draft: source changes invalidate consent,
      // but only final-plan/retained-offer eligibility needs the exact source.
      expect(fresh.canKeepLocal).toBe(kind === "COMMERCIAL_PREPARATION");
      expect(fresh.canAdoptRemote).toBe(true);
      await repo.resolve(s.review.conflict.id, false, context(s, fresh.hash));
    } finally {
      s.db.close();
    }
  },
);
