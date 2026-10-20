import { z } from "zod";
import { sourceOriginalHash } from "../documents/source-original-hash";
/** Stable across devices/restarts, and disjoint from another admitted attachment. */
export function emailProcessingIdentity(
  scope: { storeId: string; ownerId: string; conversationId: string },
  origin: {
    receiptId: string;
    fileId: string;
    actionId: string;
    processingId: string;
  },
  target: "BATCH" | "ARCHIVE" | "ITEM" | "MESSAGE" | "COMMAND",
) {
  const values = [
    scope.storeId,
    scope.ownerId,
    scope.conversationId,
    origin.receiptId,
    origin.fileId,
    origin.actionId,
    origin.processingId,
  ];
  values.forEach((id) => z.uuid().parse(id));
  const h = sourceOriginalHash(
    JSON.stringify(["email-mercalys-v1", ...values, target]),
  ).slice(7);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
