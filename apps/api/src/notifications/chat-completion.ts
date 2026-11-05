import type { Db } from "mongodb";
import {
  devicePushTokenRequestSchema,
  copilotCompletionNotificationSchema,
  expoPushTokenSchema,
  type CopilotCompletionNotification,
} from "@fl-copilot/sync-contracts";
import {
  copilotConversationSchema,
  copilotMessageSchema,
  copilotMessageIsDeleted,
  type CopilotConversation,
  type CopilotMessage,
} from "@fl-copilot/domain";
import { AuthError, type AuthorizedStoreContext } from "../auth/service";

type PushSession = {
  _id: string;
  userId: string;
  deviceId: string;
  expiresAt: Date;
  revokedAt?: Date;
  push?: { storeId: string; token: string };
};
/** Credentials belong to the current authenticated session; logout/re-login retires them. */
export async function updateDevicePushToken(
  db: Db,
  principal: AuthorizedStoreContext,
  deviceId: string,
  raw: unknown,
) {
  const input = devicePushTokenRequestSchema.parse(raw);
  if (principal.deviceId !== deviceId || principal.storeId !== input.storeId)
    throw new AuthError(
      403,
      "DEVICE_ACCESS_INVALID",
      "Ce téléphone ne correspond pas à la session.",
    );
  const tx = db.client.startSession();
  try {
    await tx.withTransaction(async () => {
      const sessions = db.collection<PushSession>("deviceSessions");
      if (input.pushToken)
        await sessions.updateMany(
          { "push.token": input.pushToken, _id: { $ne: principal.sessionId } },
          { $unset: { push: "" } },
          { session: tx },
        );
      const saved = await sessions.updateOne(
        {
          _id: principal.sessionId,
          userId: principal.userId,
          deviceId,
          revokedAt: { $exists: false },
          expiresAt: { $gt: new Date() },
        },
        input.pushToken
          ? {
              $set: {
                push: { storeId: input.storeId, token: input.pushToken },
              },
            }
          : { $unset: { push: "" } },
        { session: tx },
      );
      if (saved.matchedCount !== 1)
        throw new AuthError(
          401,
          "AUTH_SESSION_EXPIRED",
          "Reconnecte-toi pour activer les notifications.",
        );
    });
  } catch (error) {
    if (error instanceof AuthError) throw error;
    // Mongo duplicate-key messages can include the push token: never forward them.
    throw new AuthError(
      409,
      "PUSH_REGISTRATION_CHANGED",
      "L’enregistrement des alertes a changé. Réessaie la vérification.",
      true,
    );
  } finally {
    await tx.endSession();
  }
  return { enabled: input.pushToken !== null };
}
export async function registeredChatPush(
  db: Db,
  principal: AuthorizedStoreContext,
) {
  const row = await db.collection<PushSession>("deviceSessions").findOne({
    _id: principal.sessionId,
    userId: principal.userId,
    deviceId: principal.deviceId,
    revokedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
    "push.storeId": principal.storeId,
  });
  return expoPushTokenSchema.safeParse(row?.push?.token).success
    ? row!.push!.token
    : undefined;
}
/** Best-effort single send, after commit only. No content, model calls, retry loop or external URL in payload. */
export async function notifyChatCompletion(
  db: Db,
  principal: AuthorizedStoreContext,
  raw: CopilotCompletionNotification,
  options: { fetch?: typeof fetch; accessToken?: string } = {},
) {
  const data = copilotCompletionNotificationSchema.parse(raw);
  if (data.ownerId !== principal.userId || data.storeId !== principal.storeId)
    return;
  const token = await registeredChatPush(db, principal);
  if (!token) return;
  const membership = await db.collection("storeMemberships").findOne({
    userId: principal.userId,
    storeId: principal.storeId,
    active: true,
  });
  if (!membership) return;
  const scope = { storeId: principal.storeId, ownerId: principal.userId };
  const conversation = await db
    .collection<CopilotConversation & { _id: string }>("copilotConversations")
    .findOne({ _id: data.conversationId, ...scope });
  const message = await db
    .collection<CopilotMessage & { _id: string }>("copilotMessages")
    .findOne({
      _id: data.replyId,
      conversationId: data.conversationId,
      ...scope,
    });
  if (!conversation || !message) return;
  const { _id: conversationKey, ...conversationData } = conversation,
    { _id: messageKey, ...messageData } = message;
  void conversationKey;
  void messageKey;
  const c = copilotConversationSchema.parse(conversationData),
    m = copilotMessageSchema.parse(messageData);
  if (
    c.status !== "ACTIVE" ||
    m.role !== "ASSISTANT" ||
    copilotMessageIsDeleted(m, c)
  )
    return;
  const response = await (options.fetch ?? fetch)(
    "https://exp.host/--/api/v2/push/send",
    {
      method: "POST",
      signal: AbortSignal.timeout(5000),
      headers: {
        "content-type": "application/json",
        ...(options.accessToken
          ? { authorization: `Bearer ${options.accessToken}` }
          : {}),
      },
      body: JSON.stringify({
        to: token,
        title: "Ta réponse est prête",
        body: "Le copilote a terminé. Ouvre ta conversation pour la consulter.",
        data,
        sound: "default",
        ttl: 3600,
        collapseId: data.replyId,
      }),
    },
  );
  if (!response.ok) throw Error("CHAT_PUSH_DELIVERY_FAILED");
  const result = (await response.json()) as {
    data?: { status?: string; details?: { error?: string } };
  };
  if (result.data?.details?.error === "DeviceNotRegistered") {
    await db
      .collection<PushSession>("deviceSessions")
      .updateOne(
        { _id: principal.sessionId, "push.token": token },
        { $unset: { push: "" } },
      );
    return;
  }
  if (result.data?.status !== "ok") throw Error("CHAT_PUSH_DELIVERY_FAILED");
}
