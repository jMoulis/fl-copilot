import { expect, it } from "vitest";
import { chatCompletionPreview } from "../src/notifications/chat-completion";
it("retains the real answer without headings, bullets, inline Markdown or source destinations", () => {
  expect(
    chatCompletionPreview(
      "## Mon conseil\n\n- **Privilégie** la `banane` 🙂. [Source](copilot-source:ref:0)\nVoir [les chiffres](https://example.test/private).",
    ),
  ).toBe("Mon conseil Privilégie la banane 🙂. Voir les chiffres.");
});
it("omits images, code blocks and raw URLs", () => {
  expect(
    chatCompletionPreview(
      '![Photo](https://example.test/image.png)\n```json\n{"internal":true}\n```\n**Bonjour !** https://example.test/source',
    ),
  ).toBe("Bonjour !");
});
it("keeps a short answer intact and joins lines", () => {
  expect(chatCompletionPreview("Oui,\navec plaisir !")).toBe(
    "Oui, avec plaisir !",
  );
});
it("caps long previews on a word boundary and marks truncation", () => {
  const answer = "La banane reste une bonne piste pour ton rayon. ".repeat(20);
  const preview = chatCompletionPreview(answer);
  expect(Array.from(preview).length).toBeLessThanOrEqual(180);
  expect(preview.endsWith("…")).toBe(true);
  expect(answer.startsWith(preview.slice(0, -1))).toBe(true);
  expect(answer[preview.length - 1]).toBe(" ");
});
it("does not split surrogate pairs when truncating emojis", () => {
  expect(chatCompletionPreview("🍌".repeat(250))).toBe("🍌".repeat(179) + "…");
});
it.each(["", "  \n", "[Source](copilot-source:ref:0)", "```unclosed"])(
  "falls back when no visible excerpt remains: %s",
  (value) => {
    expect(chatCompletionPreview(value)).toBe(
      "Le copilote a terminé. Ouvre ta conversation pour la consulter.",
    );
  },
);

it("omits citation metadata and link destinations containing parentheses", () => {
  expect(
    chatCompletionPreview(
      "**Bonjour.** [Source](copilot-source:%7Blabel:Tomate(250g)%7D) Voir [le détail](https://example.test/a(b)c).",
    ),
  ).toBe("Bonjour. Voir le détail.");
});
