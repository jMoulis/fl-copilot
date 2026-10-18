import type { SyncConflict } from "./conflict-repository";
/** Private Copilot payloads must never cross an account change on a shared phone. */
export function canDisplayConflict(
  c: SyncConflict,
  storeId: string | undefined,
  ownerId: string | undefined,
) {
  if (!storeId || c.storeId !== storeId) return false;
  if (
    ![
      "copilot_conversation",
      "copilot_message",
      "copilot_knowledge",
      "copilot_decision",
      "copilot_execution_link",
    ].includes(c.entityType)
  )
    return true;
  if (!ownerId) return false;
  const payloads = [c.localPayload, c.remotePayload].filter(
    (v) => v !== null && v !== undefined,
  );
  return (
    payloads.length > 0 &&
    payloads.every(
      (v) =>
        typeof v === "object" &&
        v !== null &&
        "ownerId" in v &&
        "storeId" in v &&
        v.ownerId === ownerId &&
        v.storeId === storeId,
    )
  );
}
