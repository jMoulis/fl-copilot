import { expect, it } from "vitest";
let sequence = 0;
const randomUUID = () =>
  `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
import { validateKnowledgeSuggestionSources } from "./copilot-knowledge-proposal";
it("requires exact user quotations including the current message, never an assistant or invented source", () => {
  const id = randomUUID(),
    source = {
      id,
      text: "La casse est saisie à la date de saisie.",
      role: "USER",
    };
  const suggestion = {
    statement: "La casse est comptabilisée à la date de saisie.",
    sources: [{ messageId: id, quote: source.text }],
  };
  expect(validateKnowledgeSuggestionSources(suggestion, id, [source])).toEqual(
    suggestion,
  );
  for (const sources of [
    [],
    [{ ...source, role: "ASSISTANT" }],
    [{ ...source, text: "Texte différent" }],
  ])
    expect(() =>
      validateKnowledgeSuggestionSources(suggestion, id, sources),
    ).toThrow("QUOTE");
  expect(() =>
    validateKnowledgeSuggestionSources(suggestion, randomUUID(), [source]),
  ).toThrow("CURRENT_SOURCE");
});
