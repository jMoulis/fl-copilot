import { describe, expect, it } from "vitest";
import { buildDailySubstitutionEvidence } from "./evidence";
import { evidenceFixture } from "./evidence-fixtures";
import { calculateConservativeSubstitutionScore as score } from "./scoring";

async function fixture() {
  const f = await evidenceFixture();
  const e = await buildDailySubstitutionEvidence(f.input);
  return { relation: f.substitution, e };
}
describe("conservative substitution scoring", () => {
  it("caps an extreme observation and does not confuse validation with evidence", async () => {
    const { relation, e } = await fixture();
    expect(score({ relation, evidence: [] }).metrics).toBeNull();
    const result = score({
      relation,
      evidence: [
        {
          ...e,
          evidenceStrength: 0.5,
          dataQuality: 1,
          observedVariationPct: "999999",
        },
      ],
    });
    expect(result.metrics!.observedSubstitution).toBeLessThanOrEqual(0.525);
    expect(result.metrics!.confidence).toBeLessThan(0.02);
    expect(result.metrics!.evidenceCount).toBe(1);
    expect(relation.evidenceCount).toBe(0);
  });
  it("replays independently of input order, clock and previously calculated metrics", async () => {
    const { relation, e } = await fixture();
    const first = score({ relation, evidence: [e, e] });
    const learned = {
      ...relation,
      ...first.metrics!,
      status: "LEARNING" as const,
    };
    expect(score({ relation: learned, evidence: [e] })).toEqual(first);
    expect(
      score({
        relation: { ...learned, updatedAt: "2027-01-01T00:00:00.000Z" },
        evidence: [e],
      }),
    ).toEqual(first);
  });
  it("replaces a correction instead of adding an observation and removes invalidated evidence", async () => {
    const { relation, e } = await fixture();
    const corrected = {
      ...e,
      version: 2,
      evidenceStrength: 0.1,
      inputRevision: "f".repeat(64),
    };
    expect(score({ relation, evidence: [e, corrected] })).toEqual(
      score({ relation, evidence: [corrected, e] }),
    );
    expect(
      score({ relation, evidence: [e, corrected] }).metrics!.evidenceCount,
    ).toBe(1);
    const invalidated = {
      ...corrected,
      status: "MISSING_SALES" as const,
      observedVariationPct: null,
      interpretation: null,
      evidenceStrength: null,
      dataQuality: null,
    };
    expect(score({ relation, evidence: [e, invalidated] }).metrics).toBeNull();
  });
  it("does not count overlapping days or the same incident twice", async () => {
    const { relation, e } = await fixture();
    const other = {
      ...e,
      id: "00000001-1111-4111-8111-111111111111",
      eventId: "00000002-1111-4111-8111-111111111111",
    };
    const result = score({ relation, evidence: [e, other] });
    expect(result.metrics!.evidenceCount).toBe(1);
    expect(result.decisions.map((d) => d.reason)).toContain("DEPENDENT");
  });
  it("grows slowly with independent observations and falls with reliable contradictions", async () => {
    const { relation, e } = await fixture();
    const next = {
      ...e,
      id: "00000003-1111-4111-8111-111111111111",
      eventId: "00000004-1111-4111-8111-111111111111",
      observationStart: "2026-10-16T22:00:00.000Z",
      observationEnd: "2026-10-17T22:00:00.000Z",
      eventEndedAt: "2026-10-17T22:00:00.000Z",
      observationDates: ["2026-10-17"],
      observationSalesIds: ["00000005-1111-4111-8111-111111111111"],
    };
    const once = score({ relation, evidence: [e] });
    const twice = score({ relation, evidence: [next, e] });
    expect(twice.metrics!.confidence).toBeGreaterThan(once.metrics!.confidence);
    expect(twice.metrics!.observedSubstitution).toBeGreaterThan(
      once.metrics!.observedSubstitution,
    );
    expect(twice.metrics!.lastEvidenceAt).toBe(next.eventEndedAt);
    const mixed = score({
      relation,
      evidence: [e, { ...next, interpretation: "CONTRADICTS_SUBSTITUTION" }],
    });
    expect(mixed.metrics!.relationshipScore).toBeLessThan(
      twice.metrics!.relationshipScore,
    );
    expect(mixed.metrics!.confidence).toBeLessThan(twice.metrics!.confidence);
  });
  it("does not interpret neutral or incomplete context as contradictory learning", async () => {
    const { relation, e } = await fixture();
    expect(
      score({ relation, evidence: [{ ...e, interpretation: "NEUTRAL" }] })
        .metrics,
    ).toBeNull();
    expect(
      score({ relation, evidence: [{ ...e, evidenceStrength: 0 }] }).metrics,
    ).toBeNull();
    const basic = score({ relation, evidence: [e] });
    const partial = score({
      relation,
      evidence: [{ ...e, partialEventDays: true }],
    });
    expect(partial.metrics!.confidence).toBeLessThan(basic.metrics!.confidence);
  });
  it("preserves rejection and proposal authority", async () => {
    const { relation, e } = await fixture();
    expect(
      score({ relation: { ...relation, status: "REJECTED" }, evidence: [e] })
        .status,
    ).toBe("INELIGIBLE");
    expect(
      score({
        relation: { ...relation, status: "PROPOSED", humanConfirmed: false },
        evidence: [e],
      }).metrics,
    ).toBeNull();
  });
  it("refuses foreign scope and ambiguous revisions", async () => {
    const { relation, e } = await fixture();
    expect(() =>
      score({
        relation,
        evidence: [{ ...e, sourceProductId: relation.substituteProductId }],
      }),
    ).toThrow("SCOPE_INVALID");
    expect(() =>
      score({ relation, evidence: [e, { ...e, dataQuality: 0.8 }] }),
    ).toThrow("REVISION_AMBIGUOUS");
  });
  it("distinguishes an unknown compatibility from an explicit zero", async () => {
    const { relation, e } = await fixture();
    const unknown = score({ relation, evidence: [e] });
    const zero = score({
      relation: { ...relation, priceCompatibility: 0 },
      evidence: [e],
    });
    expect(zero.metrics!.relationshipScore).toBeLessThan(
      unknown.metrics!.relationshipScore,
    );
  });
});
