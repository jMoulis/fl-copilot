import { z } from "zod";
import { copilotMessageSchema } from "./copilot-conversation";
import {
  copilotFormFieldSchema,
  copilotFormDefinitionSchema,
} from "./copilot-forms";
const field = z.union([
  copilotFormFieldSchema.options[0],
  copilotFormFieldSchema.options[1],
  copilotFormFieldSchema.options[2],
  copilotFormFieldSchema.options[3],
]);
/** Declarative missing-information request, with no actor, operation or write authority from the model. */
export const copilotInformationInputSchema = z
  .strictObject({
    title: copilotFormDefinitionSchema.shape.title,
    reason: copilotFormDefinitionSchema.shape.reason,
    fields: z
      .array(field)
      .min(1)
      .max(4)
      .refine(
        (fields) =>
          new Set(fields.map((item) => item.key)).size === fields.length,
      ),
  })
  .superRefine((request, ctx) => {
    const text = [
      request.title,
      request.reason,
      ...request.fields.flatMap((item) => [item.key, item.label]),
    ].join(" ");
    if (
      /api[_\s-]?key|password|mot\s+de\s+passe|auth[_\s-]?token|code\s+otp|carte\s+bancaire|num[eé]ro\s+de\s+carte/i.test(
        text,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Credentials/payment identifiers cannot be requested",
      });
  });
export const copilotInformationContentSchema = z.strictObject({
  kind: z.literal("MISSING_INFORMATION_REQUEST"),
  schemaVersion: z.literal(1),
  assistantMessageId: z.string().uuid(),
  definition: copilotFormDefinitionSchema,
});
export function readCopilotInformationRequest(raw: unknown) {
  const message = copilotMessageSchema.parse(raw);
  if (
    message.role !== "TOOL" ||
    !message.replyToMessageId ||
    message.attachments.length
  )
    throw Error("COPILOT_INFORMATION_INVALID");
  const content = copilotInformationContentSchema.parse(
    JSON.parse(message.text),
  );
  const definition = content.definition;
  copilotInformationInputSchema.parse({
    title: definition.title,
    reason: definition.reason,
    fields: definition.fields,
  });
  if (
    definition.id !== message.id ||
    definition.operationId !== message.id ||
    definition.parentUserMessageId !== message.replyToMessageId ||
    Object.keys(definition.prefill).length
  )
    throw Error("COPILOT_INFORMATION_BINDING_INVALID");
  return { message, content, definition };
}
