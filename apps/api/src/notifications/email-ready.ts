import type { Db } from "mongodb";
import {
  emailReadyNotificationSchema,
  expoPushTokenSchema,
  isStoreEmailScope,
} from "@fl-copilot/sync-contracts";
import {
  emailIntakeAuthorized,
  type EmailIntakeReceiptRecord,
  type EmailIntakeBindingRecord,
} from "../intake/email-intake-store.js";
import { sendDevicePush, type PushSession } from "./chat-completion.js";

/** One best-effort alert per closed email envelope, after preservation commits.
 * This says nothing about subsequent analysis, admission or business publication. */
export async function notifyEmailReady(
  db: Db,
  receiptId: string,
  options: { fetch?: typeof fetch; accessToken?: string } = {},
) {
  const receipts = db.collection<
    EmailIntakeReceiptRecord & { readyNotificationClaimedAt?: Date }
  >("emailIntakeReceipts");
  const receipt = await receipts.findOne({ _id: receiptId });
  if (
    !receipt ||
    !isStoreEmailScope(receipt) ||
    receipt.readyNotificationClaimedAt ||
    ["DISMISSED", "QUARANTINED"].includes(receipt.status) ||
    !receipt.files.length ||
    receipt.files.some((file) => file.status === "PENDING")
  )
    return;
  const scope = {
    storeId: receipt.storeId,
    ownerId: receipt.ownerId,
    conversationId: receipt.conversationId,
  };
  if (!(await emailIntakeAuthorized(db, scope))) return;
  const binding = await db
    .collection<EmailIntakeBindingRecord>("emailIntakeBindings")
    .findOne({
      _id: receipt.bindingId,
      storeId: receipt.storeId,
      ownerId: receipt.ownerId,
      conversationId: receipt.storeId,
      revokedAt: null,
    });
  if (!binding) return;
  const sessionFilter = {
    userId: receipt.ownerId,
    revokedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
    "push.storeId": receipt.storeId,
    "push.channels.email": true,
  };
  const sessions = db.collection<PushSession>("deviceSessions");
  if (!(await sessions.findOne(sessionFilter))) return;
  // An atomic claim on the existing envelope prevents concurrent attachment
  // workers and explicit retries from issuing another receipt notification.
  const claim = await receipts.updateOne(
    {
      _id: receipt._id,
      version: receipt.version,
      readyNotificationClaimedAt: { $exists: false },
      status: { $nin: ["DISMISSED", "QUARANTINED"] },
    },
    { $set: { readyNotificationClaimedAt: new Date() } },
  );
  if (!claim.modifiedCount) return;
  const data = emailReadyNotificationSchema.parse({
    kind: "STORE_EMAIL_READY",
    storeId: receipt.storeId,
    ownerId: receipt.ownerId,
    receiptId,
  });
  const needsReview = receipt.files.some(
    (file) => file.status === "FAILED" || file.status === "UNSUPPORTED",
  );
  let failed = false;
  for await (const candidate of sessions.find(sessionFilter)) {
    // Resolve again immediately before dispatch, including revoke/disable/token transfer.
    if (!(await emailIntakeAuthorized(db, scope))) return;
    const liveBinding = await db
      .collection<EmailIntakeBindingRecord>("emailIntakeBindings")
      .findOne({ _id: binding._id, revokedAt: null });
    const liveReceipt = await receipts.findOne({
      _id: receiptId,
      status: { $nin: ["DISMISSED", "QUARANTINED"] },
    });
    const live = await sessions.findOne({
      ...sessionFilter,
      _id: candidate._id,
      expiresAt: { $gt: new Date() },
    });
    if (
      !liveBinding ||
      !liveReceipt ||
      liveReceipt.files.some((file) => file.status === "PENDING")
    )
      return;
    if (!live?.push || !expoPushTokenSchema.safeParse(live.push.token).success)
      continue;
    try {
      await sendDevicePush(
        db,
        live._id,
        live.push.token,
        {
          title: needsReview
            ? "Documents reçus à vérifier"
            : "Tes documents sont reçus",
          body: needsReview
            ? "Certains fichiers n’ont pas pu être conservés. Retrouve le détail dans Actions → Documents par email."
            : "Les pièces jointes sont conservées. Retrouve-les dans Actions → Documents par email pour choisir leur traitement.",
          data,
          collapseId: receiptId,
        },
        options,
      );
    } catch {
      failed = true;
    }
  }
  if (failed) throw Error("EMAIL_PUSH_DELIVERY_FAILED");
}
