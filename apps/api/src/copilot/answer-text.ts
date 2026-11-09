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
import { BusinessDecimal, explorerRange } from "@fl-copilot/analytics-core";
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
  const prose = answerProse(text);
  const invalid = /\{\{|\}\}/.test(prose)
    ? "MALFORMED_MARKER"
    : /\p{N}/u.test(prose)
      ? "LITERAL_NUMBER"
      : /\]\s*\(|https?:|copilot-source:/i.test(prose)
        ? "EXTERNAL_LINK"
        : null;
  if (invalid) throw new Error("INVALID_ANSWER_TEMPLATE", { cause: invalid });
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
    const shown = new Set(
      used
        .filter((m) => m[1] === "value")
        .map((m) => facts[Number(m[2])]?.evidenceId),
    );
    const periods = new Set<string>();
    const periodLines: string[] = [];
    for (const m of used) {
      const item = byId.get(facts[Number(m[2])]?.evidenceId ?? "");
      if (
        m[1] === "value" &&
        item?.sourceType === "KPI" &&
        item.value !== null &&
        /^-?\d+(?:\.\d+)?$/.test(String(item.value))
      ) {
        if (item.analyticsContext) {
          const range = explorerRange(item.analyticsContext.period);
          const key = `${range.start}/${range.end}`;
          const visible = [...shown]
            .map((id) => String(byId.get(id ?? "")?.value ?? ""))
            .join(" ");
          if (!periods.has(key)) {
            periods.add(key);
            if (!visible.includes(range.start) || !visible.includes(range.end))
              periodLines.push(
                `Période consultée : ${range.start} au ${range.end}.`,
              );
          }
        }
        const dates = ["start", "end"].map((key) =>
          evidence.find(
            (e) =>
              e.sourceId === item.sourceId &&
              e.sourceType === "DATA_QUALITY" &&
              e.label === `Périmètre · period.${key}` &&
              typeof e.value === "string" &&
              /^\d{4}-\d{2}-\d{2}$/.test(e.value),
          ),
        );
        const [start, end] = dates;
        if (start && end && !periods.has(`${start.value}/${end.value}`)) {
          periods.add(`${start.value}/${end.value}`);
          if (!shown.has(start.id) || !shown.has(end.id)) {
            const indexes = dates.map((date) => {
              effectiveFacts.push({ evidenceId: date!.id });
              return effectiveFacts.length - 1;
            });
            periodLines.push(
              `Période consultée : {{value:${indexes[0]}}} au {{value:${indexes[1]}}}.`,
            );
          }
        }
      }
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
    if (periodLines.length) text += "\n\n" + periodLines.join("\n");
    if (missing.length) text += "\n\n" + missing.join(" · ");
  }
  let chartCount = 0;
  text = text.replace(token, (_m, kind: string, i: string, at: number) => {
    const item = byId.get(effectiveFacts[Number(i)]?.evidenceId ?? "");
    if (!item) {
      if (partial) return "";
      throw Error("UNKNOWN_ANSWER_EVIDENCE");
    }
    if (kind === "value") {
      if (item.value === null) return "non disponible";
      let raw = String(item.value);
      // Presentation only: exact evidence/citation values remain unchanged. Do not
      // round identifiers, quantities or ratios based on their numeric shape.
      const monetary =
        ["KPI", "COMPARISON"].includes(item.sourceType) &&
        (item.analyticsContext?.relation === "MONETARY" ||
          /^\s*(?:€|EUR\b)/i.test(text.slice(at + _m.length)) ||
          (/(?:price|cost|amount|purchase|sales|margin|prix|co[uû]t|montant|chiffre d.affaires|marge|€)/i.test(
            item.label,
          ) &&
            !/(?:quantity|quantit[eé]|rate|ratio|taux|percent|pourcentage|%|pct|count|days|jours|identifier|(?:^|[.\s])(?:id|ean|itm8|plu|code)\b|Id$)/i.test(
              item.label,
            )));
      if (monetary && /^-?\d+\.\d{3,}$/.test(raw)) {
        const rounded = new BusinessDecimal(raw).toDecimalPlaces(2);
        raw = rounded.isZero() ? "0.00" : rounded.toFixed(2);
      }
      const formatted = /^-?\d+(?:\.\d+)?$/.test(raw)
        ? raw
            .split(".")
            .map((part, i) =>
              i === 0 ? part.replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f") : part,
            )
            .join(",")
        : raw;
      const recordedUnit = ["KPI", "COMPARISON"].includes(item.sourceType)
        ? item.label.match(/\((€\/)?(kg|pièce|unité conditionnée)\)/iu)
        : null;
      const unit = recordedUnit
        ? `${recordedUnit[1] ?? ""}${recordedUnit[2]}`
        : monetary
          ? "€"
          : null;
      const following = text
        .slice(at + _m.length)
        .replace(/^\s*(?:[*_]+\s*)?/, "");
      const explicitUnit =
        /^(?:€|EUR\b|kg\b|pièce\b|unité conditionnée\b)/iu.test(following);
      // Use only the unit recorded on this exact evidence; never infer it from the catalogue.
      const suffix =
        unit && !explicitUnit && /^-?\d+(?:\.\d+)?$/.test(raw)
          ? ` ${unit}`
          : "";
      return escape(formatted) + suffix;
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
    throw new Error("INVALID_ANSWER_TEMPLATE", { cause: "MALFORMED_MARKER" });
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
