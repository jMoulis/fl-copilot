import type {
  CommercialProcessingReview,
  CommercialProcessingStage,
} from "@fl-copilot/sync-contracts";
import { COMMERCIAL_AI_RUNTIME_BUDGET_VERSION } from "./ai-runtime-limits.js";
export type ProcessingPage = {
  _id: string;
  pageNumber: number;
  status: string;
  checksum: string;
  attemptCount?: number;
  budgetAttemptCount?: number;
  runtimeBudgetVersion?: number;
  leaseExpiresAt?: Date | null;
  nextAttemptAt?: Date | null;
  hasResult?: boolean;
};
export type ProcessingSnapshot = {
  source: { _id: string; storeId: string; checksum: string; objectKey: string };
  job: {
    _id: string;
    storeId: string;
    sourceDocumentId?: string;
    checksum: string;
    objectKey?: string;
    pipelineVersion?: string;
    analysisRevision?: number;
    status: string;
    stage: string;
    attemptCount?: number;
    pageCount?: number;
    parserVersion?: string;
    aiModel?: string;
    aiSchemaVersion?: string;
    leaseExpiresAt?: Date | null;
    nextAttemptAt?: Date | null;
    nextAiAttemptAt?: Date | null;
    lastManualResumeAt?: Date | null;
  } | null;
  textPages: Array<{ pageNumber: number; checksum: string }>;
  aiPages: ProcessingPage[];
  visual: {
    _id: string;
    storeId: string;
    sourceDocumentId: string;
    checksum: string;
    parserVersion: string;
    model: string;
    analysisRevision?: number;
    schemaVersion: string;
    pageCount: number;
    status?: string;
  } | null;
  visualPages: ProcessingPage[];
  model: string;
  aiSchema: string;
  visualSchema: string;
  enabled: boolean;
};
const elapsed = (value: Date | null | undefined, now: Date) =>
  !value || value.getTime() <= now.getTime();
export function commercialProcessingPolicy(s: ProcessingSnapshot, now: Date) {
  type Step = CommercialProcessingReview["stages"][number];
  const job = s.job,
    n = job?.pageCount;
  const total = Number.isInteger(n) && n! >= 1 && n! <= 100 ? n! : null;
  const steps: Step[] = [
    { kind: "TEXT", state: "WAITING", readyPages: 0, totalPages: total },
    { kind: "AI", state: "WAITING", readyPages: 0, totalPages: total },
    { kind: "VISUAL", state: "WAITING", readyPages: 0, totalPages: total },
  ];
  const eligible: CommercialProcessingStage[] = [];
  let active = false,
    unavailable = false;
  const validPages = (rows: Array<{ pageNumber: number; checksum: string }>) =>
    rows.length <= 100 &&
    rows.every(
      (p) =>
        Number.isInteger(p.pageNumber) &&
        p.pageNumber >= 1 &&
        p.pageNumber <= (total ?? 100) &&
        p.checksum === s.source.checksum,
    ) &&
    new Set(rows.map((p) => p.pageNumber)).size === rows.length;
  const valid = !!(
    job &&
    job._id === s.source._id &&
    job.sourceDocumentId === s.source._id &&
    job.storeId === s.source.storeId &&
    job.checksum === s.source.checksum &&
    job.objectKey === s.source.objectKey &&
    job.pipelineVersion === "commercial-pdf.v1"
  );
  if (!valid) unavailable = true;
  else if (job!.stage === "TEXT_EXTRACTION") {
    if (job!.status === "PENDING") {
      if (elapsed(job!.nextAttemptAt, now)) eligible.push("TEXT");
    } else if (
      job!.status === "PROCESSING" &&
      job!.leaseExpiresAt &&
      elapsed(job!.leaseExpiresAt, now)
    )
      eligible.push("TEXT");
    else if (job!.status === "PROCESSING") {
      steps[0]!.state = "RUNNING";
      active = true;
    } else steps[0]!.state = "BLOCKED";
  } else if (
    !total ||
    !job!.parserVersion ||
    !validPages(s.textPages) ||
    s.textPages.length !== total ||
    !["AI_EXTRACTION", "DRAFT_REVIEW"].includes(job!.stage)
  )
    unavailable = true;
  else {
    steps[0] = {
      kind: "TEXT",
      state: "READY",
      readyPages: total,
      totalPages: total,
    };
    const aiValid =
      (!job!.aiModel || job!.aiModel === s.model) &&
      (!job!.aiSchemaVersion || job!.aiSchemaVersion === s.aiSchema) &&
      validPages(s.aiPages);
    const visualValid =
      !s.visual ||
      (s.visual._id === s.source._id &&
        s.visual.sourceDocumentId === s.source._id &&
        s.visual.storeId === s.source.storeId &&
        s.visual.checksum === s.source.checksum &&
        s.visual.parserVersion === job!.parserVersion &&
        s.visual.model === s.model &&
        s.visual.schemaVersion === s.visualSchema &&
        s.visual.pageCount === total);
    for (const kind of ["AI", "VISUAL"] as const) {
      const index = kind === "AI" ? 1 : 2,
        rows = kind === "AI" ? s.aiPages : s.visualPages;
      const validRows =
        (kind === "AI" ? aiValid : visualValid) && validPages(rows);
      const completed = kind === "AI" ? "DRAFT_READY" : "READY";
      const ready = rows.filter(
        (p) => p.status === completed && p.hasResult,
      ).length;
      steps[index]!.readyPages = Math.min(100, ready);
      const live = rows.some(
        (p) =>
          p.status === "PROCESSING" &&
          (!p.leaseExpiresAt || !elapsed(p.leaseExpiresAt, now)),
      );
      if (live) active = true;
      const safe =
        validRows &&
        !rows.some(
          (p) =>
            (p.hasResult && p.status !== completed && p.status !== "FAILED") ||
            (p.status === completed && !p.hasResult) ||
            (kind === "AI" &&
              p.status !== completed &&
              p.status !== "FAILED" &&
              (p.attemptCount ?? 0) > 0 &&
              (p.runtimeBudgetVersion !==
                COMMERCIAL_AI_RUNTIME_BUDGET_VERSION ||
                !Number.isInteger(p.budgetAttemptCount))) ||
            !(
              kind === "AI"
                ? [completed, "FAILED", "PENDING", "RETRY", "PROCESSING"]
                : [completed, "FAILED", "RETRY", "PROCESSING"]
            ).includes(p.status) ||
            (p.status !== completed &&
              p.status !== "FAILED" &&
              (!Number.isInteger(p.attemptCount ?? 0) ||
                (p.attemptCount ?? 0) < 0 ||
                (p.budgetAttemptCount !== undefined &&
                  (!Number.isInteger(p.budgetAttemptCount) ||
                    p.budgetAttemptCount < 0)))),
        );
      const due = rows.some(
        (p) =>
          p.status !== completed &&
          p.status !== "FAILED" &&
          (kind !== "AI" ||
            p.runtimeBudgetVersion === COMMERCIAL_AI_RUNTIME_BUDGET_VERSION ||
            !(p.attemptCount ?? 0)) &&
          (kind === "AI"
            ? (p.budgetAttemptCount ?? p.attemptCount ?? 0)
            : (p.attemptCount ?? 0)) < 4 &&
          (p.status === "PROCESSING"
            ? !!p.leaseExpiresAt && elapsed(p.leaseExpiresAt, now)
            : elapsed(p.nextAttemptAt, now)),
      );
      const exhausted = rows.some(
        (p) =>
          p.status !== completed &&
          p.status !== "FAILED" &&
          (kind === "AI"
            ? (p.budgetAttemptCount ?? p.attemptCount ?? 0)
            : (p.attemptCount ?? 0)) >= 4,
      );
      const missing = rows.length < total;
      const stageAllowed =
        kind === "AI"
          ? job!.stage === "AI_EXTRACTION" &&
            ["TEXT_READY", "PROCESSING"].includes(job!.status)
          : ["TEXT_READY", "PROCESSING", "TO_VALIDATE", "AI_FAILED"].includes(
              job!.status,
            );
      const finalizing =
        ready === total &&
        (kind === "AI"
          ? job!.status !== "TO_VALIDATE"
          : s.visual?.status !== "COMPLETE");
      if (
        safe &&
        !live &&
        stageAllowed &&
        (finalizing ||
          ((due || missing) &&
            (kind !== "AI" || elapsed(job!.nextAiAttemptAt, now))))
      )
        eligible.push(kind);
      steps[index]!.state = !safe
        ? "BLOCKED"
        : live
          ? "RUNNING"
          : ready === total
            ? "READY"
            : rows.some((p) => p.status === "FAILED") ||
                exhausted ||
                !stageAllowed
              ? ready
                ? "PARTIAL"
                : "BLOCKED"
              : ready
                ? "PARTIAL"
                : "WAITING";
    }
  }
  if (active || unavailable || !s.enabled) eligible.length = 0;
  const cooldown = job?.lastManualResumeAt
    ? new Date(job.lastManualResumeAt.getTime() + 300_000)
    : null;
  const notBefore =
    [
      cooldown,
      job?.nextAttemptAt,
      job?.nextAiAttemptAt,
      ...s.visualPages.map((p) => p.nextAttemptAt),
    ]
      .filter((d): d is Date => !!d && d > now)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  const canResume = eligible.length > 0 && elapsed(cooldown, now);
  const ready = steps.every((step) => step.state === "READY"),
    partial = steps.slice(1).some((step) => step.readyPages > 0);
  const state: CommercialProcessingReview["state"] =
    unavailable || !s.enabled
      ? "UNAVAILABLE"
      : active
        ? "RUNNING"
        : ready
          ? "READY"
          : partial
            ? "PARTIAL"
            : steps.some((step) => step.state === "BLOCKED") && !eligible.length
              ? "BLOCKED"
              : "WAITING";
  const messageFr =
    state === "UNAVAILABLE"
      ? "Le suivi de cette analyse n’est pas disponible. Le document et les résultats déjà reçus restent conservés."
      : state === "RUNNING"
        ? "L’analyse est en cours. Les étapes actives ne seront pas relancées."
        : ready
          ? "Les résultats d’analyse ont été reçus. Ils restent à examiner avant toute décision commerciale."
          : canResume
            ? "Les étapes en attente ou interrompues peuvent reprendre. Les résultats déjà reçus seront conservés."
            : state === "BLOCKED"
              ? "Cette analyse demande une vérification. Une relance ne corrigera pas un fichier invalide ou une limite de tentatives atteinte."
              : notBefore
                ? "Une prochaine tentative est prévue après le délai demandé par le service. Les résultats déjà reçus restent disponibles."
                : "Une partie du traitement attend le service. Les résultats déjà reçus restent disponibles ; actualisez cet état pour suivre la suite.";
  return {
    state,
    stages: steps,
    canResume,
    canRestart:
      s.enabled &&
      valid &&
      steps[0]!.state === "READY" &&
      !active &&
      elapsed(cooldown, now) &&
      elapsed(notBefore, now) &&
      !!total &&
      ["TO_VALIDATE", "AI_FAILED"].includes(job!.status) &&
      s.aiPages.length === total &&
      s.aiPages.every((p) => ["DRAFT_READY", "FAILED"].includes(p.status)) &&
      s.visualPages.length === total &&
      s.visualPages.every((p) => ["READY", "FAILED"].includes(p.status)),
    messageFr,
    notBefore: notBefore?.toISOString() ?? null,
    eligible,
  };
}
