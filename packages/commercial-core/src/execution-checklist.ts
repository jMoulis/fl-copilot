import {
  commercialWeekPlanSchema,
  type CommercialWeekPlan,
  type CommercialExecutionTask,
} from "@fl-copilot/domain";
import { commercialUuidFromText } from "./offer-choice";
type Digest = (s: string) => Promise<string>;
export async function commercialExecutionPlanChecksum(
  plan: CommercialWeekPlan,
  digest: Digest,
) {
  const sum = (
    await digest(JSON.stringify(commercialWeekPlanSchema.parse(plan)))
  ).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sum))
    throw Error("COMMERCIAL_EXECUTION_DIGEST_INVALID");
  return sum;
}
export function commercialExecutionTaskId(
  storeId: string,
  revisionId: string,
  checksum: string,
  kind: string,
  targetId: string,
  digest: Digest,
) {
  return commercialUuidFromText(
    JSON.stringify([
      "fl-copilot/execution-task.v1",
      storeId.toLowerCase(),
      revisionId.toLowerCase(),
      checksum,
      kind,
      targetId.toLowerCase(),
    ]),
    digest,
  );
}
export type CommercialExecutionProposal = Pick<
  CommercialExecutionTask,
  | "id"
  | "storeId"
  | "planId"
  | "planRevisionId"
  | "planVersion"
  | "planChecksum"
  | "kind"
  | "targetId"
  | "label"
>;
export async function commercialExecutionChecklist(
  input: CommercialWeekPlan,
  digest: Digest,
): Promise<CommercialExecutionProposal[]> {
  const p = commercialWeekPlanSchema.parse(input),
    checksum = await commercialExecutionPlanChecksum(p, digest),
    targets = [
      ...p.offers.map((o) => ({
        kind: "PRINT_SIGNAGE" as const,
        targetId: o.id,
        label: `Préparer et imprimer l’affiche – ${o.rawProductLabel}`,
      })),
      ...p.preparation.placements.map((t) => ({
        kind: "INSTALL_TG" as const,
        targetId: t.id,
        label: `Installer ${t.label}${t.theme ? ` – ${t.theme}` : ""}`,
      })),
    ];
  return Promise.all(
    targets.map(async (t) => ({
      ...t,
      id: await commercialExecutionTaskId(
        p.storeId,
        p.revisionId,
        checksum,
        t.kind,
        t.targetId,
        digest,
      ),
      storeId: p.storeId,
      planId: p.id,
      planRevisionId: p.revisionId,
      planVersion: p.version,
      planChecksum: checksum,
    })),
  );
}
export function commercialExecutionSameIdentity(
  a: CommercialExecutionTask,
  b: CommercialExecutionTask,
) {
  return [
    "id",
    "storeId",
    "planId",
    "planRevisionId",
    "planVersion",
    "planChecksum",
    "kind",
    "targetId",
    "label",
    "createdAt",
  ].every(
    (k) =>
      a[k as keyof CommercialExecutionTask] ===
      b[k as keyof CommercialExecutionTask],
  );
}
export function commercialExecutionSameTarget(
  t: CommercialExecutionTask,
  p: CommercialExecutionProposal,
) {
  return [
    "id",
    "storeId",
    "planId",
    "planRevisionId",
    "planVersion",
    "planChecksum",
    "kind",
    "targetId",
    "label",
  ].every(
    (k) =>
      t[k as keyof CommercialExecutionTask] ===
      p[k as keyof CommercialExecutionProposal],
  );
}
export function commercialExecutionProgress(
  proposals: readonly CommercialExecutionProposal[],
  tasks: readonly CommercialExecutionTask[],
) {
  const counts = { TODO: 0, DONE: 0, SKIPPED: 0, NOT_APPLICABLE: 0 };
  for (const p of proposals) {
    const t = tasks.find((t) => commercialExecutionSameTarget(t, p));
    counts[t?.status ?? "TODO"]++;
  }
  return { total: proposals.length, ...counts };
}
