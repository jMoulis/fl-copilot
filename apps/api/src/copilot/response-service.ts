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
  for (const candidate of candidates) {
    for (const item of candidate.evidence) {
      const serialized = JSON.stringify(item);
      const previous = byEvidence.get(item.id);
      if (previous !== undefined && previous !== serialized)
        throw new CopilotGroundingError("AMBIGUOUS_EVIDENCE");
      byEvidence.set(item.id, serialized);
    }
  }
  const evidence = new Set(
    candidates.flatMap((c) => c.evidence.map((e) => e.id)),
  );
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
  return result;
}

export function copilotResponseFallback(
  request: CopilotGenerationRequest,
): CopilotResponse {
  const evidenceValues = new Map<string, Set<string>>();
  for (const candidate of request.context.batch.candidates) {
    for (const item of candidate.evidence) {
      const values = evidenceValues.get(item.id) ?? new Set<string>();
      values.add(JSON.stringify(item));
      evidenceValues.set(item.id, values);
    }
  }
  const facts = [
    ...new Set(
      request.context.batch.candidates.flatMap((c) =>
        c.evidence.map((e) => e.id),
      ),
    ),
  ]
    .filter((id) => evidenceValues.get(id)?.size === 1)
    .slice(0, 24)
    .map((evidenceId) => ({ evidenceId }));
  return copilotResponseSchema.parse({
    language: "fr-FR",
    summary:
      "L’analyse du copilote est momentanément indisponible. Les données disponibles restent consultables.",
    facts,
    interpretation: [],
    recommendations: [],
    questions: [],
  });
}
export async function generateCopilotResponse(
  provider: CopilotAiProvider,
  raw: CopilotGenerationRequest,
  signal?: AbortSignal,
): Promise<{
  mode: "AI" | "FALLBACK";
  response: CopilotResponse;
  metadata: CopilotGenerationMetadata | null;
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
    );
    if (signal?.aborted)
      throw new CopilotAiError("COPILOT_AI_CANCELLED", false);
    return {
      mode: "AI",
      response: validateCopilotResponse(generated.output, request),
      metadata: generated.metadata,
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
    };
  }
}
