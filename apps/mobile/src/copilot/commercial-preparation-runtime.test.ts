import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import {
  preparationIntent,
  preparationReadResultSchema,
} from "@fl-copilot/domain";
import { runLocalMigrations } from "../db/migrations";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { CopilotConversationRepository } from "./conversation-repository";
import { CopilotCommercialPreparationRuntime } from "./commercial-preparation-runtime";
import { CopilotToolRuntime } from "./tool-runtime";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import {
  commercialChoiceFixture,
  testChoiceDigest,
} from "../../../../scripts/test-commercial-choice-fixtures";
import { applyCommercialChoice } from "../commercial/offer-choice-repository";
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
    deviceId = randomUUID();
  await runLocalMigrations(a);
  const c = new CopilotConversationRepository(a, f);
  await c.save(f.conversation, { commandId: randomUUID(), deviceId });
  await c.append(
    {
      ...f.message,
      text: "Enregistre ce brouillon commercial.",
      attachments: [],
    },
    { commandId: randomUUID(), deviceId },
  );
  const choice = await commercialChoiceFixture({ storeId: f.storeId });
  await applyCommercialChoice(a, f.storeId, choice.choice);
  const request = {
    operationId: randomUUID(),
    schemaVersion: 1,
    tool: "commercial.preparation.save",
    input: {
      expectedVersion: null as number | null,
      draft: {
        weekStart: "2026-10-05",
        weekEnd: "2026-10-11",
        status: "DRAFT",
        tgCapacity: 1,
        offerRefs: [{ choiceId: choice.choice.id, choiceVersion: 1 }],
        placements: [
          {
            id: randomUUID(),
            label: "TG entrée",
            theme: "Raisin",
            offerIds: [choice.choice.id],
            sourceIdea: null,
          },
        ],
        note: "Plan validé",
      },
    },
  };
  const authority = (r: unknown) => ({
    storeId: f.storeId,
    ownerId: f.ownerId,
    conversationId: f.conversation.id,
    deviceId,
    canPrepareCommercialWeek: true,
    userMessageId: f.message.id,
    authorizedRequestJson: preparationIntent(r),
    decisionLevel: "REVIEWED" as const,
  });
  const runtime = new CopilotCommercialPreparationRuntime(
    a,
    testChoiceDigest,
    randomUUID,
    () => "2026-10-11T12:00:00Z",
  );
  return { db, a, f, request, authority, runtime, choice };
}
it("saves offline and replays exactly once after restart; reads explicit week without publishing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "copilot-prep-")),
    path = join(dir, "local.db"),
    s = await setup(path);
  let reopened: DatabaseSync | undefined;
  try {
    const result = await s.runtime.execute(s.request, s.authority(s.request));
    expect(result.after.version).toBe(1);
    expect(result.syncState).toBe("PENDING");
    s.db.close();
    reopened = new DatabaseSync(path);
    const a = new Adapter(reopened),
      r = new CopilotCommercialPreparationRuntime(
        a,
        testChoiceDigest,
        randomUUID,
      );
    expect(await r.execute(s.request, s.authority(s.request))).toEqual(result);
    expect(
      reopened
        .prepare("SELECT COUNT(*) n FROM commercial_preparation_history")
        .get(),
    ).toEqual({ n: 1 });
    expect(
      reopened
        .prepare(
          "SELECT COUNT(*) n FROM sync_outbox WHERE command_type='COMMERCIAL_WEEK_PREPARATION_UPSERT'",
        )
        .get(),
    ).toEqual({ n: 1 });
    const read = preparationReadResultSchema.parse(
      await new CopilotToolRuntime(a).execute(
        {
          operationId: randomUUID(),
          schemaVersion: 1,
          tool: "commercial.preparation.inspect",
          input: { weekStart: "2026-10-05" },
        },
        {
          storeId: s.f.storeId,
          ownerId: s.f.ownerId,
          conversationId: s.f.conversation.id,
          canReadStore: true,
        },
      ),
    );
    expect(read.snapshot?.entity).toEqual(result.after);
    expect(read.snapshot?.syncState).toBe("PENDING");
    expect(
      reopened.prepare("SELECT COUNT(*) n FROM commercial_week_plans").get(),
    ).toEqual({ n: 0 });
  } finally {
    reopened?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("requires reviewed permission, exact current version and canonical week/capacity", async () => {
  const s = await setup();
  try {
    await expect(
      s.runtime.execute(s.request, {
        ...s.authority(s.request),
        canPrepareCommercialWeek: false,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      s.runtime.execute(s.request, {
        ...s.authority(s.request),
        decisionLevel: "ROUTINE",
      }),
    ).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    await s.runtime.execute(s.request, s.authority(s.request));
    const stale = { ...s.request, operationId: randomUUID() };
    await expect(
      s.runtime.execute(stale, s.authority(stale)),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const updated = {
      ...stale,
      input: {
        ...stale.input,
        expectedVersion: 1,
        draft: { ...stale.input.draft, note: "Autre note" },
      },
    };
    const result = await s.runtime.execute(updated, s.authority(updated));
    expect(result.after.version).toBe(2);
    const invalid = {
      ...updated,
      operationId: randomUUID(),
      input: {
        ...updated.input,
        expectedVersion: 2,
        draft: { ...updated.input.draft, tgCapacity: 0 },
      },
    };
    await expect(
      s.runtime.execute(invalid, s.authority(invalid)),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      s.runtime.execute(s.request, {
        ...s.authority(s.request),
        ownerId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      s.db
        .prepare("SELECT COUNT(*) n FROM commercial_preparation_history")
        .get(),
    ).toEqual({ n: 2 });
  } finally {
    s.db.close();
  }
});
it("rejects changed offers and rolls back save, history, outbox and journal on failure or cancellation", async () => {
  const s = await setup();
  try {
    const changed = {
      ...s.request,
      operationId: randomUUID(),
      input: {
        ...s.request.input,
        draft: {
          ...s.request.input.draft,
          offerRefs: [{ choiceId: s.choice.choice.id, choiceVersion: 2 }],
        },
      },
    };
    await expect(
      s.runtime.execute(changed, s.authority(changed)),
    ).rejects.toMatchObject({ code: "COMMERCIAL_OFFERS_CHANGED" });
    s.a.fail = true;
    await expect(
      s.runtime.execute(s.request, s.authority(s.request)),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    s.a.fail = false;
    const abort = new AbortController();
    abort.abort();
    await expect(
      s.runtime.execute(s.request, s.authority(s.request), abort.signal),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    for (const table of [
      "commercial_week_preparations",
      "commercial_preparation_history",
      "copilot_tool_results",
    ])
      expect(s.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).toEqual({
        n: 0,
      });
    expect(
      s.db
        .prepare(
          "SELECT COUNT(*) n FROM sync_outbox WHERE command_type='COMMERCIAL_WEEK_PREPARATION_UPSERT'",
        )
        .get(),
    ).toEqual({ n: 0 });
  } finally {
    s.db.close();
  }
});
it("keeps missing weeks absent, blocks foreign reads and rejects forged source ideas", async () => {
  const s = await setup();
  try {
    const r = new CopilotToolRuntime(s.a),
      scope = {
        storeId: s.f.storeId,
        ownerId: s.f.ownerId,
        conversationId: s.f.conversation.id,
        canReadStore: true,
      },
      read = {
        operationId: randomUUID(),
        schemaVersion: 1,
        tool: "commercial.preparation.inspect",
        input: { weekStart: "2026-10-12" },
      };
    expect(
      preparationReadResultSchema.parse(await r.execute(read, scope)).snapshot,
    ).toBeNull();
    await expect(
      r.execute(read, { ...scope, ownerId: randomUUID() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      r.execute(
        {
          ...read,
          operationId: randomUUID(),
          input: { weekStart: "2026-10-13" },
        },
        scope,
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const forged = {
      ...s.request,
      input: {
        ...s.request.input,
        draft: {
          ...s.request.input.draft,
          placements: s.request.input.draft.placements.map((p) => ({
            ...p,
            sourceIdea: {
              readingId: randomUUID(),
              checksum: "invented",
              tgIndex: 0,
            },
          })),
        },
      },
    };
    await expect(
      s.runtime.execute(forged, s.authority(forged)),
    ).rejects.toMatchObject({ code: "COMMERCIAL_SOURCE_INVALID" });
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM commercial_week_preparations").get(),
    ).toEqual({ n: 0 });
  } finally {
    s.db.close();
  }
});
