import type { CommercialVisualPageOutput } from "@fl-copilot/domain";
const DAY = 86400000;
export type CommercialWeek = {
  year: number;
  number: number;
  start: string;
  end: string;
  date: string;
};
function iso(date: Date) {
  return date.toISOString().slice(0, 10);
}
export function currentCommercialWeek(now: Date = new Date()): CommercialWeek {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  const date = new Date(
    `${part("year")}-${part("month")}-${part("day")}T00:00:00Z`,
  );
  const start = new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * DAY);
  const thursday = new Date(start.getTime() + 3 * DAY);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const firstMonday = jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY;
  return {
    year,
    number: Math.round((start.getTime() - firstMonday) / (7 * DAY)) + 1,
    start: iso(start),
    end: iso(new Date(start.getTime() + 6 * DAY)),
    date: iso(date),
  };
}
type Entry = {
  fields: CommercialVisualPageOutput["operations"][number]["fields"];
};
const months = [
  "janvier",
  "fevrier",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "aout",
  "septembre",
  "octobre",
  "novembre",
  "decembre",
];
function normalized(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
function values(entry: Entry, name: string) {
  return entry.fields
    .filter(
      (f) => f.name === name && f.rawValue !== null && f.confidence >= 0.8,
    )
    .map((f) => f.rawValue!);
}
function sourceYear(entry: Entry) {
  const years = [
    ...new Set(
      values(entry, "documentYear")
        .filter((v) => /^(19|20)\d{2}$/.test(v))
        .map(Number),
    ),
  ];
  return years.length === 1 ? years[0] : undefined;
}
function sourceDate(value: string, year?: number): string | undefined {
  const text = normalized(value);
  let day: number, month: number, actualYear: number | undefined;
  const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const french = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const written = text.match(
    /^(?:(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+)?(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/,
  );
  if (isoDate) {
    actualYear = Number(isoDate[1]);
    month = Number(isoDate[2]);
    day = Number(isoDate[3]);
  } else if (french) {
    day = Number(french[1]);
    month = Number(french[2]);
    actualYear = Number(french[3]);
  } else if (written) {
    day = Number(written[2]);
    month = months.indexOf(written[3]!) + 1;
    actualYear = written[4] ? Number(written[4]) : year;
  } else return undefined;
  if (!actualYear || month < 1 || month > 12 || day < 1 || day > 31)
    return undefined;
  const date = new Date(Date.UTC(actualYear, month - 1, day));
  if (
    date.getUTCFullYear() !== actualYear ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return undefined;
  if (
    written?.[1] &&
    ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"][
      date.getUTCDay()
    ] !== written[1]
  )
    return undefined;
  return iso(date);
}
function uniqueDate(entry: Entry, name: string, year?: number) {
  const raw = values(entry, name);
  const dates = raw.map((v) => sourceDate(v, year));
  return raw.length && dates.every(Boolean) && new Set(dates).size === 1
    ? dates[0]
    : undefined;
}
function weeks(entry: Entry, year?: number) {
  const raw = values(entry, "weekLabel");
  if (!year || !raw.length) return undefined;
  const numbers: number[] = [];
  for (const value of raw) {
    const text = normalized(value);
    // A preorder/delivery week is not a sales week.
    if (/anticip|command|livrai/.test(text)) return undefined;
    const match = text.match(
      /^(?:s(?:emaines?)?\s*)?(\d{1,2})(?:\s*(?:et|a|[-–/])\s*(?:s(?:emaine)?\s*)?(\d{1,2}))?(?:\s*(?:[/-]\s*)?((?:19|20)\d{2}))?$/,
    );
    if (!match || (match[3] && Number(match[3]) !== year)) return undefined;
    const from = Number(match[1]),
      to = match[2] ? Number(match[2]) : from;
    if (from < 1 || to > 53 || to < from) return undefined;
    for (let n = from; n <= to; n++) numbers.push(n);
  }
  return { year, numbers };
}
export type CommercialWeekStatus = "CURRENT" | "OUTSIDE" | "UNKNOWN";
export function commercialEntryWeekStatus(
  entry: Entry,
  week: CommercialWeek,
): CommercialWeekStatus {
  const year = sourceYear(entry),
    saleWeeks = weeks(entry, year);
  const starts = values(entry, "saleStart"),
    ends = values(entry, "saleEnd");
  if (starts.length && ends.length) {
    const start = uniqueDate(entry, "saleStart", year),
      end = uniqueDate(entry, "saleEnd", year);
    if (!start || !end || start > end) return "UNKNOWN";
    const current = start <= week.end && end >= week.start;
    if (
      saleWeeks &&
      !saleWeeks.numbers.some((number) => {
        const jan4 = new Date(Date.UTC(saleWeeks.year, 0, 4));
        const monday = new Date(
          jan4.getTime() -
            ((jan4.getUTCDay() + 6) % 7) * DAY +
            (number - 1) * 7 * DAY,
        );
        return (
          start <= iso(new Date(monday.getTime() + 6 * DAY)) &&
          end >= iso(monday)
        );
      })
    )
      return "UNKNOWN";
    return current ? "CURRENT" : "OUTSIDE";
  }
  if (
    (starts.length && !uniqueDate(entry, "saleStart", year)) ||
    (ends.length && !uniqueDate(entry, "saleEnd", year))
  )
    return "UNKNOWN";
  if (saleWeeks)
    return saleWeeks.year === week.year &&
      saleWeeks.numbers.includes(week.number)
      ? "CURRENT"
      : "OUTSIDE";
  return "UNKNOWN";
}
export function commercialDeadlineThisWeek(entry: Entry, week: CommercialWeek) {
  return ["preorderDeadline", "executionDeadline"].some((name) => {
    const date = uniqueDate(entry, name, sourceYear(entry));
    return !!date && date >= week.start && date <= week.end;
  });
}

export function commercialItemWeekStatus(
  item: Entry,
  parent: Entry,
  week: CommercialWeek,
): CommercialWeekStatus {
  if (
    !["weekLabel", "saleStart", "saleEnd"].some(
      (name) => values(item, name).length,
    )
  )
    return commercialEntryWeekStatus(parent, week);
  return commercialEntryWeekStatus(withParentYear(item, parent), week);
}
export function withParentYear(item: Entry, parent: Entry): Entry {
  return {
    fields: values(item, "documentYear").length
      ? item.fields
      : [
          ...item.fields,
          ...parent.fields.filter((f) => f.name === "documentYear"),
        ],
  };
}
// Only unscoped TG ideas may use the explicitly cited document header.
// An offer must always keep its own commercial period.
export function commercialDocumentWeekContext(
  readings: readonly CommercialVisualPageOutput[],
): Entry {
  const headers = readings
    .flatMap((r) => r.operations)
    .flatMap((o) => values(o, "documentDate"));
  const contexts = headers.flatMap((raw) => {
    const match = normalized(raw).match(
      /^du\s+(\d{1,2})\s+au\s+(\d{1,2})\s+([a-z]+)\s+(\d{4})$/,
    );
    if (!match) return [];
    const start = sourceDate(`${match[1]} ${match[3]} ${match[4]}`),
      end = sourceDate(`${match[2]} ${match[3]} ${match[4]}`);
    if (!start || !end || start > end) return [];
    const first = currentCommercialWeek(new Date(`${start}T12:00:00Z`)),
      last = currentCommercialWeek(new Date(`${end}T12:00:00Z`));
    return first.year === last.year && first.number === last.number
      ? [first]
      : [];
  });
  const keys = [...new Set(contexts.map((c) => `${c.year}:${c.number}`))];
  const context = keys.length === 1 ? contexts[0] : undefined;
  // Derived calendar context is used only by this projection, never persisted as source text.
  return {
    fields: context
      ? [
          {
            name: "weekLabel",
            rawValue: `Semaine ${context.number}`,
            confidence: 1,
            evidence: [],
          },
          {
            name: "documentYear",
            rawValue: String(context.year),
            confidence: 1,
            evidence: [],
          },
        ]
      : [],
  };
}
export function scopeCommercialVisualReading<
  T extends CommercialVisualPageOutput,
>(reading: T, week: CommercialWeek, documentContext: Entry = { fields: [] }) {
  const operations = reading.operations
    .filter((o) => commercialEntryWeekStatus(o, week) === "CURRENT")
    .map((o) => ({
      ...o,
      items: o.items.filter(
        (i) => commercialItemWeekStatus(i, o, week) === "CURRENT",
      ),
    }));
  const tgIdeas = reading.tgIdeas.filter(
    (i) => commercialItemWeekStatus(i, documentContext, week) === "CURRENT",
  );
  const otherInformation = reading.otherInformation.filter(
    (i) =>
      commercialEntryWeekStatus(i, week) === "CURRENT" ||
      commercialDeadlineThisWeek(i, week),
  );
  const anticipated = reading.operations
    .filter((o) => commercialEntryWeekStatus(o, week) !== "CURRENT")
    .flatMap((o) =>
      o.items
        .filter((i) => commercialDeadlineThisWeek(withParentYear(i, o), week))
        .map((i) => ({
          ...i,
          kind: "INSTRUCTION" as const,
          label: `À anticiper · ${o.label}`.slice(0, 240),
          fields: withParentYear(i, o).fields.filter((f) =>
            [
              "preorderDeadline",
              "executionDeadline",
              "instruction",
              "documentYear",
              "weekLabel",
            ].includes(f.name),
          ),
        })),
    );
  return {
    ...reading,
    operations,
    tgIdeas,
    otherInformation: [...otherInformation, ...anticipated].slice(0, 40),
  };
}

export {
  sourceDate as commercialSourceDate,
  sourceYear as commercialSourceYear,
};
