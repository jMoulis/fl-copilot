import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { implantationFixture } from "../../../../scripts/test-implantation-fixtures";
import { readImplantationScenario } from "./implantation-tool";
import { readActivityStage } from "./read-activity";
import { renderAnswerText } from "./answer-text";

it("returns reproducible private-store revisions and human sources compatible with existing history", () => {
  const store = randomUUID(),
    input = implantationFixture();
  const a = readImplantationScenario(store, input);
  expect(readImplantationScenario(store, input)).toEqual(a);
  expect(readImplantationScenario(randomUUID(), input).revision).not.toBe(
    a.revision,
  );
  input.fixtures[0]!.xMm = 1;
  expect(readImplantationScenario(store, input).revision).not.toBe(a.revision);
  expect(a.evidence[0]).toMatchObject({
    factKind: "QUALITY",
    sourceType: "DATA_QUALITY",
  });
  expect(a.evidence[0]!.detail).toContain("pas des mesures magasin confirmées");
  expect(a.evidence[0]!.detail).toContain("continuité entrée/sortie");
  expect(a.evidence.find((e) => e.label === "Îlot légumes")!.value).toContain(
    "100 cm × 200 cm",
  );
  expect(
    readActivityStage(JSON.stringify(["implantation-scenario", input])),
  ).toBe("ANALYTICS");
});
it("qualifies missing and impossible sources; zero load is known, not absent", () => {
  const f = implantationFixture();
  f.fixtures[0]!.loadKg = 0;
  f.fixtures[1]!.loadKg = null;
  f.fixtures[0]!.heightMm = 1801;
  const r = readImplantationScenario(randomUUID(), f);
  expect(r.scenario.status).toBe("BLOCKED");
  expect(r.evidence.find((e) => e.label === "TG fruits")!.value).toContain(
    "Charge prévue : 0 kg",
  );
  expect(r.evidence.find((e) => e.label === "Îlot légumes")!.value).toContain(
    "Charge prévue : inconnue",
  );
  expect(r.evidence.at(-1)!.value).toContain("hauteur maximale");
});
it("renders dimensions and qualifications through the existing source links, without model arithmetic", () => {
  const r = readImplantationScenario(randomUUID(), implantationFixture());
  const evidence = [
    r.evidence[0]!,
    r.evidence.find((e) => e.label === "Îlot légumes")!,
  ];
  const text = renderAnswerText(
    "Hypothèse : {{value:1}} {{source:0}}",
    evidence.map((e) => ({ evidenceId: e.id })),
    evidence,
  );
  expect(text).toContain("100 cm × 200 cm");
  const encoded = /copilot-source:([^)]*)/.exec(text)![1]!;
  const source = JSON.parse(decodeURIComponent(encoded));
  expect(source.value).toContain("pas des mesures magasin confirmées");
  expect(source.sourceType).toBe("DATA_QUALITY");
  expect(source.sourceId).toBe(evidence[0]!.sourceId);
  expect(() =>
    renderAnswerText("Passage de 90 cm suffisant", [], evidence),
  ).toThrow("INVALID_ANSWER_TEMPLATE");
});
