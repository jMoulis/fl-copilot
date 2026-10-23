import { z } from "zod";
import { currentCommercialWeek } from "@fl-copilot/commercial-core";
import {
  copilotBusinessDateSchema,
  commercialExecutionTaskSchema,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { tradingToday } from "../dates/calendar";

export const copilotActivityFilterSchema = z.enum([
  "ALL",
  "DECISION",
  "EXECUTION",
]);
export const actionsViewSchema = z.strictObject({
  schemaVersion: z.literal(1),
  weekStart: copilotBusinessDateSchema.refine(
    (date) =>
      currentCommercialWeek(new Date(`${date}T12:00:00Z`)).start === date,
    "An Actions week must start on an ISO Monday.",
  ),
  filter: z.union([
    z.literal("ALL"),
    commercialExecutionTaskSchema.shape.status,
  ]),
  copilotFilter: copilotActivityFilterSchema.optional(),
});
export type ActionsView = z.infer<typeof actionsViewSchema>;
export function initialActionsView(date = tradingToday()): ActionsView {
  return {
    schemaVersion: 1,
    weekStart: currentCommercialWeek(new Date(`${date}T12:00:00Z`)).start,
    filter: "TODO",
  };
}
/** User/store-private presentation only, in the existing local metadata table. */
export class ActionsViewRepository {
  private readonly key: string;
  constructor(
    private readonly db: OutboxDatabase,
    scope: { storeId: string; ownerId: string },
  ) {
    z.uuid().parse(scope.storeId);
    z.uuid().parse(scope.ownerId);
    this.key = `actions-view:v1:${scope.storeId}:${scope.ownerId}`;
  }
  async read() {
    const row = await this.db.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_metadata WHERE key=?",
      this.key,
    );
    return row ? actionsViewSchema.parse(JSON.parse(row.value)) : null;
  }
  async save(raw: ActionsView) {
    const view = actionsViewSchema.parse(raw);
    await this.db.runAsync(
      "INSERT INTO app_metadata(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
      this.key,
      JSON.stringify(view),
      new Date().toISOString(),
    );
  }
}
