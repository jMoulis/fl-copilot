import type { CopilotActivity } from "@fl-copilot/sync-contracts";
import { answerProse, renderAnswerText } from "./answer-text.js";
import {
  copilotResponseSchema,
  type CopilotResponse,
} from "@fl-copilot/domain";
import {
  CopilotAiError,
  copilotGenerationRequestSchema,
  type CopilotAiProvider,
  type CopilotGenerationRequest,
  type CopilotGenerationMetadata,
} from "./ai-provider.js";

export class CopilotGroundingError extends Error {
  constructor(
    readonly code:
      | "INVALID_RESPONSE"
      | "UNKNOWN_EVIDENCE"
      | "INVALID_CANDIDATE"
      | "UNSUPPORTED_NUMBER"
      | "TRADE_OFF_REQUIRED"
      | "PRIORITY_ORDER_INVALID"
      | "AMBIGUOUS_EVIDENCE",
  ) {
    super(code);
    this.name = "CopilotGroundingError";
  }
}
export function copilotRequestEvidence(request: CopilotGenerationRequest) {
  return [
    ...(request.evidence ?? []),
    ...request.context.batch.candidates.flatMap((c) => c.evidence),
  ];
}
/** Strict first-stage grounding: figures stay in application-rendered evidence. */
export function validateCopilotResponse(
  raw: unknown,
  request: CopilotGenerationRequest,
): CopilotResponse {
  const parsed = copilotResponseSchema.safeParse(raw);
  if (!parsed.success) throw new CopilotGroundingError("INVALID_RESPONSE");
  const result = parsed.data;
  const candidates = request.context.batch.candidates;
  const byEvidence = new Map<string, string>();
  for (const item of copilotRequestEvidence(request)) {
    const serialized = JSON.stringify(item);
    const previous = byEvidence.get(item.id);
    if (previous !== undefined && previous !== serialized)
      throw new CopilotGroundingError("AMBIGUOUS_EVIDENCE");
    byEvidence.set(item.id, serialized);
  }
  const evidence = new Set(byEvidence.keys());
  if (result.facts.some((f) => !evidence.has(f.evidenceId)))
    throw new CopilotGroundingError("UNKNOWN_EVIDENCE");
  const seen = new Set<string>();
  let previousScore = Infinity;
  for (const r of result.recommendations) {
    const c = candidates.find((c) => c.id === r.candidateId);
    if (!c || c.status !== "ELIGIBLE" || c.type !== r.type || seen.has(c.id))
      throw new CopilotGroundingError("INVALID_CANDIDATE");
    seen.add(c.id);
    if (c.priority.score === null || c.priority.score > previousScore)
      throw new CopilotGroundingError("PRIORITY_ORDER_INVALID");
    previousScore = c.priority.score;
    if (
      request.context.tradeOffs.some(
        (t) =>
          t.sourceCandidateIds.includes(c.id) || t.candidateIds.includes(c.id),
      )
    )
      throw new CopilotGroundingError("TRADE_OFF_REQUIRED");
    const allowed = new Set(c.evidence.map((e) => e.id));
    if (
      [...r.evidenceIds, ...r.measurement.evidenceIds].some(
        (id) => !allowed.has(id),
      )
    )
      throw new CopilotGroundingError("UNKNOWN_EVIDENCE");
  }
  const prose = [
    ...(result.narrative ? [answerProse(result.narrative)] : []),
    result.summary,
    ...result.interpretation,
    ...result.questions,
    ...result.recommendations.flatMap((r) => [
      r.title,
      r.explanation,
      ...r.risks,
      ...r.missingData,
      r.measurement.objective,
      r.measurement.reviewWhen,
    ]),
  ];
  // No model-authored figures/dates: the client resolves evidence IDs to canonical values.
  if (prose.some((text) => /\p{N}/u.test(text)))
    throw new CopilotGroundingError("UNSUPPORTED_NUMBER");
  if (result.narrative) {
    try {
      renderAnswerText(
        result.narrative,
        result.facts,
        copilotRequestEvidence(request),
      );
    } catch {
      throw new CopilotGroundingError("UNKNOWN_EVIDENCE");
    }
  }
  return result;
}

export function copilotResponseFallback(
  request: CopilotGenerationRequest,
): CopilotResponse {
  const evidenceValues = new Map<string, Set<string>>();
  for (const item of copilotRequestEvidence(request)) {
    const values = evidenceValues.get(item.id) ?? new Set<string>();
    values.add(JSON.stringify(item));
    evidenceValues.set(item.id, values);
  }
  const facts = [...evidenceValues.keys()]
    .filter((id) => evidenceValues.get(id)?.size === 1)
    .slice(0, 24)
    .map((evidenceId) => ({ evidenceId }));
  const templates: Partial<
    Record<CopilotResponse["recommendations"][number]["type"], string>
  > = {
    INVESTIGATE_SALES_DROP: "Examiner l’évolution des ventes",
    INVESTIGATE_MARGIN_DROP: "Examiner l’évolution de la marge",
    CHECK_STOCK: "Vérifier la disponibilité en rayon",
    CHECK_PRICE: "Vérifier le prix affiché",
    CHECK_PLU: "Vérifier le code de vente",
    CHECK_QUALITY: "Vérifier la qualité en rayon",
    MONITOR_HIGH_WASTE: "Examiner la casse observée",
  };
  const blocked = new Set(
    request.context.tradeOffs.flatMap((t) => [
      ...t.candidateIds,
      ...t.sourceCandidateIds,
    ]),
  );
  const recommendations: CopilotResponse["recommendations"] =
    request.context.batch.candidates
      .filter(
        (c) =>
          c.status === "ELIGIBLE" &&
          c.priority.score !== null &&
          templates[c.type] &&
          !blocked.has(c.id),
      )
      .sort(
        (a, b) =>
          b.priority.score! - a.priority.score! || a.id.localeCompare(b.id),
      )
      .flatMap((c) => {
        const ids = [...new Set(c.evidence.map((e) => e.id))]
          .filter((id) => evidenceValues.get(id)?.size === 1)
          .slice(0, 16);
        if (!ids.length) return [];
        return [
          {
            candidateId: c.id,
            type: c.type,
            title: templates[c.type]!,
            explanation:
              "Ce signal provient des données calculées par l’application. Vérifiez les observations avant de décider.",
            evidenceIds: ids,
            confidence: "LOW" as const,
            risks: [
              "Ce signal ne démontre pas la cause de l’évolution observée.",
            ],
            missingData: c.context.missingData.slice(0, 8),
            measurement: {
              objective:
                "Comparer les observations sur des périodes complètes et compatibles.",
              evidenceIds: ids,
              reviewWhen:
                "Après vérification des informations et réception des prochaines données.",
            },
          },
        ];
      })
      .slice(0, 3);
  return copilotResponseSchema.parse({
    language: "fr-FR",
    summary:
      "L’analyse du copilote est momentanément indisponible. Les données disponibles restent consultables.",
    facts,
    interpretation: [],
    recommendations,
    questions: [],
  });
}
export async function generateCopilotResponse(
  provider: CopilotAiProvider,
  raw: CopilotGenerationRequest,
  signal?: AbortSignal,
  onProgress?: (text: string) => void,
  onActivity?: (activity: CopilotActivity) => void,
): Promise<{
  mode: "AI" | "FALLBACK";
  response: CopilotResponse;
  metadata: CopilotGenerationMetadata | null;
  evidence?: CopilotGenerationRequest["evidence"];
  contextCheckpoint?: Awaited<
    ReturnType<CopilotAiProvider["generate"]>
  >["contextCheckpoint"];
  knowledgeSuggestions?: Awaited<
    ReturnType<CopilotAiProvider["generate"]>
  >["knowledgeSuggestions"];
  informationRequests?: Awaited<
    ReturnType<CopilotAiProvider["generate"]>
  >["informationRequests"];
  needPreviews?: Awaited<
    ReturnType<CopilotAiProvider["generate"]>
  >["needPreviews"];
  cataloguePreviews?: Awaited<
    ReturnType<CopilotAiProvider["generate"]>
  >["cataloguePreviews"];
  executionPreviews?: Awaited<
    ReturnType<CopilotAiProvider["generate"]>
  >["executionPreviews"];
  productPreviews?: Awaited<
    ReturnType<CopilotAiProvider["generate"]>
  >["productPreviews"];
}> {
  const request = copilotGenerationRequestSchema.parse(raw);
  if (
    request.storeId !== request.context.batch.storeId ||
    request.context.batch.candidates.some(
      (c) =>
        c.storeId !== request.storeId ||
        c.eligibility.evaluatedAt !== request.context.batch.evaluatedAt,
    ) ||
    request.context.intents.some((i) => i.storeId !== request.storeId)
  )
    throw new CopilotAiError("COPILOT_AI_INPUT_INVALID", false);
  if (signal?.aborted) throw new CopilotAiError("COPILOT_AI_CANCELLED", false);
  try {
    const generated = await provider.generate(
      request,
      copilotResponseSchema,
      signal,
      onProgress
        ? (raw, evidence) => {
            if (!raw || typeof raw !== "object") return;
            const value = raw as { narrative?: unknown; facts?: unknown };
            if (
              typeof value.narrative !== "string" ||
              !Array.isArray(value.facts)
            )
              return;
            const facts = value.facts.filter(
              (f): f is { evidenceId: string } =>
                !!f &&
                typeof f === "object" &&
                typeof f.evidenceId === "string",
            );
            try {
              onProgress(
                renderAnswerText(
                  value.narrative,
                  facts,
                  [...copilotRequestEvidence(request), ...evidence],
                  true,
                ),
              );
            } catch {
              /* Unresolved/unsupported partial output is never displayed. */
            }
          }
        : undefined,
      onActivity,
    );
    if (generated.toolEvidence) {
      const updated = copilotGenerationRequestSchema.safeParse({
        ...request,
        evidence: [...(request.evidence ?? []), ...generated.toolEvidence],
      });
      if (!updated.success)
        throw new CopilotAiError("COPILOT_AI_INPUT_INVALID", false);
      request.evidence = updated.data.evidence;
    }
    if (signal?.aborted)
      throw new CopilotAiError("COPILOT_AI_CANCELLED", false);
    return {
      mode: "AI",
      response: validateCopilotResponse(generated.output, request),
      metadata: generated.metadata,
      productPreviews: generated.productPreviews,
      needPreviews: generated.needPreviews,
      cataloguePreviews: generated.cataloguePreviews,
      executionPreviews: generated.executionPreviews,
      informationRequests: generated.informationRequests,
      knowledgeSuggestions: generated.knowledgeSuggestions,
      contextCheckpoint: generated.contextCheckpoint,
      evidence: request.evidence,
    };
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof CopilotAiError && error.code === "COPILOT_AI_CANCELLED")
    )
      throw new CopilotAiError("COPILOT_AI_CANCELLED", false);
    if (
      !(error instanceof CopilotAiError) &&
      !(error instanceof CopilotGroundingError)
    )
      throw error;
    return {
      mode: "FALLBACK",
      response: copilotResponseFallback(request),
      metadata: null,
      evidence: request.evidence,
    };
  }
}
