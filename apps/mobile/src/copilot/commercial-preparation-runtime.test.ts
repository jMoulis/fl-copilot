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

async function preparationCard(
  x: Awaited<ReturnType<typeof setup>>,
  override?: unknown,
  extraChoices: Awaited<
    ReturnType<typeof commercialChoiceFixture>
  >["choice"][] = [],
) {
  const {
    copilotMessageSchema,
    copilotPreparationPatchSchema,
    hasPreparationLayoutChange,
  } = await import("@fl-copilot/domain");
  const { applyCopilotRecord } = await import("./conversation-repository");
  const after = (await x.runtime.execute(x.request, x.authority(x.request)))
    .after;
  const assistant = copilotMessageSchema.parse({
    ...x.f.message,
    id: randomUUID(),
    role: "ASSISTANT",
    replyToMessageId: x.f.message.id,
    attachments: [],
    text: "Brouillon préparé.",
  });
  const input = copilotPreparationPatchSchema.parse(
    override ?? {
      weekStart: after.weekStart,
      patch: {
        note: "Une nouvelle note",
        tgUpdates: [
          {
            placementId: after.placements[0].id,
            theme: "Nouveau thème",
            offerIds: [],
          },
        ],
      },
    },
  );
  const message = copilotMessageSchema.parse({
    ...assistant,
    id: randomUUID(),
    role: "TOOL",
    text: JSON.stringify({
      kind: "COMMERCIAL_PREPARATION_PROPOSAL",
      schemaVersion: input.patch.offerSelection
        ? 4
        : hasPreparationLayoutChange(input)
          ? 2
          : 1,
      assistantMessageId: assistant.id,
      input,
      basis: {
        preparation: after,
        choices: [x.choice.choice, ...extraChoices],
      },
    }),
  });
  await x.a.withExclusiveTransactionAsync(async (tx) => {
    await applyCopilotRecord(tx, x.f, "copilot_message", assistant);
    await applyCopilotRecord(tx, x.f, "copilot_message", message);
  });
  return message;
}
async function preparationController(
  x: Awaited<ReturnType<typeof setup>>,
  allowed = true,
  a = x.a,
) {
  const { CopilotPreparationProposalController } =
    await import("./preparation-proposal-controller");
  return new CopilotPreparationProposalController(
    a,
    {
      storeId: x.f.storeId,
      ownerId: x.f.ownerId,
      deviceId: x.authority(x.request).deviceId,
      canPrepareCommercialWeek: allowed,
    },
    testChoiceDigest,
    randomUUID,
  );
}
it("confirms a private TG patch offline and replays after restart without changing plan, offers or duplicate outbox", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tg-card-")),
    path = join(dir, "local.db"),
    x = await setup(path);
  let reopened: DatabaseSync | undefined;
  try {
    const m = await preparationCard(x),
      c = await preparationController(x);
    expect((await c.open(m)).status).toBe("READY");
    expect((await c.confirm(m)).status).toBe("COMPLETED");
    x.db.close();
    reopened = new DatabaseSync(path);
    const a = new Adapter(reopened);
    expect(
      (await (await preparationController(x, true, a)).confirm(m)).status,
    ).toBe("COMPLETED");
    expect(
      reopened
        .prepare("SELECT COUNT(*) n FROM commercial_preparation_history")
        .get(),
    ).toEqual({ n: 2 });
    expect(
      reopened
        .prepare(
          "SELECT COUNT(*) n FROM sync_outbox WHERE entity_type='commercial_week_preparation'",
        )
        .get(),
    ).toEqual({ n: 2 });
    const row = reopened
      .prepare("SELECT payload_json FROM commercial_week_preparations")
      .get() as { payload_json: string };
    expect(JSON.parse(row.payload_json)).toMatchObject({
      note: "Une nouvelle note",
      version: 2,
      placements: [{ theme: "Nouveau thème", offerIds: [] }],
    });
    expect(
      reopened.prepare("SELECT COUNT(*) n FROM commercial_week_plans").get(),
    ).toEqual({ n: 0 });
    await expect(
      (await preparationController(x, false, a)).confirm(m),
    ).rejects.toThrow("FORBIDDEN");
  } finally {
    reopened?.close();
    try {
      x.db.close();
    } catch {
      /* already closed */
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
it("rejects untrusted/stale/forbidden TG cards, cancellation and failed commits without a partial draft", async () => {
  const x = await setup();
  try {
    const m = await preparationCard(x),
      c = await preparationController(x);
    await expect(
      (await preparationController(x, false)).confirm(m),
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      c.confirm({ ...m, text: m.text.replace("Nouveau thème", "Autre") }),
    ).rejects.toThrow();
    const abort = new AbortController();
    abort.abort();
    await expect(c.confirm(m, abort.signal)).rejects.toThrow();
    x.a.fail = true;
    await expect(c.confirm(m)).rejects.toThrow();
    x.a.fail = false;
    expect(
      x.db
        .prepare("SELECT COUNT(*) n FROM commercial_preparation_history")
        .get(),
    ).toEqual({ n: 1 });
    const r = x.db
      .prepare("SELECT payload_json FROM commercial_week_preparations")
      .get() as { payload_json: string };
    const changed = { ...JSON.parse(r.payload_json), version: 2 };
    x.db
      .prepare("UPDATE commercial_week_preparations SET payload_json=?")
      .run(JSON.stringify(changed));
    expect((await c.open(m)).status).toBe("STALE");
    await expect(c.confirm(m)).rejects.toThrow("STALE");
  } finally {
    x.db.close();
  }
});
it("refuses TG patch when a selected choice changes or local sync is in conflict", async () => {
  for (const conflict of [false, true]) {
    const x = await setup();
    try {
      const m = await preparationCard(x),
        c = await preparationController(x);
      if (conflict)
        x.db
          .prepare("UPDATE commercial_offer_choices SET sync_state='CONFLICT'")
          .run();
      else {
        x.db
          .prepare("UPDATE commercial_offer_choices SET payload_json=?")
          .run(JSON.stringify({ ...x.choice.choice, version: 2 }));
      }
      expect((await c.open(m)).status).toBe("STALE");
      await expect(c.confirm(m)).rejects.toThrow("STALE");
    } finally {
      x.db.close();
    }
  }
});

it("adds and removes draft TGs after explicit review, replays their stable identities after restart and preserves selected offers/history", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tg-layout-")),
    path = join(dir, "local.db"),
    x = await setup(path);
  let reopened: DatabaseSync | undefined;
  try {
    const old = x.request.input.draft.placements[0];
    const m = await preparationCard(x, {
      weekStart: x.request.input.draft.weekStart,
      patch: {
        tgCapacity: 2,
        tgRemovals: [old.id],
        tgAdditions: [
          {
            label: "TG entrée nouvelle",
            theme: "Saison",
            offerIds: [x.choice.choice.id],
          },
          { label: "TG sortie", theme: "", offerIds: [] },
        ],
      },
    });
    const c = await preparationController(x);
    const expected = (await c.open(m)).request.input.draft;
    expect(expected.placements).toHaveLength(2);
    expect(expected.placements.every((t) => t.id !== old.id)).toBe(true);
    await c.confirm(m);
    x.db.close();
    reopened = new DatabaseSync(path);
    const a = new Adapter(reopened);
    expect(
      (await (await preparationController(x, true, a)).confirm(m)).status,
    ).toBe("COMPLETED");
    const row = reopened
      .prepare("SELECT payload_json FROM commercial_week_preparations")
      .get() as { payload_json: string };
    const saved = JSON.parse(row.payload_json);
    expect(saved.placements).toEqual(expected.placements);
    expect(saved.offerRefs).toEqual(x.request.input.draft.offerRefs);
    expect(
      reopened
        .prepare("SELECT COUNT(*) n FROM commercial_preparation_history")
        .get(),
    ).toEqual({ n: 2 });
    expect(
      reopened
        .prepare(
          "SELECT COUNT(*) n FROM sync_outbox WHERE entity_type='commercial_week_preparation'",
        )
        .get(),
    ).toEqual({ n: 2 });
    expect(
      reopened.prepare("SELECT COUNT(*) n FROM commercial_offer_choices").get(),
    ).toEqual({ n: 1 });
    expect(
      reopened.prepare("SELECT COUNT(*) n FROM commercial_week_plans").get(),
    ).toEqual({ n: 0 });
    const oldHistory = reopened
      .prepare(
        "SELECT payload_json FROM commercial_preparation_history ORDER BY rowid LIMIT 1",
      )
      .get() as { payload_json: string };
    expect(JSON.parse(oldHistory.payload_json).placements[0].id).toBe(old.id);
    await expect(
      (await preparationController(x, false, a)).confirm(m),
    ).rejects.toThrow("FORBIDDEN");
  } finally {
    reopened?.close();
    try {
      x.db.close();
    } catch {
      /* already closed */
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
it("rolls back added/removed TGs on failed commit and refuses deletion when its reviewed basis changes", async () => {
  const x = await setup();
  try {
    const old = x.request.input.draft.placements[0];
    const m = await preparationCard(x, {
        weekStart: x.request.input.draft.weekStart,
        patch: {
          tgRemovals: [old.id],
          tgAdditions: [{ label: "Autre TG", theme: "", offerIds: [] }],
        },
      }),
      c = await preparationController(x);
    const before = x.db
      .prepare("SELECT payload_json FROM commercial_week_preparations")
      .get();
    x.a.fail = true;
    await expect(c.confirm(m)).rejects.toThrow();
    x.a.fail = false;
    expect(
      x.db
        .prepare("SELECT payload_json FROM commercial_week_preparations")
        .get(),
    ).toEqual(before);
    expect(
      x.db
        .prepare("SELECT COUNT(*) n FROM commercial_preparation_history")
        .get(),
    ).toEqual({ n: 1 });
    const r = before as { payload_json: string },
      changed = JSON.parse(r.payload_json);
    changed.placements[0].theme = "Modification locale";
    x.db
      .prepare("UPDATE commercial_week_preparations SET payload_json=?")
      .run(JSON.stringify(changed));
    expect((await c.open(m)).status).toBe("STALE");
    await expect(c.confirm(m)).rejects.toThrow("STALE");
  } finally {
    x.db.close();
  }
});

async function newWeekCard(x: Awaited<ReturnType<typeof setup>>) {
  const { copilotMessageSchema, copilotPreparationPatchSchema } =
      await import("@fl-copilot/domain"),
    { applyCopilotRecord } = await import("./conversation-repository");
  const assistant = copilotMessageSchema.parse({
    ...x.f.message,
    id: randomUUID(),
    role: "ASSISTANT",
    replyToMessageId: x.f.message.id,
    attachments: [],
    text: "Nouvelle semaine préparée.",
  });
  const input = copilotPreparationPatchSchema.parse({
    weekStart: x.request.input.draft.weekStart,
    create: { choiceIds: [x.choice.choice.id] },
    patch: {
      tgCapacity: 1,
      tgAdditions: [
        {
          label: "TG nouvelle",
          theme: "Saison",
          offerIds: [x.choice.choice.id],
        },
      ],
    },
  });
  const message = copilotMessageSchema.parse({
    ...assistant,
    id: randomUUID(),
    role: "TOOL",
    text: JSON.stringify({
      kind: "COMMERCIAL_PREPARATION_PROPOSAL",
      schemaVersion: 3,
      assistantMessageId: assistant.id,
      input,
      basis: {
        preparation: null,
        creationStoreId: x.f.storeId,
        choices: [x.choice.choice],
      },
    }),
  });
  await x.a.withExclusiveTransactionAsync(async (tx) => {
    await applyCopilotRecord(tx, x.f, "copilot_message", assistant);
    await applyCopilotRecord(tx, x.f, "copilot_message", message);
  });
  return message;
}
it("creates the week's canonical draft offline from a version-3 private card and replays once after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "week-create-")),
    path = join(dir, "local.db"),
    x = await setup(path);
  let reopened: DatabaseSync | undefined;
  try {
    const m = await newWeekCard(x),
      c = await preparationController(x);
    expect((await c.open(m)).status).toBe("READY");
    const expected = (await c.open(m)).request.input.draft;
    expect((await c.confirm(m)).status).toBe("COMPLETED");
    x.db.close();
    reopened = new DatabaseSync(path);
    const a = new Adapter(reopened);
    expect(
      (await (await preparationController(x, true, a)).confirm(m)).status,
    ).toBe("COMPLETED");
    const row = reopened
        .prepare("SELECT payload_json FROM commercial_week_preparations")
        .get() as { payload_json: string },
      saved = JSON.parse(row.payload_json);
    const { commercialWeekPreparationId } =
      await import("@fl-copilot/commercial-core");
    expect(saved.id).toBe(
      await commercialWeekPreparationId(
        x.f.storeId,
        expected.weekStart,
        testChoiceDigest,
      ),
    );
    expect(saved).toMatchObject({
      ...expected,
      version: 1,
      storeId: x.f.storeId,
    });
    expect(saved.createdAt).not.toBe("2000-01-01T00:00:00.000Z");
    expect(
      reopened
        .prepare("SELECT COUNT(*) n FROM commercial_preparation_history")
        .get(),
    ).toEqual({ n: 1 });
    expect(
      reopened
        .prepare(
          "SELECT COUNT(*) n FROM sync_outbox WHERE entity_type='commercial_week_preparation'",
        )
        .get(),
    ).toEqual({ n: 1 });
    expect(
      reopened.prepare("SELECT COUNT(*) n FROM commercial_week_plans").get(),
    ).toEqual({ n: 0 });
    await expect(
      (await preparationController(x, false, a)).confirm(m),
    ).rejects.toThrow("FORBIDDEN");
  } finally {
    reopened?.close();
    try {
      x.db.close();
    } catch {
      /* already closed */
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
it("never overwrites a local pending week when the remote creation preview was based on absence", async () => {
  const x = await setup();
  try {
    const m = await newWeekCard(x),
      c = await preparationController(x);
    await x.runtime.execute(x.request, x.authority(x.request));
    expect((await c.open(m)).status).toBe("STALE");
    await expect(c.confirm(m)).rejects.toThrow("STALE");
    const row = x.db
      .prepare("SELECT payload_json FROM commercial_week_preparations")
      .get() as { payload_json: string };
    expect(JSON.parse(row.payload_json).note).toBe(x.request.input.draft.note);
    expect(
      x.db
        .prepare("SELECT COUNT(*) n FROM commercial_preparation_history")
        .get(),
    ).toEqual({ n: 1 });
  } finally {
    x.db.close();
  }
});
it("rolls back a new week on failure/cancellation and refuses creation against a changed selected choice", async () => {
  const x = await setup();
  try {
    const m = await newWeekCard(x),
      c = await preparationController(x),
      abort = new AbortController();
    abort.abort();
    await expect(c.confirm(m, abort.signal)).rejects.toThrow();
    x.a.fail = true;
    await expect(c.confirm(m)).rejects.toThrow();
    x.a.fail = false;
    expect(
      x.db.prepare("SELECT COUNT(*) n FROM commercial_week_preparations").get(),
    ).toEqual({ n: 0 });
    expect(
      x.db
        .prepare("SELECT COUNT(*) n FROM commercial_preparation_history")
        .get(),
    ).toEqual({ n: 0 });
    x.db
      .prepare("UPDATE commercial_offer_choices SET payload_json=?")
      .run(JSON.stringify({ ...x.choice.choice, version: 2 }));
    expect((await c.open(m)).status).toBe("STALE");
    await expect(c.confirm(m)).rejects.toThrow("STALE");
  } finally {
    x.db.close();
  }
});

it("saves offer selection atomically and preserves retained choices on restart replay", async () => {
  const dir = mkdtempSync(join(tmpdir(), "offer-selection-")),
    path = join(dir, "local.db"),
    x = await setup(path);
  let reopened: DatabaseSync | undefined;
  try {
    const added = await commercialChoiceFixture({ storeId: x.f.storeId });
    await applyCommercialChoice(x.a, x.f.storeId, added.choice);
    const m = await preparationCard(
      x,
      {
        weekStart: x.request.input.draft.weekStart,
        patch: {
          offerSelection: {
            addChoiceIds: [added.choice.id],
            removeChoiceIds: [x.choice.choice.id],
          },
          tgUpdates: [
            {
              placementId: x.request.input.draft.placements[0].id,
              offerIds: [added.choice.id],
            },
          ],
        },
      },
      [added.choice],
    );
    const c = await preparationController(x);
    expect((await c.open(m)).status).toBe("READY");
    x.a.fail = true;
    await expect(c.confirm(m)).rejects.toThrow();
    x.a.fail = false;
    expect(
      x.db
        .prepare("SELECT COUNT(*) n FROM commercial_preparation_history")
        .get(),
    ).toEqual({ n: 1 });
    await c.confirm(m);
    x.db.close();
    reopened = new DatabaseSync(path);
    expect(
      (
        await (
          await preparationController(x, true, new Adapter(reopened))
        ).confirm(m)
      ).status,
    ).toBe("COMPLETED");
    const row = reopened
      .prepare("SELECT payload_json FROM commercial_week_preparations")
      .get() as { payload_json: string };
    expect(JSON.parse(row.payload_json).offerRefs).toEqual([
      { choiceId: added.choice.id, choiceVersion: 1 },
    ]);
    expect(
      reopened
        .prepare("SELECT COUNT(*) n FROM commercial_preparation_history")
        .get(),
    ).toEqual({ n: 2 });
    expect(
      reopened
        .prepare(
          "SELECT COUNT(*) n FROM sync_outbox WHERE entity_type='commercial_week_preparation'",
        )
        .get(),
    ).toEqual({ n: 2 });
    expect(
      reopened.prepare("SELECT COUNT(*) n FROM commercial_offer_choices").get(),
    ).toEqual({ n: 2 });
  } finally {
    reopened?.close();
    try {
      x.db.close();
    } catch {
      /* closed */
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
