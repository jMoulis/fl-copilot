import {
  sameCopilotEvidence,
  preferEvidenceNavigation,
} from "./evidence-identity";
import {
  packAnalyticsDestinations,
  copilotAnswerSourcesSchema,
  type CopilotAnswerSource,
  type AnalyticsExplorerContext,
} from "@fl-copilot/domain";
import type { CopilotResponse } from "@fl-copilot/domain";
import type { CopilotGenerationRequest } from "./ai-provider.js";
type Evidence = NonNullable<CopilotGenerationRequest["evidence"]>[number];
const token = /\{\{(value|label|source|chart):(\d+)\}\}/g;
export function answerProse(text: string) {
  return text.replace(token, "");
}
const escape = (value: string) =>
  value.replace(/[\\`*_[\]|<>]/g, "\\$&").replace(/\r?\n/g, " ");
/** Values and citation destinations come from server evidence, never model URLs. */
function render(
  narrative: string,
  facts: CopilotResponse["facts"],
  evidence: readonly Evidence[],
  partial = false,
  includeAnalytics = true,
  destinations?: AnalyticsExplorerContext[],
  sources?: CopilotAnswerSource[],
) {
  let text = partial ? narrative.replace(/\{(?:\{[^}]*\}?)?$/, "") : narrative;
  if (
    /\p{N}/u.test(answerProse(text)) ||
    /\]\s*\(|https?:|copilot-source:/i.test(answerProse(text))
  )
    throw Error("INVALID_ANSWER_TEMPLATE");
  const byId = new Map<string, Evidence>();
  for (const item of evidence) {
    const old = byId.get(item.id);
    if (old && !sameCopilotEvidence(old, item))
      throw Error("AMBIGUOUS_ANSWER_EVIDENCE");
    byId.set(item.id, preferEvidenceNavigation(old, item));
  }
  // Cite the actual numeric read families, even when prose omits links or cites an earlier coverage read.
  const effectiveFacts = [...facts];
  if (!partial) {
    const used = [...text.matchAll(token)];
    const cited = new Set(
      used
        .filter((m) => m[1] === "source" || m[1] === "chart")
        .map((m) => byId.get(facts[Number(m[2])]?.evidenceId ?? "")?.sourceId),
    );
    const missing: string[] = [];
    for (const m of used) {
      const item = byId.get(facts[Number(m[2])]?.evidenceId ?? "");
      if (
        m[1] !== "value" ||
        !item ||
        item.value === null ||
        !/^-?\d+(?:\.\d+)?$/.test(String(item.value)) ||
        !["KPI", "COMPARISON"].includes(item.sourceType) ||
        cited.has(item.sourceId)
      )
        continue;
      cited.add(item.sourceId);
      const scope =
        evidence.find(
          (e) =>
            e.sourceId === item.sourceId &&
            e.sourceType === "DATA_QUALITY" &&
            e.analyticsContext,
        ) ?? item;
      effectiveFacts.push({ evidenceId: scope.id });
      missing.push(`{{source:${effectiveFacts.length - 1}}}`);
    }
    if (missing.length) text += "\n\n" + missing.join(" · ");
  }
  let chartCount = 0;
  text = text.replace(token, (_whole, kind: string, index: string) => {
    const item = byId.get(effectiveFacts[Number(index)]?.evidenceId ?? "");
    if (!item) {
      if (partial) return "";
      throw Error("UNKNOWN_ANSWER_EVIDENCE");
    }
    if (kind === "value") {
      if (item.value === null) return "non disponible";
      const raw = String(item.value);
      const formatted = /^-?\d+(?:\.\d+)?$/.test(raw)
        ? raw
            .split(".")
            .map((part, i) =>
              i === 0 ? part.replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f") : part,
            )
            .join(",")
        : raw;
      return escape(formatted);
    }
    if (kind === "label") return escape(item.label);
    if (kind === "chart" && !item.chart) throw Error("UNKNOWN_ANSWER_CHART");
    if (kind === "chart" && ++chartCount > 2) kind = "source";
    let analyticsIndex: number | undefined;
    if (destinations && item.analyticsContext) {
      const identity = JSON.stringify(item.analyticsContext);
      analyticsIndex = destinations.findIndex(
        (c) => JSON.stringify(c) === identity,
      );
      if (analyticsIndex < 0) {
        analyticsIndex = destinations.length;
        destinations.push(item.analyticsContext);
      }
    }
    const metadata: CopilotAnswerSource = {
      label: item.label,
      ...(item.chart ? { chart: item.chart } : {}),
      value: item.retailExpertise
        ? (item.detail ?? item.value)
        : item.externalResearch
          ? "Informations publiques externes, distinctes des chiffres du magasin."
          : (item.detail ?? item.value),
      ...(item.externalResearch
        ? { externalResearch: item.externalResearch }
        : {}),
      ...(item.retailExpertise
        ? { retailExpertise: item.retailExpertise }
        : {}),
      ...(analyticsIndex !== undefined
        ? { analyticsIndex }
        : includeAnalytics && item.analyticsContext
          ? { analyticsContext: item.analyticsContext }
          : {}),
      sourceType: item.sourceType,
      sourceId: item.sourceId,
    };
    if (sources) {
      const identity = JSON.stringify(metadata);
      let at = sources.findIndex(
        (source) => JSON.stringify(source) === identity,
      );
      if (at < 0) {
        at = sources.length;
        sources.push(metadata);
      }
      return `[${kind === "chart" ? "Graphique" : "Source"}](copilot-source:ref:${at})`;
    }
    const source = encodeURIComponent(JSON.stringify(metadata)).replace(
      /[()]/g,
      (c) => (c === "(" ? "%28" : "%29"),
    );
    return `[${kind === "chart" ? "Graphique" : "Source"}](copilot-source:${source})`;
  });
  if (!partial && /\{\{|\}\}/.test(text))
    throw Error("INVALID_ANSWER_TEMPLATE");
  if (!destinations && includeAnalytics && text.length > 16000)
    return render(narrative, facts, evidence, partial, false);
  return text;
}

/** Legacy rendering remains readable on installed clients without the negotiated table. */
export function renderAnswerText(
  narrative: string,
  facts: CopilotResponse["facts"],
  evidence: readonly Evidence[],
  partial = false,
  includeAnalytics = true,
) {
  return render(narrative, facts, evidence, partial, includeAnalytics);
}
/** Deduplicate analytical targets outside readable text; never drop a target on overflow. */
export function renderAnswerContent(
  narrative: string,
  facts: CopilotResponse["facts"],
  evidence: readonly Evidence[],
  partial = false,
) {
  const targets: AnalyticsExplorerContext[] = [];
  let text = render(narrative, facts, evidence, partial, false, targets);
  let answerSources: CopilotAnswerSource[] | undefined;
  if (text.length > 16000) {
    answerSources = [];
    text = render(
      narrative,
      facts,
      evidence,
      partial,
      false,
      targets,
      answerSources,
    );
    if (answerSources.length)
      answerSources = copilotAnswerSourcesSchema.parse(answerSources);
    else answerSources = undefined;
  }
  if (text.length > 16000) throw Error("ANSWER_TEXT_TOO_LARGE");
  const analyticsDestinations = packAnalyticsDestinations(targets);
  return {
    text,
    ...(analyticsDestinations ? { analyticsDestinations } : {}),
    ...(answerSources ? { answerSources } : {}),
  };
}
