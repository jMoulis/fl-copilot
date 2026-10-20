import type { FastifyInstance } from "fastify";
import type { Resend } from "resend";
import { verifyResendReceivedEvent } from "./resend-event.js";

/** The admission callback must durably record the verified envelope before resolving. */
export function registerResendIntakeWebhook(
  app: FastifyInstance,
  dependencies: {
    client: Pick<Resend, "webhooks">;
    secret: string;
    admit(
      input: NonNullable<ReturnType<typeof verifyResendReceivedEvent>>,
    ): Promise<unknown>;
  },
) {
  app.register(async (scope) => {
    // Encapsulation keeps ordinary JSON API routes on their existing object parser.
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser(
      "application/json",
      { parseAs: "string" },
      (_request, body, done) => done(null, body),
    );
    scope.post<{ Body: string }>(
      "/api/v1/intake/resend",
      { bodyLimit: 128 * 1024 },
      async (request, reply) => {
        let event;
        try {
          event = verifyResendReceivedEvent(dependencies.client, {
            body: request.body,
            headers: request.headers,
            secret: dependencies.secret,
          });
        } catch {
          return reply.code(400).send({ error: "INBOUND_WEBHOOK_INVALID" });
        }
        if (event) {
          try {
            await dependencies.admit(event);
          } catch {
            // Retriable: never acknowledge an envelope that failed durable admission.
            return reply
              .code(503)
              .send({ error: "INBOUND_INTAKE_UNAVAILABLE" });
          }
        }
        return reply.code(200).send({ received: true });
      },
    );
  });
}
