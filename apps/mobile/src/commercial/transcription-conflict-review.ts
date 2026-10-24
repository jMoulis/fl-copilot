import { z } from "zod";
import {
  commercialReviewDecisionSchema,
  commercialReviewPageSchema,
  synchronizedCommercialReviewDecisionSchema,
  type CommercialReviewDecision,
} from "@fl-copilot/sync-contracts";
import { ConflictRepository } from "../sync/conflict-repository";
import type { OutboxDatabase } from "../sync/outbox-repository";

export type TranscriptionLifetime = {
  canResolve: () => boolean;
  signal?: AbortSignal;
};
export function assertTranscriptionCurrent(lifetime?: TranscriptionLifetime) {
  if (
    lifetime &&
    (lifetime.signal?.aborted ||
      typeof lifetime.canResolve !== "function" ||
      !lifetime.canResolve())
  )
    throw Error("COMMERCIAL_REVIEW_AUTHORITY_CHANGED");
}
export async function readTranscriptionConflict(
  db: OutboxDatabase,
  storeId: string,
  localId: string,
  actorId: string,
  digest: (value: string) => Promise<string>,
) {
  z.uuid().parse(storeId);
  z.uuid().parse(localId);
  z.uuid().parse(actorId);
  const row = await db.getFirstAsync<{
    id: string;
    store_id: string;
    page_id: string;
    source_block_index: number;
    payload_json: string;
    remote_version: number | null;
    sync_state: string;
  }>(
    "SELECT * FROM commercial_review_decisions WHERE id=? AND store_id=?",
    localId,
    storeId,
  );
  if (!row) throw Error("COMMERCIAL_REVIEW_RESOLUTION_INVALID");
  const local = commercialReviewDecisionSchema.parse(
    JSON.parse(row.payload_json),
  );
  if (
    local.id !== localId ||
    local.storeId !== storeId ||
    row.id !== localId ||
    row.store_id !== storeId
  )
    throw Error("COMMERCIAL_REVIEW_RESOLUTION_INVALID");
  const group = await new ConflictRepository(db).listOpenForEntity(
      storeId,
      "commercial_review_decision",
      localId,
    ),
    pageRow = await db.getFirstAsync<{
      payload_json: string;
      store_id: string;
    }>(
      "SELECT * FROM commercial_review_pages WHERE id=? AND store_id=?",
      local.pageId,
      storeId,
    ),
    page = pageRow
      ? commercialReviewPageSchema.parse(JSON.parse(pageRow.payload_json))
      : null;
  const sameOccurrence = (d: CommercialReviewDecision) =>
    d.storeId === storeId &&
    d.pageId === local.pageId &&
    d.sourceDocumentId === local.sourceDocumentId &&
    d.sourceBlockIndex === local.sourceBlockIndex &&
    d.checksum === local.checksum;
  const sourceValid = (d: CommercialReviewDecision) => {
    const block = page?.blocks.find(
      (b) => b.sourceBlockIndex === d.sourceBlockIndex,
    );
    return (
      !!page &&
      page.id === d.pageId &&
      page.storeId === storeId &&
      page.sourceDocumentId === d.sourceDocumentId &&
      page.checksum === d.checksum &&
      !!block &&
      d.corrections.every(
        (c) => block.fields.filter((f) => f.name === c.name).length === 1,
      )
    );
  };
  let valid =
    local.id === localId &&
    row.id === localId &&
    row.store_id === storeId &&
    row.page_id === local.pageId &&
    row.source_block_index === local.sourceBlockIndex &&
    ["PENDING", "CONFLICT", "ERROR"].includes(row.sync_state) &&
    row.remote_version === null &&
    sourceValid(local) &&
    group.length > 0 &&
    group.length <= 100;
  let envelope: ReturnType<
    typeof synchronizedCommercialReviewDecisionSchema.parse
  > | null = null;
  for (const c of group) {
    const before = commercialReviewDecisionSchema.safeParse(c.localPayload),
      after = synchronizedCommercialReviewDecisionSchema.safeParse(
        c.remotePayload,
      );
    if (
      !before.success ||
      JSON.stringify(before.data) !== JSON.stringify(local) ||
      !after.success ||
      c.remoteVersion !== 1 ||
      c.localExpectedVersion !== null ||
      !c.commandId ||
      c.commandId !== c.id ||
      c.entityId !== localId
    ) {
      valid = false;
      continue;
    }
    const candidate = after.data;
    if (
      !sameOccurrence(candidate.decision) ||
      !sourceValid(candidate.decision) ||
      candidate.id === localId
    ) {
      valid = false;
      continue;
    }
    if (envelope && JSON.stringify(envelope) !== JSON.stringify(candidate))
      valid = false;
    if (!envelope) envelope = candidate;
  }
  const remoteRow = envelope
    ? await db.getFirstAsync<{
        id: string;
        store_id: string;
        page_id: string;
        source_block_index: number;
        payload_json: string;
        remote_version: number | null;
        sync_state: string;
      }>(
        "SELECT * FROM commercial_review_decisions WHERE id=? AND store_id=?",
        envelope.id,
        storeId,
      )
    : null;
  const parsedRemote = remoteRow
    ? commercialReviewDecisionSchema.parse(JSON.parse(remoteRow.payload_json))
    : null;
  const remote =
    parsedRemote &&
    parsedRemote.id === envelope?.id &&
    sameOccurrence(parsedRemote) &&
    sourceValid(parsedRemote)
      ? parsedRemote
      : null;
  if (
    !remote ||
    !envelope ||
    remoteRow?.sync_state !== "SYNCED" ||
    remoteRow.remote_version !== 1 ||
    remoteRow.id !== envelope.id ||
    remoteRow.page_id !== local.pageId ||
    remoteRow.source_block_index !== local.sourceBlockIndex ||
    JSON.stringify(remote) !== JSON.stringify(envelope.decision)
  )
    valid = false;
  const commands = await db.getAllAsync<{
    command_id: string;
    device_id: string;
    command_type: string;
    entity_id: string;
    payload_json: string;
    status: string;
    expected_remote_version: number | null;
  }>(
    "SELECT * FROM sync_outbox WHERE store_id=? AND entity_type='commercial_review_decision' AND entity_id=? AND status IN ('PENDING','SYNCING','CONFLICT','FAILED') AND COALESCE(last_error_code,'')<>'COMMERCIAL_REVIEW_SUPERSEDED' ORDER BY command_id LIMIT 101",
    storeId,
    localId,
  );
  let syncing = false;
  if (commands.length > 100 || !commands.length) valid = false;
  for (const c of commands) {
    syncing ||= c.status === "SYNCING";
    const payload = commercialReviewDecisionSchema.safeParse(
      JSON.parse(c.payload_json),
    );
    if (
      !payload.success ||
      JSON.stringify(payload.data) !== JSON.stringify(local) ||
      c.entity_id !== localId ||
      c.command_type !== "COMMERCIAL_TRANSCRIPTION_REVIEW" ||
      c.expected_remote_version !== null
    )
      valid = false;
  }
  if (
    group.some(
      (c) =>
        !commands.some(
          (command) =>
            command.command_id === c.commandId && command.status === "CONFLICT",
        ),
    )
  )
    valid = false;
  const hash = await digest(
    JSON.stringify({
      actorId,
      storeId,
      localId,
      row,
      pageRow,
      group,
      remoteRow,
      commands,
    }),
  );
  return {
    local,
    remote,
    page,
    group,
    commands,
    hash,
    canResolve: valid && !syncing,
    reason: syncing
      ? "Un envoi de cette transcription est en cours. Attendez sa fin, puis relisez les choix."
      : valid
        ? null
        : "Les choix ou leur extrait source sont incomplets ou contradictoires. Les deux intentions restent conservées.",
  };
}
