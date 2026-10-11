import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import {
  settingsSaveIntent,
  settingsReadResultSchema,
  storeWeekReadResultSchema,
} from "@fl-copilot/domain";
import { runLocalMigrations } from "../db/migrations";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { CopilotConversationRepository } from "./conversation-repository";
import { CopilotStoreSettingsRuntime } from "./store-settings-runtime";
import { CopilotToolRuntime } from "./tool-runtime";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import { applyStoreContext } from "../store/context-repository";
import { WeeklyContextRepository } from "../store/weekly-context-repository";
import { storeContextFixture } from "../../../../scripts/test-store-context-fixtures";
import { weeklyContextFixture } from "../../../../scripts/test-weekly-context-fixtures";
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
      text: "Configure le magasin à Asnières-sur-Seine, 92600, zone C.",
      attachments: [],
    },
    { commandId: randomUUID(), deviceId },
  );
  const request = {
    operationId: randomUUID(),
    schemaVersion: 1,
    tool: "store.settings.save",
    input: {
      expectedVersion: null as number | null,
      city: "Asnières-sur-Seine",
      postalCode: "92600",
      schoolZone: "C" as "A" | "B" | "C" | null,
      location: "CITY" as "CITY" | "KEEP",
    },
  };
  const authority = (r: unknown) => ({
    storeId: f.storeId,
    ownerId: f.ownerId,
    conversationId: f.conversation.id,
    deviceId,
    canManageStoreSettings: true,
    userMessageId: f.message.id,
    authorizedRequestJson: settingsSaveIntent(r),
    decisionLevel: "REVIEWED" as const,
  });
  const scope = {
      storeId: f.storeId,
      ownerId: f.ownerId,
      conversationId: f.conversation.id,
      canReadStore: true,
    },
    reader = new CopilotToolRuntime(a),
    runtime = new CopilotStoreSettingsRuntime(
      a,
      randomUUID,
      () => "2026-10-11T12:01:00Z",
    );
  const read = {
    operationId: randomUUID(),
    schemaVersion: 1,
    tool: "store.settings.inspect",
    input: {},
  };
  return { db, a, f, request, authority, scope, reader, runtime, read };
}
it("reads absence, saves offline and replays once after restart; unchanged settings do not create another command", async () => {
  const dir = mkdtempSync(join(tmpdir(), "copilot-settings-")),
    path = join(dir, "local.db"),
    s = await setup(path);
  let reopened: DatabaseSync | undefined;
  try {
    expect(
      settingsReadResultSchema.parse(await s.reader.execute(s.read, s.scope))
        .snapshot,
    ).toBeNull();
    const saved = await s.runtime.execute(s.request, s.authority(s.request));
    expect(saved.after.id).toBe(s.f.storeId);
    expect(saved.after.position).toBeNull();
    s.db.close();
    reopened = new DatabaseSync(path);
    const a = new Adapter(reopened),
      r = new CopilotStoreSettingsRuntime(a, randomUUID);
    expect(await r.execute(s.request, s.authority(s.request))).toEqual(saved);
    const next = {
        ...s.request,
        operationId: randomUUID(),
        input: { ...s.request.input, expectedVersion: 1 },
      },
      noop = await r.execute(next, s.authority(next));
    expect(noop.commandId).toBeNull();
    expect(noop.after).toEqual(saved.after);
    const view = settingsReadResultSchema.parse(
      await new CopilotToolRuntime(a).execute(
        { ...s.read, operationId: randomUUID() },
        s.scope,
      ),
    );
    expect(view.snapshot?.entity).toEqual(saved.after);
    expect(view.snapshot?.syncState).toBe("PENDING");
    expect(
      reopened.prepare("SELECT COUNT(*) n FROM store_context_history").get(),
    ).toEqual({ n: 1 });
    expect(
      reopened
        .prepare(
          "SELECT COUNT(*) n FROM sync_outbox WHERE command_type='STORE_CONTEXT_SETTINGS_UPSERT'",
        )
        .get(),
    ).toEqual({ n: 1 });
    await expect(
      r.execute(s.request, {
        ...s.authority(s.request),
        canManageStoreSettings: false,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  } finally {
    reopened?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("preserves a captured point, requires explicit city mode for an address change and rejects model coordinates", async () => {
  const s = await setup();
  try {
    const point = {
      ...storeContextFixture(),
      id: s.f.storeId,
      storeId: s.f.storeId,
      locationMode: "POINT" as const,
      position: {
        latitude: 48.9,
        longitude: 2.28,
        capturedAt: "2026-10-09T08:00:00Z",
        source: "DEVICE" as const,
      },
    };
    await applyStoreContext(s.a, s.f.storeId, point);
    const update = {
      ...s.request,
      input: {
        ...s.request.input,
        expectedVersion: 1,
        location: "KEEP" as const,
        schoolZone: null,
      },
    };
    const saved = await s.runtime.execute(update, s.authority(update));
    expect(saved.after.position).toEqual(point.position);
    expect(saved.after.locationMode).toBe("POINT");
    const changed = {
      ...update,
      operationId: randomUUID(),
      input: {
        ...update.input,
        expectedVersion: 2,
        city: "Paris",
        postalCode: "75017",
      },
    };
    await expect(
      s.runtime.execute(changed, s.authority(changed)),
    ).rejects.toMatchObject({ code: "STORE_LOCATION_REVIEW_REQUIRED" });
    const explicit = {
      ...changed,
      input: { ...changed.input, location: "CITY" as const },
    };
    const city = await s.runtime.execute(explicit, s.authority(explicit));
    expect(city.after.position).toBeNull();
    expect(city.after.createdAt).toBe(point.createdAt);
    await expect(
      s.runtime.execute(
        { ...explicit, input: { ...explicit.input, position: point.position } },
        s.authority(explicit),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(
      s.db
        .prepare(
          "SELECT expected_remote_version FROM sync_outbox WHERE entity_type='store_context_settings' ORDER BY local_sequence",
        )
        .all(),
    ).toEqual([{ expected_remote_version: 1 }, { expected_remote_version: 2 }]);
  } finally {
    s.db.close();
  }
});
it("does not reuse weather/calendar cache for changed settings", async () => {
  const s = await setup();
  try {
    const saved = await s.runtime.execute(s.request, s.authority(s.request));
    await new WeeklyContextRepository(s.a).save(
      weeklyContextFixture(saved.after),
      saved.after,
    );
    const read = {
      operationId: randomUUID(),
      schemaVersion: 1,
      tool: "store.week",
      input: { weekStart: "2026-10-05" },
    };
    expect(
      storeWeekReadResultSchema.parse(await s.reader.execute(read, s.scope))
        .context,
    ).not.toBeNull();
    const update = {
      ...s.request,
      operationId: randomUUID(),
      input: {
        ...s.request.input,
        expectedVersion: 1,
        city: "Paris",
        postalCode: "75017",
      },
    };
    await s.runtime.execute(update, s.authority(update));
    expect(
      storeWeekReadResultSchema.parse(
        await s.reader.execute({ ...read, operationId: randomUUID() }, s.scope),
      ).context,
    ).toBeNull();
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM weekly_context_cache").get(),
    ).toEqual({ n: 1 });
  } finally {
    s.db.close();
  }
});
it("requires reviewed current authority and rolls back errors/cancellation without resolving conflicts", async () => {
  const s = await setup();
  try {
    await expect(
      s.runtime.execute(s.request, {
        ...s.authority(s.request),
        decisionLevel: "ROUTINE",
      }),
    ).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    await expect(
      s.runtime.execute(s.request, {
        ...s.authority(s.request),
        ownerId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
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
      "store_context_settings",
      "store_context_history",
      "copilot_tool_results",
    ])
      expect(s.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get()).toEqual({
        n: 0,
      });
    await s.runtime.execute(s.request, s.authority(s.request));
    const stale = { ...s.request, operationId: randomUUID() };
    await expect(
      s.runtime.execute(stale, s.authority(stale)),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    s.db.exec("UPDATE store_context_settings SET sync_state='CONFLICT'");
    const next = {
      ...stale,
      input: { ...stale.input, expectedVersion: 1, schoolZone: null },
    };
    await expect(
      s.runtime.execute(next, s.authority(next)),
    ).rejects.toMatchObject({ code: "SYNC_CONFLICT" });
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM store_context_history").get(),
    ).toEqual({ n: 1 });
  } finally {
    s.db.close();
  }
});
it("rejects a stored payload whose embedded store differs from its scoped row", async () => {
  const s = await setup();
  try {
    const saved = await s.runtime.execute(s.request, s.authority(s.request)),
      foreign = randomUUID();
    s.db
      .prepare("UPDATE store_context_settings SET payload_json=?")
      .run(JSON.stringify({ ...saved.after, id: foreign, storeId: foreign }));
    await expect(s.reader.execute(s.read, s.scope)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const next = {
      ...s.request,
      operationId: randomUUID(),
      input: { ...s.request.input, expectedVersion: 1 },
    };
    await expect(
      s.runtime.execute(next, s.authority(next)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM store_context_history").get(),
    ).toEqual({ n: 1 });
  } finally {
    s.db.close();
  }
});
