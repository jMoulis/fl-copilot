import type { CopilotResponse } from "@fl-copilot/domain";
import type { CopilotGenerationRequest } from "./ai-provider.js";
type Evidence = NonNullable<CopilotGenerationRequest["evidence"]>[number];
const token = /\{\{(value|label|source):(\d+)\}\}/g;
export function answerProse(text: string) {
  return text.replace(token, "");
}
const escape = (value: string) =>
  value.replace(/[\\`*_[\]|<>]/g, "\\$&").replace(/\r?\n/g, " ");
/** Values and citation destinations come from server evidence, never model URLs. */
export function renderAnswerText(
  narrative: string,
  facts: CopilotResponse["facts"],
  evidence: readonly Evidence[],
  partial = false,
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
    if (old && JSON.stringify(old) !== JSON.stringify(item))
      throw Error("AMBIGUOUS_ANSWER_EVIDENCE");
    byId.set(item.id, item);
  }
  text = text.replace(token, (_whole, kind: string, index: string) => {
    const item = byId.get(facts[Number(index)]?.evidenceId ?? "");
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
    const source = encodeURIComponent(
      JSON.stringify({
        label: item.label,
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
        sourceType: item.sourceType,
        sourceId: item.sourceId,
      }),
    ).replace(/[()]/g, (c) => (c === "(" ? "%28" : "%29"));
    return `[Source](copilot-source:${source})`;
  });
  if (!partial && /\{\{|\}\}/.test(text))
    throw Error("INVALID_ANSWER_TEMPLATE");
  return text;
}
