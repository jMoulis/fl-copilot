import { storeEventTimeCandidates } from "./store-event-time";
import { z } from "zod";
import { copilotBusinessDateSchema } from "./business-dates";
const instant = z.string().datetime();
export const personalTaskFieldsSchema = z.strictObject({
  text: z.string().trim().min(1).max(250),
  date: copilotBusinessDateSchema,
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
  status: z.enum(["TODO", "DONE", "CANCELLED"]),
});
export const personalTaskSchema = personalTaskFieldsSchema
  .extend({
    id: z.string().uuid(),
    storeId: z.string().uuid(),
    ownerId: z.string().uuid(),
    version: z.number().int().positive(),
    createdAt: instant,
    updatedAt: instant,
    completedAt: instant.nullable(),
    cancelledAt: instant.nullable(),
  })
  .superRefine((t, ctx) => {
    if (
      (t.status === "DONE") !== (t.completedAt !== null) ||
      (t.status === "CANCELLED") !== (t.cancelledAt !== null) ||
      t.updatedAt < t.createdAt ||
      (t.completedAt &&
        (t.completedAt < t.createdAt || t.completedAt > t.updatedAt)) ||
      (t.cancelledAt &&
        (t.cancelledAt < t.createdAt || t.cancelledAt > t.updatedAt))
    )
      ctx.addIssue({
        code: "custom",
        message: "Vérifie les dates de ce pense-bête.",
      });
  });
export type PersonalTask = z.infer<typeof personalTaskSchema>;
export type PersonalTaskFields = z.infer<typeof personalTaskFieldsSchema>;
export function samePersonalTask(a: PersonalTask, b: PersonalTask) {
  return (
    a.id === b.id &&
    a.storeId === b.storeId &&
    a.ownerId === b.ownerId &&
    a.createdAt === b.createdAt
  );
}
/** Paris wall time; reject the spring gap, choose the first autumn occurrence. */
export function personalTaskInstant(date: string, time: string) {
  copilotBusinessDateSchema.parse(date);
  const first = storeEventTimeCandidates(date, time)[0];
  if (!first)
    throw Error(
      "Cette heure n’existe pas à Paris ce jour-là. Choisis une autre heure.",
    );
  return first;
}
export const personalTaskNotificationSchema = z.strictObject({
  kind: z.literal("PERSONAL_TASK"),
  taskId: z.string().uuid(),
  storeId: z.string().uuid(),
  ownerId: z.string().uuid(),
  fingerprint: z.string().min(1).max(100),
});
export function personalTaskFingerprint(t: PersonalTask) {
  return `${t.version}:${t.date}:${t.time}`;
}
