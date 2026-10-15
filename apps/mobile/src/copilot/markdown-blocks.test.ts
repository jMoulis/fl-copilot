import { it, expect } from "vitest";
import { markdownBlocks } from "./markdown-blocks";
it("renders comparative tables between conversational paragraphs and preserves escaped pipes", () => {
  expect(
    markdownBlocks(
      "Voici le bilan.\n\n| Indicateur | Montant |\n| --- | ---: |\n| CA | 12 345,67 € |\n| A\\|B | inconnu |\n\nQue veux-tu approfondir ?",
    ),
  ).toEqual([
    { type: "paragraph", text: "Voici le bilan." },
    {
      type: "table",
      rows: [
        ["Indicateur", "Montant"],
        ["CA", "12 345,67 €"],
        ["A\\|B", "inconnu"],
      ],
    },
    { type: "paragraph", text: "Que veux-tu approfondir ?" },
  ]);
});
it("keeps incomplete table output readable during generation", () => {
  expect(markdownBlocks("| CA | Marge |")).toEqual([
    { type: "paragraph", text: "| CA | Marge |" },
  ]);
});
