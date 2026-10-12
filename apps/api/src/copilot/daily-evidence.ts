import { createHash } from "node:crypto";
import { z } from "zod";
import { copilotEvidenceSchema } from "@fl-copilot/domain";
import type { Db } from "mongodb";
const decimal = z
  .string()
  .regex(/^-?\d+(?:\.\d+)?$/)
  .nullable();
const metricAvailability = z.object({
  status: z.enum(["AVAILABLE", "PARTIAL", "UNAVAILABLE"]),
  inputCount: z.number().int().nonnegative(),
  availableInputCount: z.number().int().nonnegative(),
  missingInputCount: z.number().int().nonnegative(),
});
export const departmentEvidencePerformanceSchema = z.object({
  storeId: z.string().uuid(),
  date: z.string().date(),
  formulaVersion: z.literal("department-daily-v1"),
  inputRevision: z.string(),
  computedAt: z.string().datetime(),
  sales: z.object({ salesValue: decimal, marginValue: decimal }),
  waste: z.object({ salesValue: decimal }),
  availability: z.object({
    salesValue: metricAvailability,
    salesMarginValue: metricAvailability,
    wasteSalesValue: metricAvailability,
  }),
});
/** Read canonical remote values only; never recompute or treat latest date as today. */
export async function readLatestDepartmentEvidence(db: Db, storeId: string) {
  z.string().uuid().parse(storeId);
  const row = await db
    .collection<{
      _id: string;
      storeId: string;
      date: string;
      performance: unknown;
    }>("departmentDailyPerformance")
    .find({ storeId })
    .sort({ date: -1 })
    .limit(1)
    .next();
  if (!row) return [];
  return departmentSnapshotEvidence(validateDepartmentSnapshot(row, storeId));
}

type Row = { _id: string; storeId: string; date: string; performance: unknown };
function validateDepartmentSnapshot(row: Row, storeId: string) {
  const p = departmentEvidencePerformanceSchema.parse(row.performance);
  if (p.storeId !== storeId || p.date !== row.date)
    throw new Error("COPILOT_DAILY_EVIDENCE_SCOPE_INVALID");
  return { sourceId: row._id, performance: p };
}

export async function readDepartmentDailySnapshot(
  db: Db,
  storeId: string,
  date: string,
) {
  z.string().uuid().parse(storeId);
  z.string().date().parse(date);
  const row = await db
    .collection<Row>("departmentDailyPerformance")
    .findOne({ storeId, date });
  if (!row) return null;
  if (row.date !== date)
    throw new Error("COPILOT_DAILY_EVIDENCE_SCOPE_INVALID");
  return validateDepartmentSnapshot(row, storeId);
}

export function departmentSnapshotEvidence(
  snapshot: NonNullable<
    Awaited<ReturnType<typeof readDepartmentDailySnapshot>>
  >,
) {
  const p = snapshot.performance;
  const revision = createHash("sha256").update(p.inputRevision).digest("hex");
  const metrics = [
    {
      key: "sales",
      label: "Chiffre d’affaires net",
      value: p.sales.salesValue,
      status: p.availability.salesValue,
    },
    {
      key: "margin",
      label: "Marge",
      value: p.sales.marginValue,
      status: p.availability.salesMarginValue,
    },
    {
      key: "waste",
      label: "Casse valorisée au prix de vente",
      value: p.waste.salesValue,
      status: p.availability.wasteSalesValue,
    },
  ];
  return metrics.flatMap((m) => [
    copilotEvidenceSchema.parse({
      id: JSON.stringify([
        "department-daily",
        snapshot.sourceId,
        revision,
        m.key,
      ]),
      sourceType: "KPI",
      sourceId: snapshot.sourceId,
      sourceVersion: null,
      label: `${m.label} (€) — ${p.date}`,
      value: m.status.status === "UNAVAILABLE" ? null : m.value,
      factKind: "DERIVED",
    }),
    copilotEvidenceSchema.parse({
      id: JSON.stringify([
        "department-daily",
        snapshot.sourceId,
        revision,
        m.key,
        "availability",
      ]),
      sourceType: "DATA_QUALITY",
      sourceId: snapshot.sourceId,
      sourceVersion: null,
      label: `Disponibilité — ${m.label} — ${p.date}`,
      value: m.status.status,
      factKind: "QUALITY",
    }),
  ]);
}
