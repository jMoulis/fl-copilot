import { z } from "zod";
import {
  journalSourcePayloadSchema,
  type JournalSourcePayload,
} from "@fl-copilot/domain";
export const consumptionUrl =
  "https://www.franceagrimer.fr/chiffre-et-analyses-economiques/note-de-conjoncture-mensuelle-fruits-legumes-et-pommes-de-terre";
export const worksUrl =
  "https://asnieres-sur-seine.fr/vivre-a-asnieres/travaux";
export const agendaUrl = "https://asnieres-sur-seine.fr/agenda/ce-mois";
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
export const plainText = (s: string) =>
  s
    .replace(/<(script|style|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:nbsp|ensp|emsp);/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&euro;/g, "€")
    .replace(/&hellip;/g, "…")
    .replace(/&#(\d+);/g, (_, n: string) =>
      Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : " ",
    )
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const num = (s: string) => Number(s.replace(/\s/g, "").replace(",", "."));
export function parseConsumption(html: string): JournalSourcePayload {
  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(
    (m) => plainText(m[1]!),
  );
  const text = paragraphs.find((p) => /Concernant la consommation en/i.test(p));
  if (!text) throw Error("CONSUMPTION_SECTION_MISSING");
  const period = normalize(text).match(/consommation en ([a-z]+) (20\d{2})/);
  const month = months.indexOf(period?.[1] ?? "");
  if (!period || month < 0) throw Error("CONSUMPTION_PERIOD_UNKNOWN");
  // Fail closed when editorial wording changes: do not guess a missing number,
  // confuse another product's price or multiply averages into expenditure.
  const vegetables = text.match(
    /quantités de légumes achetées[^.]*?à\s*([\d,]+)\s*kg par ménage\s*\(([+−–-]?\s*[\d,]+)\s*%\)\s*avec un prix moyen en (hausse|baisse) de\s*([\d,]+)\s*%\s*\(([\d,]+)\s*€\/kg\)/i,
  );
  const fruits = text.match(
    /achats de fruits[^.]*?(progressent|reculent|baissent)[^.]*?([\d,]+)\s*%,?\s*à\s*([\d,]+)\s*kg par ménage avec un prix moyen en (hausse|baisse) de\s*([\d,]+)\s*%\s*\(([\d,]+)\s*€\/kg\)/i,
  );
  if (!vegetables || !fruits) throw Error("CONSUMPTION_FORMAT_CHANGED");
  const document = html.match(
    /Document principal<\/h2>\s*<a\b[^>]*href="([^"]+)"[^>]*title="([^"]+)"/i,
  );
  const reportUrl = document
    ? new URL(document[1]!, consumptionUrl).href
    : null;
  if (
    reportUrl &&
    !reportUrl.startsWith("https://www.franceagrimer.fr/sites/default/files/")
  )
    throw Error("CONSUMPTION_SOURCE_INVALID");
  const signed = (s: string) => num(s.replace(/[−–]/g, "-"));
  return journalSourcePayloadSchema.parse({
    items: [],
    consumption: {
      period: `${period[2]}-${String(month + 1).padStart(2, "0")}`,
      reportUrl,
      editionLabel: document
        ? plainText(document[2]!)
            .replace(" Ouverture dans un nouvel onglet", "")
            .slice(0, 180)
        : null,
      groups: [
        {
          group: "VEGETABLES",
          quantityKgPerHousehold: num(vegetables[1]!),
          quantityAnnualPercent: signed(vegetables[2]!),
          averagePriceEurPerKg: num(vegetables[5]!),
          priceAnnualPercent:
            num(vegetables[4]!) *
            (vegetables[3]!.toLowerCase() === "baisse" ? -1 : 1),
        },
        {
          group: "FRUITS",
          quantityKgPerHousehold: num(fruits[3]!),
          quantityAnnualPercent:
            num(fruits[2]!) *
            (fruits[1]!.toLowerCase() === "progressent" ? 1 : -1),
          averagePriceEurPerKg: num(fruits[6]!),
          priceAnnualPercent:
            num(fruits[5]!) * (fruits[4]!.toLowerCase() === "baisse" ? -1 : 1),
        },
      ],
    },
  });
}
/** Only explicit complete French dates are normalized; unknown periods stay null. */
export function explicitFrenchDates(text: string) {
  const aliases: Record<string, number> = {
    janv: 1,
    janvier: 1,
    fevr: 2,
    fevrier: 2,
    mars: 3,
    avr: 4,
    avril: 4,
    mai: 5,
    juin: 6,
    juil: 7,
    juillet: 7,
    aout: 8,
    sept: 9,
    septembre: 9,
    oct: 10,
    octobre: 10,
    nov: 11,
    novembre: 11,
    dec: 12,
    decembre: 12,
  };
  const found = [
    ...normalize(text).matchAll(/\b(\d{1,2})\s+([a-z]+)\.?\s+(20\d{2})\b/g),
  ].flatMap((m) => {
    const month = aliases[m[2]!];
    const date = `${m[3]}-${String(month).padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
    return month && z.iso.date().safeParse(date).success ? [date] : [];
  });
  return {
    startDate: found[0] ?? null,
    endDate: found.length === 2 ? found[1]! : null,
  };
}
export function parseAgenda(html: string): JournalSourcePayload {
  const cards = [
    ...html.matchAll(
      /<a\b[^>]*class="[^"]*card-agenda[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
    ),
  ];
  if (!cards.length) throw Error("AGENDA_FORMAT_CHANGED");
  const items = cards.slice(0, 12).map((m) => {
    const title = plainText(
      m[2]!.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? "",
    );
    const periodLabel = plainText(
      m[2]!.match(/<p\b[^>]*class="date"[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "",
    ).slice(0, 180);
    const url = new URL(m[1]!, agendaUrl);
    if (url.origin !== new URL(agendaUrl).origin || !title)
      throw Error("AGENDA_SOURCE_INVALID");
    const dates = explicitFrenchDates(periodLabel);
    // A single listed date may describe a recurring event, not a continuous interval.
    return {
      title: title.slice(0, 180),
      summary:
        "Événement annoncé par la ville ; horaires, lieu et éventuelles autres dates à vérifier dans la source.",
      sourceUrl: url.href,
      periodLabel,
      ...dates,
      endDate: dates.endDate ?? dates.startDate,
    };
  });
  return journalSourcePayloadSchema.parse({ items, consumption: null });
}
export function parseWorks(html: string): JournalSourcePayload {
  const body = html.match(
    /<div[^>]*class="ce-bodytext"[^>]*>([\s\S]*?)<\/div>/i,
  )?.[1];
  if (!body) throw Error("WORKS_FORMAT_CHANGED");
  const sections = [
    ...body.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2\b|$)/gi),
  ];
  const items = sections.slice(0, 12).map((m) => ({
    title: plainText(m[1]!).slice(0, 180),
    // Use a short source excerpt, not a model-authored assertion of impact.
    summary: plainText(m[2]!).slice(0, 420),
    sourceUrl: worksUrl,
    periodLabel:
      "Dates et créneaux dans l’annonce — présence au magasin non confirmée",
    startDate: null,
    endDate: null,
  }));
  if (!items.length) throw Error("WORKS_SECTION_MISSING");
  return journalSourcePayloadSchema.parse({ items, consumption: null });
}
export async function boundedHtml(response: Response) {
  if (!/text\/html/i.test(response.headers.get("content-type") ?? ""))
    throw Error("CONTEXT_NOT_HTML");
  if (Number(response.headers.get("content-length")) > 1_500_000)
    throw Error("CONTEXT_TOO_LARGE");
  const reader = response.body?.getReader();
  if (!reader) throw Error("CONTEXT_EMPTY_BODY");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 1_500_000) throw Error("CONTEXT_TOO_LARGE");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
