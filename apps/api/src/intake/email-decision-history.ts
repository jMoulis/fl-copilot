import { z } from "zod";
import { emailIntakeDecisionPageSchema } from "@fl-copilot/sync-contracts";
import type { DatabaseService } from "../database/types";
import { AuthError } from "../auth/service";
import {
  readableEmailDecisions,
  serializeEmailDecision,
  type EmailDecisionDocument,
} from "./email-decision-sync";
const cursorSchema = z.strictObject({
  storeId: z.uuid(),
  ownerId: z.uuid(),
  after: z.uuid(),
});
const unavailable = () =>
  new AuthError(
    403,
    "EMAIL_INTAKE_FORBIDDEN",
    "La restauration des confirmations n’est pas disponible pour ce compte.",
  );
export function createEmailDecisionHistory(database: DatabaseService) {
  return {
    async page(storeId: string, ownerId: string, cursor?: string) {
      z.uuid().parse(storeId);
      z.uuid().parse(ownerId);
      let after: string | undefined;
      if (cursor) {
        try {
          const parsed = cursorSchema.parse(
            JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
          );
          if (parsed.storeId !== storeId || parsed.ownerId !== ownerId)
            throw unavailable();
          after = parsed.after;
        } catch {
          throw unavailable();
        }
      }
      const db = await database.getDb();
      const membership = await db
        .collection("storeMemberships")
        .findOne(
          { storeId, userId: ownerId, active: true, role: "MANAGER" },
          { projection: { _id: 1 }, maxTimeMS: 2000 },
        );
      if (!membership) throw unavailable();
      const rows = await db
        .collection<EmailDecisionDocument>("emailIntakeDecisions")
        .find(
          { storeId, ownerId, ...(after ? { _id: { $gt: after } } : {}) },
          { maxTimeMS: 2000 },
        )
        .sort({ _id: 1 })
        .limit(51)
        .toArray();
      const selected = rows.slice(0, 50);
      const readable = await readableEmailDecisions(
        db,
        storeId,
        ownerId,
        selected,
      );
      // The cursor moves over selected rows even if a conversation was archived.
      // New immutable decisions committed after the base snapshot are caught by
      // its ordinary incremental cursor, including IDs inserted before this page.
      return emailIntakeDecisionPageSchema.parse({
        storeId,
        ownerId,
        cursor: cursor ?? null,
        decisions: readable.map(serializeEmailDecision),
        nextCursor:
          rows.length > 50
            ? Buffer.from(
                JSON.stringify({
                  storeId,
                  ownerId,
                  after: selected.at(-1)!._id,
                }),
              ).toString("base64url")
            : null,
      });
    },
  };
}
export type EmailDecisionHistory = ReturnType<
  typeof createEmailDecisionHistory
>;
