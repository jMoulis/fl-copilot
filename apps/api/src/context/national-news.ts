import { DOMParser } from "@xmldom/xmldom";
import {
  journalSourcePayloadSchema,
  type JournalSourcePayload,
  type JournalSource,
} from "@fl-copilot/domain";
import { explicitFrenchDates, plainText } from "./journal-sources.js";
const socialUrl = "https://www.cgt.fr/comm-de-presse";
const restrictionsUrl = "https://www.ecologie.gouv.fr/rss-actualites.xml";
const normalized = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
function safeUrl(value: string, base: string) {
  if (!value.trim()) throw Error("NEWS_SOURCE_INVALID");
  const url = new URL(value, base);
  if (url.origin !== new URL(base).origin || url.username || url.password)
    throw Error("NEWS_SOURCE_INVALID");
  url.hash = "";
  for (const key of [...url.searchParams.keys()])
    if (/^utm_|^(fbclid|gclid)$/.test(key)) url.searchParams.delete(key);
  return url.href;
}
function publication(raw: string) {
  const value = Date.parse(raw);
  return Number.isFinite(value) ? new Date(value).toISOString() : null;
}
function item(
  title: string,
  summary: string,
  sourceUrl: string,
  publishedAt: string | null,
  social: boolean,
) {
  // Only an explicit full date in a single-day headline is safe to assign.
  // Other date prose remains visible verbatim; publication is never event date.
  const dates = explicitFrenchDates(title);
  const singleDay =
    social &&
    (title.match(/20\d{2}/g) ?? []).length === 1 &&
    !/\d\s*(?:et|,|[-–])/.test(title) &&
    dates.startDate &&
    !dates.endDate &&
    !/\b(du|au|jusqu|depuis|partir|reconductible)\b/i.test(title);
  return {
    title: title.slice(0, 180),
    summary: summary.slice(0, 420),
    sourceUrl,
    publishedAt,
    scopeLabel: social
      ? "Appel national/interprofessionnel attribué à la CGT ; participation locale non établie."
      : "Annonce ministérielle ; territoires et axes précisés dans la source, application au magasin non établie.",
    periodLabel: [title, summary].join(" — ").slice(0, 180),
    startDate: singleDay ? dates.startDate : null,
    endDate: singleDay ? dates.startDate : null,
  };
}
function payload(items: JournalSourcePayload["items"]) {
  const unique = new Map(items.map((i) => [i.sourceUrl, i]));
  return journalSourcePayloadSchema.parse({
    items: [...unique.values()]
      .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
      .slice(0, 12),
    consumption: null,
  });
}
export function parseNationalSocial(html: string): JournalSourcePayload {
  const cards = [
    ...html.matchAll(
      /<h3\b[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)<time\b[^>]*datetime="([^"]+)"[^>]*>/gi,
    ),
  ];
  if (!cards.length || cards.length > 100)
    throw Error("NEWS_SOCIAL_FORMAT_CHANGED");
  return payload(
    cards.flatMap((m) => {
      if (/<h3\b/i.test(m[2]!)) throw Error("NEWS_SOCIAL_FORMAT_CHANGED");
      const link = m[1]!.match(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!link) return [];
      const title = plainText(link[2]!);
      const summary = plainText(
        m[2]!.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "",
      );
      const text = normalized(`${title} ${summary}`);
      if (
        !/greve|mobilisation|mouvement social|blocage/.test(text) ||
        !/\bnation(?:al|ale|aux|ales)\b|\binterprofessionnel(?:le|les|s)?\b|public et (?:le )?prive/.test(
          text,
        )
      )
        return [];
      return [
        item(
          title,
          summary,
          safeUrl(link[1]!, socialUrl),
          publication(m[3]!),
          true,
        ),
      ];
    }),
  );
}
export function parseNationalRestrictions(xml: string): JournalSourcePayload {
  if (Buffer.byteLength(xml) > 1_500_000 || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw Error("NEWS_XML_INVALID");
  const doc = new DOMParser({
    onError() {
      throw Error("NEWS_XML_INVALID");
    },
  }).parseFromString(xml, "text/xml");
  if (
    doc.documentElement?.tagName !== "rss" ||
    doc.getElementsByTagName("channel").length !== 1
  )
    throw Error("NEWS_XML_INVALID");
  const rows = Array.from(doc.getElementsByTagName("item"));
  if (rows.length > 100) throw Error("NEWS_XML_TOO_MANY_ITEMS");
  return payload(
    rows.flatMap((row) => {
      const field = (name: string) =>
        plainText(row.getElementsByTagName(name)[0]?.textContent ?? "");
      const title = field("title"),
        summary = field("description"),
        text = normalized(`${title} ${summary}`);
      if (
        !/fermeture|blocage|restriction|interruption|interdiction de circul/.test(
          text,
        ) ||
        !/autoroute|circulation|transport|routier|approvisionnement|logistique|ferroviaire/.test(
          text,
        )
      )
        return [];
      return [
        item(
          title,
          summary,
          safeUrl(field("link"), restrictionsUrl),
          publication(field("pubDate")),
          false,
        ),
      ];
    }),
  );
}
export const nationalSourceSpecs: {
  kind: JournalSource["kind"];
  url: string;
  provider: string;
  parse: (s: string) => JournalSourcePayload;
  enabled: boolean;
  ttl: number;
  accept?: string;
}[] = [
  {
    kind: "NATIONAL_SOCIAL",
    url: socialUrl,
    provider: "CGT · appels publiés",
    parse: parseNationalSocial,
    enabled: true,
    ttl: 6 * 3600000,
  },
  {
    kind: "NATIONAL_RESTRICTIONS",
    url: restrictionsUrl,
    provider: "Ministère chargé des Transports",
    parse: parseNationalRestrictions,
    enabled: true,
    ttl: 6 * 3600000,
    accept: "application/rss+xml, application/xml, text/xml",
  },
];
