import type { Db } from "mongodb";
import {
  devicePushTokenRequestSchema,
  copilotCompletionNotificationSchema,
  expoPushTokenSchema,
  type CopilotCompletionNotification,
  type PushChannels,
} from "@fl-copilot/sync-contracts";
import {
  copilotConversationSchema,
  copilotMessageSchema,
  copilotMessageIsDeleted,
  type CopilotConversation,
  type CopilotMessage,
} from "@fl-copilot/domain";
import { AuthError, type AuthorizedStoreContext } from "../auth/service";

export type PushSession = {
  _id: string;
  userId: string;
  deviceId: string;
  expiresAt: Date;
  revokedAt?: Date;
  push?: { storeId: string; token: string; channels?: PushChannels };
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
                push: {
                  storeId: input.storeId,
                  token: input.pushToken,
                  ...(input.channels ? { channels: input.channels } : {}),
                },
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
    "push.channels.chat": { $ne: false },
  });
  return expoPushTokenSchema.safeParse(row?.push?.token).success
    ? row!.push!.token
    : undefined;
}
/** Short, plain excerpt of the authorized persisted answer; never another model call. */
export function chatCompletionPreview(text: string) {
  const plain = text
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/!\[[^\]]*\]\((?:[^()]|\([^()]*\))*\)/g, " ")
    .replace(/\[sources?\]\([^\s]*\)/gi, " ")
    .replace(
      /\[([^\]]+)\]\((?:[^()]|\([^()]*\))*\)/g,
      (_match, label: string) =>
        /^sources?$/i.test(label.trim()) ? " " : label,
    )
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^[ \t]*[-|: \t]{3,}$/gm, " ")
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\|/g, " ")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain)
    return "Le copilote a terminé. Ouvre ta conversation pour la consulter.";
  const characters = Array.from(plain);
  if (characters.length <= 180) return plain;
  const start = characters.slice(0, 179).join("");
  const wordEnd = start.lastIndexOf(" ");
  return (wordEnd >= 120 ? start.slice(0, wordEnd) : start).trimEnd() + "…";
}
/** Best-effort single send after commit; fixed navigation data, bounded visible excerpt. */
export async function notifyChatCompletion(
  db: Db,
  principal: AuthorizedStoreContext,
  raw: CopilotCompletionNotification,
  options: { fetch?: typeof fetch; accessToken?: string } = {},
) {
  const data = copilotCompletionNotificationSchema.parse(raw);
  if (data.ownerId !== principal.userId || data.storeId !== principal.storeId)
    return;
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
  // Resolve delivery authority after reply lookup: logout, disable or token
  // transfer during those reads must not dispatch a previously captured token.
  const membership = await db.collection("storeMemberships").findOne({
    userId: principal.userId,
    storeId: principal.storeId,
    active: true,
  });
  if (!membership) return;
  const token = await registeredChatPush(db, principal);
  if (!token) return;
  await sendDevicePush(
    db,
    principal.sessionId,
    token,
    {
      title: "Ta réponse est prête",
      body: chatCompletionPreview(m.text),
      data,
      collapseId: data.replyId,
    },
    options,
  );
}
/** Shared transport only: callers must resolve current delivery authority. */
export async function sendDevicePush(
  db: Db,
  sessionId: string,
  token: string,
  message: { title: string; body: string; data: object; collapseId: string },
  options: { fetch?: typeof fetch; accessToken?: string } = {},
) {
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
        ...message,
        sound: "default",
        ttl: 3600,
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
        { _id: sessionId, "push.token": token },
        { $unset: { push: "" } },
      );
    return;
  }
  if (result.data?.status !== "ok") throw Error("CHAT_PUSH_DELIVERY_FAILED");
}
