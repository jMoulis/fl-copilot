import { copilotResponseSchema } from "@fl-copilot/domain";

/** Recover completed paragraphs only after an output-length stop, never repair a
 * JSON object or guess an incomplete fact reference. Grounding still runs later. */
export function recoverAnalyticalPartialAnswer(text: string) {
  if (text.length > 100_000) return;
  for (const match of text.matchAll(/"narrative"\s*:\s*"/g)) {
    let prefix: { language?: unknown; facts?: unknown };
    try {
      prefix = JSON.parse(
        text.slice(0, match.index).replace(/,\s*$/, "") + "}",
      );
    } catch {
      continue;
    }
    if (
      prefix?.language !== "fr-FR" ||
      !Array.isArray(prefix.facts) ||
      !prefix.facts.length
    )
      continue;
    const start = match.index! + match[0].length;
    let end: number | undefined,
      consecutiveNewlines = 0;
    for (let i = start; i < text.length;) {
      let character = text[i++];
      if (character === '"') {
        end = i - 1;
        break;
      }
      if (character === "\\") {
        const escapeStart = i - 1;
        if (i >= text.length) break;
        i += text[i] === "u" ? 5 : 1;
        try {
          character = JSON.parse('"' + text.slice(escapeStart, i) + '"');
        } catch {
          break;
        }
      }
      if (character === "\r") continue;
      consecutiveNewlines = character === "\n" ? consecutiveNewlines + 1 : 0;
      if (consecutiveNewlines >= 2) end = i;
    }
    if (end === undefined) return;
    let narrative: string;
    try {
      narrative = JSON.parse('"' + text.slice(start, end) + '"').trim();
    } catch {
      return;
    }
    if (!narrative.includes("{{value:") || narrative.includes("```")) return;
    const parsed = copilotResponseSchema.safeParse({
      language: "fr-FR",
      summary: "Voici les premiers éléments de ton bilan.",
      facts: prefix.facts,
      narrative:
        narrative +
        "\n\nCette réponse est partielle : je n’ai pas terminé tous les points de ta demande.",
      interpretation: [],
      recommendations: [],
      questions: [],
    });
    return parsed.success ? parsed.data : undefined;
  }
}
