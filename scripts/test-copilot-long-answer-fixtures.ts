/** Synthetic values only; no production conversation or provider request. */
export function longCopilotAnswerFixture(count = 24) {
  const evidence = Array.from({ length: count }, (_, i) => ({
    id: `long-answer/${i}`,
    sourceId: `published-period/${i}`,
    sourceType: "KPI" as const,
    sourceVersion: 1,
    label: `Produit ${i}`,
    value: `${i}.25`,
    detail:
      "Période publiée du 01/10/2025 au 31/10/2025 ; unités compatibles, périmètre et couverture conservés. ".repeat(
        24,
      ),
    factKind: "DERIVED" as const,
  }));
  const facts = evidence.map((v) => ({ evidenceId: v.id }));
  const narrative =
    "Voici les chiffres renseignés.\n\n| Produit | Montant |\n| --- | --- |\n" +
    facts
      .map((_, i) => `| {{label:${i}}} | {{value:${i}}} € {{source:${i}}} |`)
      .join("\n");
  const output = {
    language: "fr-FR" as const,
    summary: "Voici les chiffres renseignés.",
    facts,
    narrative,
    interpretation: [],
    recommendations: [],
    questions: [],
  };
  return { evidence, facts, narrative, output };
}
