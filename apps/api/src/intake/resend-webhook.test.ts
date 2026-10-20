import { createHmac, randomUUID } from "node:crypto";
import Fastify from "fastify";
import { Resend } from "resend";
import { expect, it, vi } from "vitest";
import { registerResendIntakeWebhook } from "./resend-webhook.js";
const bytes = Buffer.alloc(32, 11),
  secret = `whsec_${bytes.toString("base64")}`;
async function fixture() {
  const app = Fastify({ logger: false }),
    admit = vi.fn().mockResolvedValue(undefined);
  await registerResendIntakeWebhook(app, {
    client: new Resend("test-only-unused"),
    secret,
    admit,
  });
  app.post("/ordinary-json", async (request) => ({
    parsed: typeof request.body,
    value: request.body,
  }));
  const event = {
    type: "email.received",
    created_at: new Date().toISOString(),
    data: {
      email_id: randomUUID(),
      from: "unit@example.test",
      to: ["unit@dev.resend.app"],
      bcc: [],
      received_for: [],
      message_id: "unit@example.test",
      subject: "Été — semaine",
      attachments: [],
    },
  };
  function signed(body = JSON.stringify(event, null, 2)) {
    const id = `msg_${randomUUID()}`,
      timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", bytes)
      .update(`${id}.${timestamp}.${body}`)
      .digest("base64");
    return {
      method: "POST" as const,
      url: "/api/v1/intake/resend",
      payload: body,
      headers: {
        "content-type": "application/json",
        "svix-id": id,
        "svix-timestamp": timestamp,
        "svix-signature": `v1,${signature}`,
      },
    };
  }
  return { app, admit, event, signed };
}
it("admits the signed raw payload before acknowledgement without changing ordinary API JSON parsing", async () => {
  const f = await fixture();
  try {
    const result = await f.app.inject(f.signed());
    expect(result.statusCode).toBe(200);
    expect(f.admit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ event: f.event }),
    );
    const ordinary = await f.app.inject({
      method: "POST",
      url: "/ordinary-json",
      payload: { hello: "world" },
    });
    expect(ordinary.json()).toEqual({
      parsed: "object",
      value: { hello: "world" },
    });
  } finally {
    await f.app.close();
  }
});
it("rejects missing signatures and never exposes internal credentials or error details", async () => {
  const f = await fixture();
  try {
    const input = f.signed();
    input.headers["svix-signature"] = "invalid";
    const result = await f.app.inject(input);
    expect(result.statusCode).toBe(400);
    expect(result.json()).toEqual({ error: "INBOUND_WEBHOOK_INVALID" });
    expect(f.admit).not.toHaveBeenCalled();
    expect(result.body).not.toContain(secret);
  } finally {
    await f.app.close();
  }
});
it("does not acknowledge a transient durable admission failure", async () => {
  const f = await fixture();
  try {
    f.admit.mockRejectedValue(Error("PRIVATE_DATABASE_CONNECTION_DETAIL"));
    const result = await f.app.inject(f.signed());
    expect(result.statusCode).toBe(503);
    expect(result.json()).toEqual({ error: "INBOUND_INTAKE_UNAVAILABLE" });
  } finally {
    await f.app.close();
  }
});
it("ignores other signed event types without entering the admission pipeline", async () => {
  const f = await fixture();
  try {
    const result = await f.app.inject(
      f.signed(JSON.stringify({ type: "email.delivered" })),
    );
    expect(result.statusCode).toBe(200);
    expect(f.admit).not.toHaveBeenCalled();
  } finally {
    await f.app.close();
  }
});
it("enforces the raw body ceiling before admission", async () => {
  const f = await fixture();
  try {
    const result = await f.app.inject(f.signed("x".repeat(128 * 1024 + 1)));
    expect(result.statusCode).toBe(413);
    expect(f.admit).not.toHaveBeenCalled();
  } finally {
    await f.app.close();
  }
});
