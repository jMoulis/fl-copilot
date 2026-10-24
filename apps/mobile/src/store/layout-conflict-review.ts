import { z } from "zod";
import {
  storeLayoutSchema,
  storeLayoutRevisionSchema,
  type StoreLayout,
} from "@fl-copilot/domain";
import {
  ConflictRepository,
  reviewConflictVersions,
} from "../sync/conflict-repository";
import type { OutboxDatabase } from "../sync/outbox-repository";

export async function readStoreLayoutConflict(
  db: OutboxDatabase,
  storeId: string,
  conflictId: string,
  actorId: string,
  digest: (value: string) => Promise<string>,
) {
  z.uuid().parse(storeId);
  z.uuid().parse(actorId);
  const conflicts = new ConflictRepository(db),
    anchor = await conflicts.getById(conflictId);
  if (
    !anchor ||
    anchor.status !== "OPEN" ||
    anchor.entityType !== "store_layout" ||
    anchor.storeId !== storeId ||
    anchor.entityId !== storeId
  )
    throw Error("STORE_LAYOUT_RESOLUTION_INVALID");
  const row = await db.getFirstAsync<{
    id: string;
    store_id: string;
    payload_json: string;
    remote_payload_json: string | null;
    remote_version: number | null;
    sync_state: string;
    dirty: number;
  }>("SELECT * FROM store_layouts WHERE store_id=?", storeId);
  if (!row) throw Error("STORE_LAYOUT_SOURCE_CHANGED");
  const local = storeLayoutSchema.parse(JSON.parse(row.payload_json)),
    cache = row.remote_payload_json
      ? (JSON.parse(row.remote_payload_json) as unknown)
      : null,
    same = (p: StoreLayout) => p.id === storeId && p.storeId === storeId,
    group = reviewConflictVersions(
      await conflicts.listOpenForEntity(storeId, "store_layout", storeId),
      (raw) => {
        const p = storeLayoutSchema.safeParse(raw);
        return p.success ? p.data : null;
      },
      same,
      cache,
    ),
    remote = group.remote;
  let valid =
    group.valid &&
    !!remote &&
    same(local) &&
    row.id === storeId &&
    row.store_id === storeId &&
    (!row.dirty || local.updatedBy === actorId) &&
    ["CONFLICT", "ERROR"].includes(row.sync_state) &&
    (row.remote_version ?? 0) <= (remote?.version ?? 0);
  const remotePlans = new Map<string, StoreLayout>(),
    plans = new Map<string, StoreLayout>();
  function remember(p: StoreLayout, canonical: boolean) {
    const known = plans.get(p.revisionId);
    if (!same(p) || (known && JSON.stringify(known) !== JSON.stringify(p)))
      valid = false;
    plans.set(p.revisionId, p);
    if (canonical) remotePlans.set(p.revisionId, p);
  }
  remember(local, false);
  if (cache !== null) remember(storeLayoutSchema.parse(cache), true);
  for (const c of group.conflicts) {
    const before = storeLayoutSchema.safeParse(c.localPayload),
      after = storeLayoutSchema.safeParse(c.remotePayload);
    if (!before.success || before.data.updatedBy !== actorId || !after.success)
      valid = false;
    if (before.success) remember(before.data, false);
    if (after.success) remember(after.data, true);
  }
  if (remote) remember(remote, true);
  const ordered = [...remotePlans.values()].sort(
    (a, b) => a.version - b.version,
  );
  for (let i = 0; i < ordered.length; i++) {
    const p = ordered[i]!,
      previous = ordered[i - 1];
    if (
      p.createdAt !== remote?.createdAt ||
      (previous &&
        p.version === previous.version + 1 &&
        p.parentRevisionId !== previous.revisionId)
    )
      valid = false;
  }
  const commands = await db.getAllAsync<{
    command_id: string;
    device_id: string;
    store_id: string;
    entity_id: string;
    command_type: string;
    payload_json: string;
    status: string;
    expected_remote_version: number | null;
  }>(
    "SELECT * FROM sync_outbox WHERE store_id=? AND entity_type='store_layout' AND status IN ('PENDING','SYNCING','CONFLICT','FAILED') AND COALESCE(last_error_code,'')<>'STORE_LAYOUT_SUPERSEDED' ORDER BY command_id LIMIT 101",
    storeId,
  );
  let syncing = false;
  if (commands.length > 100) valid = false;
  for (const c of commands) {
    syncing ||= c.status === "SYNCING";
    const p = storeLayoutSchema.safeParse(JSON.parse(c.payload_json));
    if (
      !p.success ||
      c.entity_id !== storeId ||
      c.store_id !== storeId ||
      c.command_type !== "STORE_LAYOUT_UPSERT" ||
      p.data.updatedBy !== actorId
    )
      valid = false;
    if (p.success) remember(p.data, false);
  }
  const ids = [...plans.keys()],
    history = ids.length
      ? await db.getAllAsync<{
          id: string;
          store_id: string;
          payload_json: string;
          synced: number;
        }>(
          `SELECT id,store_id,payload_json,synced FROM store_layout_revisions WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY id`,
          ...ids,
        )
      : [];
  for (const h of history) {
    const p = storeLayoutRevisionSchema.safeParse(JSON.parse(h.payload_json));
    if (
      !p.success ||
      h.store_id !== storeId ||
      p.data.storeId !== storeId ||
      JSON.stringify(p.data.plan) !== JSON.stringify(plans.get(h.id))
    )
      valid = false;
  }
  const hash = await digest(
    JSON.stringify({ actorId, anchor, row, group, commands, history }),
  );
  return {
    anchor,
    local,
    remote,
    group,
    commands,
    plans: [...plans.values()],
    hash,
    canResolve: valid && !syncing,
    reason: syncing
      ? "Un envoi du plan est en cours. Attendez sa fin, puis relisez les versions."
      : valid
        ? null
        : (group.reason ??
          "Les versions ou leur historique sont incomplets ou contradictoires. Les plans restent conservés."),
  };
}
