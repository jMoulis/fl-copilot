import type { OutboxDatabase } from "../sync/outbox-repository";
import {
  commercialPlanRevisionSchema,
  commercialWeekPlanSchema,
} from "@fl-copilot/sync-contracts";
import { commercialExecutionPlanChecksum } from "@fl-copilot/commercial-core";
export async function readCommercialExecutionPlan(
  db: OutboxDatabase,
  storeId: string,
  planId: string,
  revisionId: string,
  checksum: string,
  digest: (s: string) => Promise<string>,
) {
  const [archive, current, history] = await Promise.all([
    db.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM commercial_plan_revisions WHERE store_id=? AND id=?",
      storeId,
      revisionId,
    ),
    db.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM commercial_week_plans WHERE store_id=? AND id=?",
      storeId,
      planId,
    ),
    db.getAllAsync<{ payload_json: string }>(
      "SELECT payload_json FROM commercial_plan_history WHERE store_id=? AND plan_id=? ORDER BY created_at DESC",
      storeId,
      planId,
    ),
  ]);
  const candidates = [
    ...(archive
      ? [
          commercialPlanRevisionSchema.parse(JSON.parse(archive.payload_json))
            .plan,
        ]
      : []),
    ...[current, ...history]
      .filter(Boolean)
      .map((row) =>
        commercialWeekPlanSchema.parse(JSON.parse(row!.payload_json)),
      ),
  ];
  for (const plan of candidates)
    if (
      plan.id === planId &&
      plan.storeId === storeId &&
      plan.revisionId === revisionId &&
      (await commercialExecutionPlanChecksum(plan, digest)) === checksum
    )
      return plan;
  return null;
}
