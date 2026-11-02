import type {
  CommercialProcessingReview,
  CommercialProcessingStage,
} from "@fl-copilot/sync-contracts";
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
/** Text-AI drafts are historical only; current work is text parsing + visual reading. */
export function commercialProcessingPolicy(s: ProcessingSnapshot, now: Date) {
  type Step = CommercialProcessingReview["stages"][number];
  const job = s.job,
    n = job?.pageCount;
  const total = Number.isInteger(n) && n! >= 1 && n! <= 100 ? n! : null;
  const steps: Step[] = [
    { kind: "TEXT", state: "WAITING", readyPages: 0, totalPages: total },
    { kind: "AI", state: "UNAVAILABLE", readyPages: 0, totalPages: total },
    { kind: "VISUAL", state: "WAITING", readyPages: 0, totalPages: total },
  ];
  const eligible: CommercialProcessingStage[] = [];
  const live = (p: ProcessingPage) =>
    p.status === "PROCESSING" &&
    (!p.leaseExpiresAt || !elapsed(p.leaseExpiresAt, now));
  // Old invocations may still finish on their original deployment. Never restart over a live lease.
  let active = s.aiPages.some(live),
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
  const oldReady = s.aiPages.filter(
    (p) => p.status === "DRAFT_READY" && p.hasResult,
  ).length;
  steps[1]!.readyPages = Math.min(100, oldReady);
  if (s.aiPages.length)
    steps[1]!.state = active
      ? "RUNNING"
      : !validPages(s.aiPages) ||
          s.aiPages.some((p) => p.status === "DRAFT_READY" && !p.hasResult)
        ? "BLOCKED"
        : oldReady === total && s.aiPages.length === total
          ? "READY"
          : "UNAVAILABLE";
  const valid = !!(
    job &&
    job._id === s.source._id &&
    job.sourceDocumentId === s.source._id &&
    job.storeId === s.source.storeId &&
    job.checksum === s.source.checksum &&
    job.objectKey === s.source.objectKey &&
    job.pipelineVersion === "commercial-pdf.v1"
  );
  let visualSafe = false;
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
    !["AI_EXTRACTION", "DRAFT_REVIEW", "VISUAL_READING"].includes(job!.stage)
  )
    unavailable = true;
  else {
    steps[0] = {
      kind: "TEXT",
      state: "READY",
      readyPages: total,
      totalPages: total,
    };
    const registrationValid =
      !s.visual ||
      (s.visual._id === s.source._id &&
        s.visual.sourceDocumentId === s.source._id &&
        s.visual.storeId === s.source.storeId &&
        s.visual.checksum === s.source.checksum &&
        s.visual.parserVersion === job!.parserVersion &&
        s.visual.model === s.model &&
        s.visual.schemaVersion === s.visualSchema &&
        s.visual.pageCount === total);
    const rows = s.visualPages,
      ready = rows.filter((p) => p.status === "READY" && p.hasResult).length;
    steps[2]!.readyPages = Math.min(100, ready);
    const running = rows.some(live);
    if (running) active = true;
    visualSafe =
      registrationValid &&
      validPages(rows) &&
      !rows.some(
        (p) =>
          !["READY", "FAILED", "RETRY", "PROCESSING"].includes(p.status) ||
          (p.status === "READY" && !p.hasResult) ||
          (p.hasResult && !["READY", "FAILED"].includes(p.status)) ||
          (!["READY", "FAILED"].includes(p.status) &&
            (!Number.isInteger(p.attemptCount ?? 0) ||
              (p.attemptCount ?? 0) < 0)),
      );
    const due = rows.some(
      (p) =>
        !["READY", "FAILED"].includes(p.status) &&
        (p.attemptCount ?? 0) < 4 &&
        (p.status === "PROCESSING"
          ? !!p.leaseExpiresAt && elapsed(p.leaseExpiresAt, now)
          : elapsed(p.nextAttemptAt, now)),
    );
    const exhausted = rows.some(
      (p) =>
        !["READY", "FAILED"].includes(p.status) && (p.attemptCount ?? 0) >= 4,
    );
    const stageAllowed = [
      "TEXT_READY",
      "PROCESSING",
      "TO_VALIDATE",
      "AI_FAILED",
    ].includes(job!.status);
    if (
      visualSafe &&
      !running &&
      stageAllowed &&
      ((ready === total && s.visual?.status !== "COMPLETE") ||
        due ||
        rows.length < total)
    )
      eligible.push("VISUAL");
    steps[2]!.state = !visualSafe
      ? "BLOCKED"
      : running
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
  if (active || unavailable || !s.enabled) eligible.length = 0;
  const cooldown = job?.lastManualResumeAt
    ? new Date(job.lastManualResumeAt.getTime() + 300_000)
    : null;
  const notBefore =
    [
      cooldown,
      ...(job?.stage === "TEXT_EXTRACTION" ? [job.nextAttemptAt] : []),
      ...s.visualPages.map((p) => p.nextAttemptAt),
    ]
      .filter((d): d is Date => !!d && d > now)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  const canResume = eligible.length > 0 && elapsed(cooldown, now);
  const ready = steps[0]!.state === "READY" && steps[2]!.state === "READY";
  const state: CommercialProcessingReview["state"] =
    unavailable || !s.enabled
      ? "UNAVAILABLE"
      : active
        ? "RUNNING"
        : ready
          ? "READY"
          : steps[2]!.readyPages > 0
            ? "PARTIAL"
            : steps[0]!.state === "BLOCKED" ||
                (steps[2]!.state === "BLOCKED" && !eligible.length)
              ? "BLOCKED"
              : "WAITING";
  const messageFr =
    state === "UNAVAILABLE"
      ? "Le suivi de cette analyse n’est pas disponible. Le document et les résultats déjà reçus restent conservés."
      : state === "RUNNING"
        ? "Une analyse est encore en cours. Les étapes actives ne seront pas relancées."
        : ready
          ? "La lecture visuelle du PDF est disponible. L’ancienne extraction IA du texte n’est plus nécessaire. Aucune décision commerciale n’est enregistrée par cette lecture."
          : canResume
            ? "La lecture visuelle ou la préparation des pages peut reprendre. L’ancienne extraction IA du texte ne sera pas relancée ; ses résultats restent conservés."
            : state === "BLOCKED"
              ? "La lecture visuelle demande une vérification. Une relance ne corrigera pas un fichier invalide ou une limite de tentatives atteinte."
              : notBefore
                ? "Une prochaine tentative est possible après le délai demandé par le service. Les résultats reçus restent disponibles."
                : "La lecture visuelle attend le service. L’ancienne extraction IA du texte n’est plus utilisée ; le PDF original reste consultable dans le copilote.";
  return {
    state,
    stages: steps,
    canResume,
    canRestart:
      s.enabled &&
      valid &&
      !unavailable &&
      steps[0]!.state === "READY" &&
      !active &&
      elapsed(cooldown, now) &&
      elapsed(notBefore, now) &&
      !!total &&
      visualSafe &&
      ["TEXT_READY", "PROCESSING", "TO_VALIDATE", "AI_FAILED"].includes(
        job!.status,
      ) &&
      s.visualPages.length === total &&
      s.visualPages.every((p) => ["READY", "FAILED"].includes(p.status)),
    messageFr,
    notBefore: notBefore?.toISOString() ?? null,
    eligible,
  };
}
