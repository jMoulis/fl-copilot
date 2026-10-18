import {
  commercialVersionDecisionSchema,
  commercialExecutionTaskSchema,
} from "@fl-copilot/domain";
import { synchronizedCommercialVisualReadingSchema } from "@fl-copilot/sync-contracts";
import {
  commercialVersionDecisionId,
  commercialVersionDecisionSameOriginalPair,
  commercialVersionDecisionSourcesValid,
  commercialExecutionSameIdentity,
  commercialExecutionTaskId,
  commercialExecutionChecklist,
  commercialExecutionSameTarget,
} from "@fl-copilot/commercial-core";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { readCommercialExecutionPlan } from "../commercial/execution-repository";
/** Sources and declarations remain immutable inputs; canonical resolvers own writes. */
export async function readCommercialDecisionConflictPolicy(
  db: OutboxDatabase,
  kind: string,
  rawLocal: unknown,
  rawRemote: unknown,
  digest: (s: string) => Promise<string>,
) {
  const result = {
    identityValid: false,
    canKeep: false,
    canAdopt: false,
    reason: null as string | null,
    snapshots: [] as unknown[],
    documents: {} as Record<string, string>,
  };
  if (kind === "COMMERCIAL_REFERENCE") {
    const l = commercialVersionDecisionSchema.parse(rawLocal),
      parsed = commercialVersionDecisionSchema.safeParse(rawRemote);
    if (!parsed.success) return result;
    const r = parsed.data;
    result.identityValid =
      commercialVersionDecisionSameOriginalPair(l, r) &&
      l.id ===
        (await commercialVersionDecisionId(
          l.storeId,
          l.before.documentId,
          l.after.documentId,
          digest,
        ));
    const ids = [l.before.documentId, l.after.documentId];
    for (const [index, id] of ids.entries()) {
      const source = await db.getFirstAsync<{
        original_filename: string | null;
        checksum: string;
      }>(
        "SELECT original_filename,checksum FROM source_documents WHERE id=? AND store_id=? AND source_type='WEEKLY_COMMERCIAL_PDF'",
        id,
        l.storeId,
      );
      result.snapshots.push(source);
      result.documents[id] =
        `PDF ${index + 1}${source?.original_filename ? ` — ${source.original_filename}` : ""}`;
    }
    const size = await db.getFirstAsync<{ n: number; bytes: number }>(
      "SELECT COUNT(*) n,COALESCE(SUM(length(payload_json)),0) bytes FROM commercial_visual_readings WHERE store_id=? AND source_document_id IN (?,?)",
      l.storeId,
      ...ids,
    );
    const complete = !!size && size.n <= 500 && size.bytes <= 1000000;
    result.snapshots.push(size);
    if (complete) {
      const rows = await db.getAllAsync<{ payload_json: string }>(
        "SELECT payload_json FROM commercial_visual_readings WHERE store_id=? AND source_document_id IN (?,?) ORDER BY id",
        l.storeId,
        ...ids,
      );
      result.snapshots.push(rows);
      const pages = rows.map((row) =>
        synchronizedCommercialVisualReadingSchema.parse(
          JSON.parse(row.payload_json),
        ),
      );
      // The canonical resolver maps preference to the selected document, not the positional enum.
      const selected =
        l.preference === "KEEP_PREVIOUS"
          ? l.before.documentId
          : l.after.documentId;
      const resolved = {
        ...l,
        before: r.before,
        after: r.after,
        preference:
          selected === r.before.documentId
            ? ("KEEP_PREVIOUS" as const)
            : ("PREFER_NEW" as const),
      };
      result.canKeep =
        result.identityValid &&
        commercialVersionDecisionSourcesValid(l, pages) &&
        commercialVersionDecisionSourcesValid(resolved, pages);
    } else
      result.reason =
        "Les lectures PDF dépassent la limite de comparaison. Ouvrez le conflit dans Synchronisation.";
  } else {
    const l = commercialExecutionTaskSchema.parse(rawLocal),
      parsed = commercialExecutionTaskSchema.safeParse(rawRemote);
    if (!parsed.success) return result;
    const r = parsed.data;
    result.identityValid =
      commercialExecutionSameIdentity({ ...l, createdAt: r.createdAt }, r) &&
      l.id ===
        (await commercialExecutionTaskId(
          l.storeId,
          l.planRevisionId,
          l.planChecksum,
          l.kind,
          l.targetId,
          digest,
        ));
    // The canonical lookup considers current plan, exact archive and full relevant history.
    // Bound the complete set before loading it; never authorize from a truncated history.
    const queries = [
      ["commercial_plan_revisions", "id", l.planRevisionId],
      ["commercial_week_plans", "id", l.planId],
      ["commercial_plan_history", "plan_id", l.planId],
    ] as const;
    let bounded = true,
      total = 0;
    for (const [table, column, id] of queries) {
      const size = await db.getFirstAsync<{ n: number; bytes: number }>(
        `SELECT COUNT(*) n,COALESCE(SUM(length(payload_json)),0) bytes FROM ${table} WHERE store_id=? AND ${column}=?`,
        l.storeId,
        id,
      );
      result.snapshots.push(size);
      total += size?.bytes ?? 0;
      if ((size?.n ?? 0) > 500) bounded = false;
    }
    if (total > 1000000) bounded = false;
    if (bounded) {
      for (const [table, column, id] of queries)
        result.snapshots.push(
          await db.getAllAsync<{ payload_json: string }>(
            `SELECT payload_json FROM ${table} WHERE store_id=? AND ${column}=? ORDER BY payload_json`,
            l.storeId,
            id,
          ),
        );
      const plan = await readCommercialExecutionPlan(
        db,
        l.storeId,
        l.planId,
        l.planRevisionId,
        l.planChecksum,
        digest,
      );
      result.canKeep =
        result.identityValid &&
        !!plan &&
        (await commercialExecutionChecklist(plan, digest)).some((p) =>
          commercialExecutionSameTarget(l, p),
        );
    } else
      result.reason =
        "L’historique du plan dépasse la limite de comparaison. Ouvrez le conflit dans Synchronisation.";
  }
  result.canAdopt = result.identityValid;
  if (!result.canKeep && !result.reason)
    result.reason =
      kind === "COMMERCIAL_REFERENCE"
        ? "Les lectures complètes des deux PDF ne sont plus disponibles ou ont changé. Consultez les originaux avant de réexaminer votre préférence."
        : "La déclaration ne correspond plus à une copie vérifiable de sa version du plan. Elle reste conservée ; aucune tâche n’est rattachée automatiquement à un autre plan.";
  return result;
}
