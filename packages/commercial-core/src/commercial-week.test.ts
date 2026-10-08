import { describe, expect, it } from "vitest";
import type { CommercialVisualPageOutput } from "@fl-copilot/domain";
import {
  currentCommercialWeek,
  commercialEntryWeekStatus,
  commercialItemWeekStatus,
  commercialDeadlineThisWeek,
  withParentYear,
  scopeCommercialVisualReading,
  commercialDocumentWeekContext,
} from "./commercial-week";
type Fields = CommercialVisualPageOutput["operations"][number]["fields"];
function entry(values: Array<[Fields[number]["name"], string]>) {
  return {
    fields: values.map(([name, rawValue]) => ({
      name,
      rawValue,
      confidence: 1,
      evidence: [{ pageNumber: 1, quote: rawValue, region: null }],
    })),
  };
}
const week = currentCommercialWeek(new Date("2026-10-08T08:00:00Z"));
describe("commercial current week", () => {
  it("uses ISO weeks and Paris calendar boundaries, including a different ISO year", () => {
    expect(week).toMatchObject({
      year: 2026,
      number: 41,
      start: "2026-10-05",
      end: "2026-10-11",
    });
    expect(
      currentCommercialWeek(new Date("2021-01-01T12:00:00Z")),
    ).toMatchObject({ year: 2020, number: 53 });
    expect(
      currentCommercialWeek(new Date("2026-10-11T22:30:00Z")),
    ).toMatchObject({ number: 42, start: "2026-10-12" });
    expect(
      currentCommercialWeek(new Date("2026-03-29T21:59:00Z")),
    ).toMatchObject({ number: 13 });
    expect(
      currentCommercialWeek(new Date("2026-03-29T22:00:00Z")),
    ).toMatchObject({ number: 14 });
  });
  it("does not impose S41 document context on S42 or S43 sales", () => {
    for (const n of [42, 43])
      expect(
        commercialEntryWeekStatus(
          entry([
            ["weekLabel", `Semaine ${n}`],
            ["documentYear", "2026"],
          ]),
          week,
        ),
      ).toBe("OUTSIDE");
    expect(
      commercialEntryWeekStatus(
        entry([
          ["weekLabel", "Semaine 41"],
          ["documentYear", "2026"],
        ]),
        week,
      ),
    ).toBe("CURRENT");
    expect(
      commercialEntryWeekStatus(
        entry([
          ["weekLabel", "Semaines 43 et 44"],
          ["documentYear", "2026"],
        ]),
        week,
      ),
    ).toBe("OUTSIDE");
    expect(
      commercialEntryWeekStatus(
        entry([
          ["weekLabel", "Semaine 41"],
          ["documentYear", "2025"],
        ]),
        week,
      ),
    ).toBe("OUTSIDE");
  });
  it("uses actual sales interval overlap, even across two weeks", () => {
    expect(
      commercialEntryWeekStatus(
        entry([
          ["saleStart", "jeudi 8 octobre"],
          ["saleEnd", "mardi 13 octobre"],
          ["documentYear", "2026"],
        ]),
        week,
      ),
    ).toBe("CURRENT");
    expect(
      commercialEntryWeekStatus(
        entry([
          ["saleStart", "15/10/2026"],
          ["saleEnd", "17/10/2026"],
        ]),
        week,
      ),
    ).toBe("OUTSIDE");
    expect(
      commercialEntryWeekStatus(
        entry([
          ["saleStart", "2026-10-01"],
          ["saleEnd", "2026-10-04"],
        ]),
        week,
      ),
    ).toBe("OUTSIDE");
  });
  it("keeps a source S41 offer active in S42 when its actual sales period overlaps", () => {
    const next = currentCommercialWeek(new Date("2026-10-12T08:00:00Z"));
    expect(
      commercialEntryWeekStatus(
        entry([
          ["weekLabel", "S41"],
          ["documentYear", "2026"],
          ["saleStart", "jeudi 8 octobre"],
          ["saleEnd", "mardi 13 octobre"],
        ]),
        next,
      ),
    ).toBe("CURRENT");
  });
  it("excludes uncertain, impossible and contradictory periods without guessing a year", () => {
    for (const values of [
      [],
      [["weekLabel", "S41"]],
      [
        ["saleStart", "8 octobre"],
        ["saleEnd", "10 octobre"],
      ],
      [
        ["saleStart", "31/02/2026"],
        ["saleEnd", "10/10/2026"],
      ],
      [
        ["weekLabel", "En anticipation de commande semaine 42"],
        ["documentYear", "2026"],
      ],
      [
        ["saleStart", "lundi 8 octobre"],
        ["saleEnd", "samedi 10 octobre"],
        ["documentYear", "2026"],
      ],
    ] as Array<Array<[Fields[number]["name"], string]>>)
      expect(commercialEntryWeekStatus(entry(values), week)).toBe("UNKNOWN");
    expect(
      commercialEntryWeekStatus(
        entry([
          ["saleStart", "08/10/2026"],
          ["saleEnd", "10/10/2026"],
          ["weekLabel", "S42"],
          ["documentYear", "2026"],
        ]),
        week,
      ),
    ).toBe("UNKNOWN");
  });
  it("does not treat a low-confidence source week as a reliable current period", () => {
    const uncertain = entry([
      ["weekLabel", "S41"],
      ["documentYear", "2026"],
    ]);
    uncertain.fields[0]!.confidence = 0.3;
    expect(commercialEntryWeekStatus(uncertain, week)).toBe("UNKNOWN");
  });
  it("distinguishes current deadlines from future sales, without importing future prices", () => {
    const parent = entry([
      ["weekLabel", "S43"],
      ["documentYear", "2026"],
    ]);
    const item = entry([["preorderDeadline", "lundi 12 octobre"]]);
    expect(commercialDeadlineThisWeek(withParentYear(item, parent), week)).toBe(
      false,
    );
    expect(
      commercialDeadlineThisWeek(
        withParentYear(
          entry([["preorderDeadline", "lundi 5 octobre"]]),
          parent,
        ),
        week,
      ),
    ).toBe(true);
    expect(commercialEntryWeekStatus(parent, week)).toBe("OUTSIDE");
  });
  it("inherits actual parent periods for undated children, but honors a child's own period", () => {
    const parent = entry([
      ["weekLabel", "S41"],
      ["documentYear", "2026"],
    ]);
    expect(
      commercialItemWeekStatus(
        entry([["productLabel", "Raisin"]]),
        parent,
        week,
      ),
    ).toBe("CURRENT");
    expect(
      commercialItemWeekStatus(entry([["weekLabel", "S42"]]), parent, week),
    ).toBe("OUTSIDE");
  });
  it("scopes existing visual caches without deleting them and keeps only current anticipation deadlines", () => {
    const operation = (
      label: string,
      fields: Fields,
      items: CommercialVisualPageOutput["operations"][number]["items"] = [],
    ) => ({
      kind: "DRAMAT" as const,
      label,
      summaryFr: label,
      fields,
      evidence: [{ pageNumber: 1, quote: label, region: null }],
      items,
    });
    const instruction = {
      kind: "INSTRUCTION" as const,
      label: "Commande orange",
      evidence: [{ pageNumber: 1, quote: "lundi 5 octobre", region: null }],
      fields: entry([
        ["preorderDeadline", "lundi 5 octobre"],
        ["sellingPrice", "2,80€"],
      ]).fields,
    };
    const input: CommercialVisualPageOutput = {
      operations: [
        operation(
          "Raisin",
          entry([
            ["weekLabel", "S41"],
            ["documentYear", "2026"],
          ]).fields,
        ),
        operation(
          "Orange",
          entry([
            ["weekLabel", "S43"],
            ["documentYear", "2026"],
          ]).fields,
          [instruction],
        ),
      ],
      tgIdeas: [],
      otherInformation: [],
      warnings: [],
    };
    const before = JSON.stringify(input),
      result = scopeCommercialVisualReading(input, week);
    expect(result.operations.map((o) => o.label)).toEqual(["Raisin"]);
    expect(result.otherInformation).toHaveLength(1);
    expect(result.otherInformation[0]?.fields.map((f) => f.name)).not.toContain(
      "sellingPrice",
    );
    expect(JSON.stringify(input)).toBe(before);
  });
  it("uses explicit header dates only for unscoped TGs, never to make future offers current", () => {
    const reading: CommercialVisualPageOutput = {
      operations: [
        {
          kind: "OTHER",
          label: "Halloween",
          summaryFr: "Halloween",
          fields: entry([
            ["documentDate", "Du 5 au 11 octobre 2026"],
            ["weekLabel", "S43"],
            ["documentYear", "2026"],
          ]).fields,
          evidence: [{ pageNumber: 1, quote: "Halloween", region: null }],
          items: [],
        },
      ],
      tgIdeas: [
        {
          kind: "MERCHANDISING",
          label: "TG 1",
          fields: [],
          evidence: [{ pageNumber: 1, quote: "TG 1", region: null }],
        },
      ],
      otherInformation: [],
      warnings: [],
    };
    const context = commercialDocumentWeekContext([reading]);
    const result = scopeCommercialVisualReading(reading, week, context);
    expect(result.operations).toEqual([]);
    expect(result.tgIdeas).toHaveLength(1);
    reading.operations[0]!.fields = entry([
      ["documentDate", "Du 5 au 11 octobre"],
    ]).fields;
    expect(
      scopeCommercialVisualReading(
        reading,
        week,
        commercialDocumentWeekContext([reading]),
      ).tgIdeas,
    ).toEqual([]);
  });
});
