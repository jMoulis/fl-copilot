import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import {
  executionSaveIntent,
  executionReadResultSchema,
} from "@fl-copilot/domain";
import { buildCommercialWeekPlan } from "@fl-copilot/commercial-core";
import { runLocalMigrations } from "../db/migrations";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { CopilotConversationRepository } from "./conversation-repository";
import { CopilotCommercialExecutionRuntime } from "./commercial-execution-runtime";
import { CopilotToolRuntime } from "./tool-runtime";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import { commercialExecutionFixture } from "../../../../scripts/test-commercial-execution-fixtures";
import { testChoiceDigest } from "../../../../scripts/test-commercial-choice-fixtures";
import { applyCommercialPlan } from "../commercial/week-plan-repository";
class Adapter implements OutboxDatabase {
  fail = false;
  constructor(readonly db: DatabaseSync) {}
  async execAsync(s: string) {
    this.db.exec(s);
  }
  async getFirstAsync<T>(s: string, ...p: Array<string | number | null>) {
    return (this.db.prepare(s).get(...p) as T) ?? null;
  }
  async getAllAsync<T>(s: string, ...p: Array<string | number | null>) {
    return this.db.prepare(s).all(...p) as T[];
  }
  async runAsync(s: string, ...p: Array<string | number | null>) {
    return this.db.prepare(s).run(...p);
  }
  async withExclusiveTransactionAsync(
    task: (tx: OutboxDatabase) => Promise<void>,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      await task(this);
      if (this.fail) throw Error("private database error");
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}

async function setup(path = ":memory:") {
  const db = new DatabaseSync(path),
    a = new Adapter(db),
    f = chatFixture(randomUUID),
    fixture = await commercialExecutionFixture(),
    deviceId = randomUUID();
  f.storeId = fixture.storeId;
  f.conversation.storeId = fixture.storeId;
  f.message.storeId = fixture.storeId;
  await runLocalMigrations(a);
  const c = new CopilotConversationRepository(a, f);
  await c.save(f.conversation, { commandId: randomUUID(), deviceId });
  await c.append(
    { ...f.message, text: "J’ai imprimé cette affiche.", attachments: [] },
    { commandId: randomUUID(), deviceId },
  );
  await applyCommercialPlan(a, f.storeId, fixture.plan);
  const request = {
    operationId: randomUUID(),
    schemaVersion: 1,
    tool: "commercial.execution.save",
    input: {
      weekStart: fixture.plan.weekStart,
      planVersion: 1,
      taskId: fixture.proposals[0]!.id,
      expectedVersion: null as number | null,
      status: "DONE" as const,
      note: "Affiche imprimée",
    },
  };
  const authority = (r: unknown) => ({
    storeId: f.storeId,
    ownerId: f.ownerId,
    conversationId: f.conversation.id,
    deviceId,
    canDeclareCommercialExecution: true,
    userMessageId: f.message.id,
    authorizedRequestJson: executionSaveIntent(r),
    decisionLevel: "REVIEWED" as const,
  });
  const scope = {
      storeId: f.storeId,
      ownerId: f.ownerId,
      conversationId: f.conversation.id,
      canReadStore: true,
    },
    reader = new CopilotToolRuntime(
      a,
      () => "2026-10-11T12:01:00Z",
      testChoiceDigest,
    ),
    runtime = new CopilotCommercialExecutionRuntime(
      a,
      testChoiceDigest,
      randomUUID,
      () => "2026-10-11T12:02:00Z",
    );
  const read = {
    operationId: randomUUID(),
    schemaVersion: 1,
    tool: "commercial.execution.inspect",
    input: { weekStart: fixture.plan.weekStart },
  };
  return {
    db,
    a,
    f,
    fixture,
    request,
    authority,
    scope,
    reader,
    runtime,
    read,
  };
}
it("reads TODO proposals, saves a declaration offline and replays once after restart without modifying the plan", async () => {
  const dir = mkdtempSync(join(tmpdir(), "copilot-execution-")),
    path = join(dir, "local.db"),
    s = await setup(path);
  let reopened: DatabaseSync | undefined;
  try {
    const original = JSON.stringify(
      s.db.prepare("SELECT payload_json FROM commercial_week_plans").get(),
    );
    const view = executionReadResultSchema.parse(
      await s.reader.execute(s.read, s.scope),
    );
    expect(view.progress).toEqual({
      total: 2,
      TODO: 2,
      DONE: 0,
      SKIPPED: 0,
      NOT_APPLICABLE: 0,
    });
    expect(view.tasks.every((t) => t.record === null)).toBe(true);
    const saved = await s.runtime.execute(s.request, s.authority(s.request));
    expect(saved.after.completedAt).toBe("2026-10-11T12:02:00Z");
    expect(
      JSON.stringify(
        s.db.prepare("SELECT payload_json FROM commercial_week_plans").get(),
      ),
    ).toBe(original);
    s.db.close();
    reopened = new DatabaseSync(path);
    const a = new Adapter(reopened),
      r = new CopilotCommercialExecutionRuntime(
        a,
        testChoiceDigest,
        randomUUID,
      );
    expect(await r.execute(s.request, s.authority(s.request))).toEqual(saved);
    const again = {
        ...s.request,
        operationId: randomUUID(),
        input: { ...s.request.input, expectedVersion: 1 },
      },
      noop = await r.execute(again, s.authority(again));
    expect(noop.commandId).toBeNull();
    expect(noop.after).toEqual(saved.after);
    expect(
      reopened
        .prepare("SELECT COUNT(*) n FROM commercial_execution_history")
        .get(),
    ).toEqual({ n: 1 });
    expect(
      reopened
        .prepare(
          "SELECT COUNT(*) n FROM sync_outbox WHERE command_type='COMMERCIAL_EXECUTION_TASK_UPSERT'",
        )
        .get(),
    ).toEqual({ n: 1 });
    const fresh = executionReadResultSchema.parse(
      await new CopilotToolRuntime(a, undefined, testChoiceDigest).execute(
        { ...s.read, operationId: randomUUID() },
        s.scope,
      ),
    );
    expect(fresh.progress.DONE).toBe(1);
    expect(fresh.tasks[0]?.record?.syncState).toBe("PENDING");
  } finally {
    reopened?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("preserves the DONE declaration date for note edits and clears it when explicitly reopening the task", async () => {
  const s = await setup();
  try {
    const saved = await s.runtime.execute(s.request, s.authority(s.request));
    const edited = {
      ...s.request,
      operationId: randomUUID(),
      input: {
        ...s.request.input,
        expectedVersion: 1,
        note: "Affiche remplacée",
      },
    };
    const r = new CopilotCommercialExecutionRuntime(
        s.a,
        testChoiceDigest,
        randomUUID,
        () => "2026-10-11T12:03:00Z",
      ),
      result = await r.execute(edited, s.authority(edited));
    expect(result.after.completedAt).toBe(saved.after.completedAt);
    expect(result.after.version).toBe(2);
    const reopen = {
      ...edited,
      operationId: randomUUID(),
      input: {
        ...edited.input,
        expectedVersion: 2,
        status: "TODO" as const,
        note: "À réimprimer",
      },
    };
    expect(
      (await r.execute(reopen, s.authority(reopen))).after.completedAt,
    ).toBeNull();
    expect(
      s.db
        .prepare(
          "SELECT expected_remote_version FROM sync_outbox WHERE entity_type='commercial_execution_task' ORDER BY local_sequence",
        )
        .all(),
    ).toEqual([
      { expected_remote_version: null },
      { expected_remote_version: 1 },
      { expected_remote_version: 2 },
    ]);
  } finally {
    s.db.close();
  }
});
it("rejects stale task/plan versions, old targets, unreviewed intent and revoked or foreign authority", async () => {
  const s = await setup();
  try {
    await expect(
      s.runtime.execute(s.request, {
        ...s.authority(s.request),
        decisionLevel: "ROUTINE",
      }),
    ).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    const invalid = {
      ...s.request,
      input: { ...s.request.input, status: "SKIPPED", note: "" },
    };
    await expect(
      s.runtime.execute(invalid, s.authority(s.request)),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await s.runtime.execute(s.request, s.authority(s.request));
    await expect(
      s.runtime.execute(s.request, {
        ...s.authority(s.request),
        canDeclareCommercialExecution: false,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      s.runtime.execute(s.request, {
        ...s.authority(s.request),
        ownerId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const stale = { ...s.request, operationId: randomUUID() };
    await expect(
      s.runtime.execute(stale, s.authority(stale)),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const newPlan = await buildCommercialWeekPlan(
      {
        preparation: s.fixture.preparation,
        version: 2,
        createdAt: s.fixture.plan.createdAt,
        validatedAt: "2026-10-11T12:04:00Z",
      },
      s.fixture.context,
      testChoiceDigest,
    );
    await applyCommercialPlan(s.a, s.f.storeId, newPlan);
    await expect(
      s.runtime.execute(stale, s.authority(stale)),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const oldTarget = {
      ...stale,
      input: { ...stale.input, planVersion: 2, expectedVersion: 1 },
    };
    await expect(
      s.runtime.execute(oldTarget, s.authority(oldTarget)),
    ).rejects.toMatchObject({ code: "COMMERCIAL_EXECUTION_UNAVAILABLE" });
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM commercial_execution_history").get(),
    ).toEqual({ n: 1 });
  } finally {
    s.db.close();
  }
});
it("keeps absent plans absent, blocks conflicts and rolls back declarations on commit failure or cancellation", async () => {
  const s = await setup();
  try {
    expect(
      executionReadResultSchema.parse(
        await s.reader.execute(
          { ...s.read, input: { weekStart: "2026-10-12" } },
          s.scope,
        ),
      ).plan,
    ).toBeNull();
    s.a.fail = true;
    await expect(
      s.runtime.execute(s.request, s.authority(s.request)),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    s.a.fail = false;
    const controller = new AbortController();
    controller.abort();
    await expect(
      s.runtime.execute(s.request, s.authority(s.request), controller.signal),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    for (const t of [
      "commercial_execution_tasks",
      "commercial_execution_history",
    ])
      expect(s.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get()).toEqual({
        n: 0,
      });
    await s.runtime.execute(s.request, s.authority(s.request));
    s.db.exec("UPDATE commercial_execution_tasks SET sync_state='CONFLICT'");
    const next = {
      ...s.request,
      operationId: randomUUID(),
      input: { ...s.request.input, expectedVersion: 1, note: "Autre" },
    };
    await expect(
      s.runtime.execute(next, s.authority(next)),
    ).rejects.toMatchObject({ code: "SYNC_CONFLICT" });
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM commercial_execution_history").get(),
    ).toEqual({ n: 1 });
  } finally {
    s.db.close();
  }
});
