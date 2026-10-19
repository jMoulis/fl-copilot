import { z } from "zod";
export const copilotBusinessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  });
export const copilotAnalysisPeriodSchema = z
  .strictObject({
    start: copilotBusinessDateSchema,
    end: copilotBusinessDateSchema,
  })
  .refine(
    (p) =>
      p.start <= p.end &&
      (Date.parse(p.end) - Date.parse(p.start)) / 86400000 < 3660,
    "Période invalide ou trop longue.",
  );
