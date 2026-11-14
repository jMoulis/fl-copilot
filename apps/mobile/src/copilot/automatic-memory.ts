import { z } from "zod";
import {
  confirmKnowledgeSuggestion,
  loadKnowledgeSuggestion,
} from "./knowledge-suggestion";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";

type Scope = { storeId: string; ownerId: string };
type Database = OutboxDatabase & AtomicMutationDatabase;
const preferenceSchema = z.object({
  enabled: z.boolean(),
  since: z.string().datetime(),
});
const key = (scope: Scope) =>
  `automatic-memory:${scope.storeId}:${scope.ownerId}`;

/** Device/account scoped opt-out. First activation never replays historical suggestions. */
export async function readAutomaticMemory(
  db: OutboxDatabase,
  scope: Scope,
  now: string,
) {
  let row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_metadata WHERE key=?",
    key(scope),
  );
  if (!row) {
    await db.runAsync(
      "INSERT OR IGNORE INTO app_metadata(key,value,updated_at) VALUES(?,?,?)",
      key(scope),
      JSON.stringify({ enabled: true, since: now }),
      now,
    );
    row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_metadata WHERE key=?",
      key(scope),
    );
  }
  return preferenceSchema.parse(JSON.parse(row!.value));
}

export async function setAutomaticMemory(
  db: OutboxDatabase,
  scope: Scope,
  enabled: boolean,
  now: string,
) {
  const preference = preferenceSchema.parse({ enabled, since: now });
  await db.runAsync(
    "INSERT OR REPLACE INTO app_metadata(key,value,updated_at) VALUES(?,?,?)",
    key(scope),
    JSON.stringify(preference),
    now,
  );
  return preference;
}

/** Reuse sourced proposals and the canonical local transaction/Outbox. No model or remote write. */
export async function captureAutomaticMemories(
  db: Database,
  scope: Scope,
  ctx: {
    deviceId: string;
    now: string;
    uuid: () => string;
    canCapture: () => boolean;
  },
) {
  if (!ctx.canCapture()) return 0;
  const preference = await readAutomaticMemory(db, scope, ctx.now);
  if (!preference.enabled || !ctx.canCapture()) return 0;
  const prefix = `${key(scope)}:handled:`;
  const candidates = await db.getAllAsync<{ id: string }>(
    `SELECT m.id FROM copilot_messages m
     WHERE m.store_id=? AND m.owner_id=? AND m.created_at>=? AND m.sync_state='SYNCED'
       AND json_extract(m.payload_json,'$.role')='TOOL'
       AND json_extract(CASE WHEN json_valid(json_extract(m.payload_json,'$.text')) THEN json_extract(m.payload_json,'$.text') ELSE '{}' END,'$.kind')='KNOWLEDGE_SUGGESTION'
       AND NOT EXISTS (SELECT 1 FROM app_metadata a WHERE a.key=? || m.id)
     ORDER BY m.created_at DESC,m.id DESC LIMIT 50`,
    scope.storeId,
    scope.ownerId,
    preference.since,
    prefix,
  );
  let created = 0;
  for (const candidate of candidates) {
    if (!ctx.canCapture()) break;
    const current = await readAutomaticMemory(db, scope, ctx.now);
    if (!current.enabled || current.since !== preference.since) break;
    try {
      const artifact = await loadKnowledgeSuggestion(db, scope, candidate.id);
      if (!ctx.canCapture()) break;
      const result = await confirmKnowledgeSuggestion(
        db,
        scope,
        candidate.id,
        artifact.content.suggestion.statement,
        {
          commandId: ctx.uuid(),
          deviceId: ctx.deviceId,
          now: ctx.now,
          captureMode: "AUTOMATIC",
          canWrite: ctx.canCapture,
        },
      );
      if (!result.alreadyApplied) created++;
      await db.runAsync(
        "INSERT OR IGNORE INTO app_metadata(key,value,updated_at) VALUES(?,?,?)",
        prefix + candidate.id,
        result.entity.id,
        ctx.now,
      );
    } catch (error) {
      // Missing sources can arrive on a later pull; never turn a partial read into authorization.
      if (!(error instanceof Error) || !error.message.startsWith("COPILOT_"))
        throw error;
      if (!ctx.canCapture()) break;
      if (/INVALID|SUPERSEDED|LIMIT/.test(error.message))
        await db.runAsync(
          "INSERT OR IGNORE INTO app_metadata(key,value,updated_at) VALUES(?,?,?)",
          prefix + candidate.id,
          "SKIPPED",
          ctx.now,
        );
    }
  }
  return created;
}
