import { createHash } from "node:crypto";
import type { Resend } from "resend";
import { z } from "zod";

const receivedEventSchema = z.object({
  type: z.literal("email.received"),
  created_at: z.iso.datetime({ offset: true }),
  data: z.object({
    email_id: z.uuid(),
    from: z.string().min(1).max(998),
    to: z.array(z.string().min(1).max(998)).max(100),
    bcc: z.array(z.string().min(1).max(998)).max(100).default([]),
    received_for: z.array(z.string().min(1).max(998)).max(100).default([]),
    message_id: z.string().min(1).max(998),
    subject: z.string().max(998),
    attachments: z
      .array(
        z.object({
          id: z.uuid(),
          filename: z.string().max(1024).nullable(),
          content_type: z.string().min(1).max(120),
          content_disposition: z.string().max(120).nullable().optional(),
          content_id: z.string().max(998).nullable().optional(),
        }),
      )
      .max(50),
  }),
});
const header = z.string().min(1).max(2048);
const invalid = () => Error("INBOUND_WEBHOOK_INVALID");

/** Exact raw-body verification only. No message fetch, attachment download or AI here. */
export function verifyResendReceivedEvent(
  client: Pick<Resend, "webhooks">,
  input: {
    body: string;
    headers: Record<string, string | string[] | undefined>;
    secret: string;
  },
) {
  if (
    Buffer.byteLength(input.body, "utf8") > 128 * 1024 ||
    input.body.includes("\uFFFD") ||
    !input.secret.startsWith("whsec_")
  )
    throw invalid();
  let verified: unknown;
  let eventId: string;
  try {
    eventId = header.parse(input.headers["svix-id"]);
    verified = client.webhooks.verify({
      payload: input.body,
      headers: {
        id: eventId,
        timestamp: header.parse(input.headers["svix-timestamp"]),
        signature: header.parse(input.headers["svix-signature"]),
      },
      webhookSecret: input.secret,
    });
  } catch {
    throw invalid();
  }
  const envelope = z
    .object({ type: z.string().min(1).max(100) })
    .safeParse(verified);
  if (!envelope.success) throw invalid();
  if (envelope.data.type !== "email.received") return null;
  const parsed = receivedEventSchema.safeParse(verified);
  if (!parsed.success) throw invalid();
  if (
    new Set(parsed.data.data.attachments.map((a) => a.id)).size !==
    parsed.data.data.attachments.length
  )
    throw invalid();
  return {
    eventId,
    payloadHash: `sha256:${createHash("sha256").update(input.body).digest("hex")}`,
    event: parsed.data,
  };
}

/** A declared mailbox is a routing hint, never proof of sender identity/permission. */
export function declaredMailbox(value: string): string | null {
  if (/[\r\n\0]/.test(value)) return null;
  const match = /^(?:[^<>]*<([^<>]+)>|([^<>]+))$/.exec(value.trim());
  const email = z
    .email()
    .max(320)
    .safeParse((match?.[1] ?? match?.[2] ?? "").trim());
  return email.success ? email.data.toLowerCase() : null;
}

/** Reject ambiguous routing instead of copying one message into multiple stores/chats. */
export function chooseInboundBinding<
  T extends { recipient: string; allowedSender: string },
>(
  event: NonNullable<ReturnType<typeof verifyResendReceivedEvent>>["event"],
  bindings: readonly T[],
): T | null {
  const sender = declaredMailbox(event.data.from);
  const recipients = new Set(
    [...event.data.to, ...event.data.bcc, ...event.data.received_for]
      .map(declaredMailbox)
      .filter((r): r is string => r !== null),
  );
  const routed = bindings.filter((binding) =>
    recipients.has(binding.recipient),
  );
  if (routed.length !== 1 || sender !== routed[0]!.allowedSender) return null;
  return routed[0]!;
}
