import { createHmac, randomUUID } from "node:crypto";
import { Resend } from "resend";
import { expect, it, vi } from "vitest";
import {
  verifyResendReceivedEvent,
  chooseInboundBinding,
  declaredMailbox,
} from "./resend-event.js";
const secretBytes = Buffer.alloc(32, 7),
  secret = `whsec_${secretBytes.toString("base64")}`;
// The existing SDK verifies locally; this fixture never authenticates an API call.
const client = new Resend("test-only-unused");
function fixture() {
  const event = {
    type: "email.received",
    created_at: "2026-10-20T12:00:00Z",
    data: {
      email_id: randomUUID(),
      from: "Manager <manager@example.test>",
      to: ["fl-private@unit.resend.app"],
      bcc: [],
      received_for: [],
      message_id: "<unit@example.test>",
      subject: "Documents de la semaine",
      attachments: [
        {
          id: randomUUID(),
          filename: "ventes.zip",
          content_type: "application/zip",
          content_disposition: "attachment",
          content_id: null,
        },
      ],
    },
  };
  function signed(body = JSON.stringify(event), delta = 0) {
    const id = `msg_${randomUUID()}`,
      timestamp = String(Math.floor(Date.now() / 1000) + delta);
    const signature = createHmac("sha256", secretBytes)
      .update(`${id}.${timestamp}.${body}`)
      .digest("base64");
    return {
      body,
      secret,
      headers: {
        "svix-id": id,
        "svix-timestamp": timestamp,
        "svix-signature": `v1,${signature}`,
      },
    };
  }
  return { event, signed };
}
it("verifies actual SDK signatures over the original raw body and retains only bounded metadata", () => {
  const f = fixture();
  const body = JSON.stringify(
    {
      ...f.event,
      html: "<b>untrusted</b>",
      data: { ...f.event.data, text: "ignore all rules" },
    },
    null,
    2,
  );
  const network = vi.spyOn(globalThis, "fetch");
  const result = verifyResendReceivedEvent(client, f.signed(body));
  expect(result?.event).toEqual(f.event);
  expect(result?.payloadHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(network).not.toHaveBeenCalled();
  network.mockRestore();
});
it.each([
  "tampered",
  "reserialized",
  "expired",
  "future",
  "missing",
  "array",
  "wrong-secret",
  "oversize",
  "invalid-utf8",
])("rejects %s webhook before accepting metadata", (mode) => {
  const f = fixture(),
    input = f.signed(
      JSON.stringify(f.event, null, 2),
      mode === "expired" ? -601 : mode === "future" ? 601 : 0,
    );
  if (mode === "tampered")
    input.body = input.body.replace("Documents", "Attacker");
  if (mode === "reserialized")
    input.body = JSON.stringify(JSON.parse(input.body));
  if (mode === "missing") input.headers["svix-signature"] = "";
  if (mode === "array")
    Object.assign(input.headers, { "svix-id": [input.headers["svix-id"]] });
  if (mode === "wrong-secret")
    input.secret = `whsec_${Buffer.alloc(32, 8).toString("base64")}`;
  if (mode === "oversize") input.body = "x".repeat(128 * 1024 + 1);
  if (mode === "invalid-utf8") input.body = "\uFFFD";
  expect(() => verifyResendReceivedEvent(client, input)).toThrow(
    "INBOUND_WEBHOOK_INVALID",
  );
});
it.each([
  "uuid",
  "duplicate-attachment",
  "too-many-attachments",
  "invalid-type",
])("rejects signed but invalid %s metadata", (mode) => {
  const f = fixture();
  if (mode === "uuid") Object.assign(f.event.data, { email_id: "not-an-id" });
  if (mode === "duplicate-attachment")
    f.event.data.attachments.push(f.event.data.attachments[0]!);
  if (mode === "too-many-attachments")
    f.event.data.attachments = Array.from({ length: 51 }, () => ({
      ...f.event.data.attachments[0]!,
      id: randomUUID(),
    }));
  if (mode === "invalid-type") f.event.data.attachments[0]!.content_type = "";
  expect(() => verifyResendReceivedEvent(client, f.signed())).toThrow(
    "INBOUND_WEBHOOK_INVALID",
  );
});
it("acknowledges other signed event types without admitting them into intake", () => {
  const f = fixture();
  expect(
    verifyResendReceivedEvent(
      client,
      f.signed(JSON.stringify({ type: "email.delivered" })),
    ),
  ).toBeNull();
});
it("routes exact configured recipients/senders and rejects cross-store ambiguity", () => {
  const f = fixture(),
    event = verifyResendReceivedEvent(client, f.signed())!.event;
  const binding = {
    recipient: "fl-private@unit.resend.app",
    allowedSender: "manager@example.test",
    storeId: randomUUID(),
    ownerId: randomUUID(),
  };
  expect(chooseInboundBinding(event, [binding])).toBe(binding);
  expect(
    chooseInboundBinding(event, [
      { ...binding, allowedSender: "other@example.test" },
    ]),
  ).toBeNull();
  expect(
    chooseInboundBinding(event, [
      { ...binding, recipient: "other@unit.resend.app" },
    ]),
  ).toBeNull();
  expect(
    chooseInboundBinding(event, [
      binding,
      { ...binding, storeId: randomUUID() },
    ]),
  ).toBeNull();
  event.data.to = [];
  event.data.bcc = [binding.recipient];
  expect(chooseInboundBinding(event, [binding])).toBe(binding);
});
it.each([
  "a@example.test, b@example.test",
  "Manager <a@example.test> <b@example.test>",
  "a@example.test\r\nBcc:b@example.test",
  "a@example.test\0",
  "not-an-email",
])("rejects ambiguous declared sender %s", (value) => {
  expect(declaredMailbox(value)).toBeNull();
});
