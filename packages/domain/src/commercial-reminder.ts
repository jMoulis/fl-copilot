import { z } from "zod";
import { addContextDays, parisDate } from "./weekly-context";
const id = z.string().uuid();
export const commercialReminderSchema = z
  .object({
    id,
    storeId: id,
    planId: id,
    planRevisionId: id,
    planChecksum: z.string().regex(/^[a-f0-9]{64}$/),
    operationId: id,
    weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    deadlineDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    fireAt: z.string().datetime(),
    enabled: z.boolean(),
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .refine(
    (s) => parisDate(s.fireAt) <= s.deadlineDate,
    "Le rappel doit précéder ou accompagner le démarrage prévu.",
  );
export type CommercialReminder = z.infer<typeof commercialReminderSchema>;
export function reminderInstant(date: string, time: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^([01]\d|2[01]):[0-5]\d$/.test(time) ||
    Number(time.slice(0, 2)) < 6
  )
    throw Error("Choisissez une heure entre 06:00 et 21:59.");
  const seed = new Date(`${date}T${time}:00Z`);
  if (Number.isNaN(seed.getTime()) || seed.toISOString().slice(0, 10) !== date)
    throw Error("Choisissez une date valide.");
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = f.formatToParts(seed),
    part = (k: string) => parts.find((p) => p.type === k)!.value;
  const wall = Date.parse(
    `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}Z`,
  );
  const result = new Date(seed.getTime() - (wall - seed.getTime()));
  if (parisDate(result.toISOString()) !== date)
    throw Error("Date locale invalide.");
  return result.toISOString();
}
export function proposedReminderDate(deadline: string) {
  return addContextDays(deadline, -1);
}
export const reminderNotificationDataSchema = z
  .object({
    kind: z.literal("COMMERCIAL_REMINDER"),
    reminderId: id,
    storeId: id,
    operationId: id,
    weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    revisionId: id,
    fingerprint: z.string().min(1).max(300),
  })
  .strict();
export function reminderFingerprint(r: CommercialReminder) {
  return `${r.version}:${r.planRevisionId}:${r.planChecksum}:${r.fireAt}`;
}
