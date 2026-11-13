import { z } from "zod";
import { copilotBusinessDateSchema } from "./business-dates";
const instant = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s).toISOString());
export const journalNoteCaptureSchema = z
  .strictObject({
    id: z.string().uuid(),
    text: z.string().trim().min(1).max(1200),
    startDate: copilotBusinessDateSchema,
    endDate: copilotBusinessDateSchema.nullable(),
    capturedAt: instant,
  })
  .refine(
    (n) => n.endDate === null || n.endDate >= n.startDate,
    "La fin doit être le même jour ou après la date de la note.",
  );
export const storeJournalNoteSchema = journalNoteCaptureSchema
  .safeExtend({
    storeId: z.string().uuid(),
    withdrawnAt: instant.nullable(),
    version: z.union([z.literal(1), z.literal(2)]),
  })
  .superRefine((n, c) => {
    if (
      (n.version === 2) !== (n.withdrawnAt !== null) ||
      (n.withdrawnAt && n.withdrawnAt < n.capturedAt)
    )
      c.addIssue({
        code: "custom",
        message: "Vérifiez le retrait de cette note.",
      });
  });
export const journalNoteWithdrawalSchema = z.strictObject({
  capture: journalNoteCaptureSchema,
  withdrawnAt: instant,
});
export type StoreJournalNote = z.infer<typeof storeJournalNoteSchema>;
export function journalNoteCapture(n: StoreJournalNote) {
  return journalNoteCaptureSchema.parse({
    id: n.id,
    text: n.text,
    startDate: n.startDate,
    endDate: n.endDate,
    capturedAt: n.capturedAt,
  });
}
export function sameJournalNote(a: StoreJournalNote, b: StoreJournalNote) {
  return (
    a.storeId === b.storeId &&
    JSON.stringify(journalNoteCapture(a)) ===
      JSON.stringify(journalNoteCapture(b))
  );
}
export function prepareJournalNote(storeId: string, raw: unknown) {
  return storeJournalNoteSchema.parse({
    ...journalNoteCaptureSchema.parse(raw),
    storeId,
    withdrawnAt: null,
    version: 1,
  });
}
export function withdrawJournalNote(n: StoreJournalNote, at: string) {
  return n.withdrawnAt
    ? n
    : storeJournalNoteSchema.parse({ ...n, version: 2, withdrawnAt: at });
}
