import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import {
  journalContextSchema,
  journalSourcePayloadSchema,
  type JournalContext,
  type JournalSource,
  type JournalSourcePayload,
  type StoreContextSettings,
  parisDate,
} from "@fl-copilot/domain";
import { ContextProviderCache } from "./provider-cache.js";
import {
  consumptionUrl,
  worksUrl,
  agendaUrl,
  parseConsumption,
  parseWorks,
  parseAgenda,
  boundedHtml,
} from "./journal-sources.js";
type Revision = {
  url: string;
  snapshotOf: string;
  revision: string;
  firstCapturedAt: string;
  payload: JournalSourcePayload;
};
/** Immutable normalized public-source revisions share the existing cache namespace.
 * They are not operational store facts and never participate in business sync. */
export async function readJournalContext(
  db: Db,
  cache: ContextProviderCache,
  settings: StoreContextSettings,
  weekEnd: string,
  now: Date,
): Promise<JournalContext> {
  const local =
    settings.postalCode === "92600" &&
    settings.city
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z]/g, "") === "asnieressurseine";
  const specs = [
    {
      kind: "WORKS" as const,
      url: worksUrl,
      provider: "Ville d’Asnières-sur-Seine",
      parse: parseWorks,
      enabled: local,
      ttl: 6 * 3600000,
    },
    {
      kind: "AGENDA" as const,
      url: agendaUrl,
      provider: "Ville d’Asnières-sur-Seine",
      parse: parseAgenda,
      enabled: local,
      ttl: 6 * 3600000,
    },
    {
      kind: "CONSUMPTION" as const,
      url: consumptionUrl,
      provider: "FranceAgriMer · consommation",
      parse: parseConsumption,
      enabled: true,
      ttl: 86400000,
    },
  ];
  const snapshots = db.collection<Revision>("contextProviderCache");
  const results = await Promise.all(
    specs.map(async (spec): Promise<JournalSource> => {
      const base: JournalSource = {
        kind: spec.kind,
        status: spec.enabled ? "UNAVAILABLE" : "NOT_CONFIGURED",
        provider: spec.provider,
        sourceUrl: spec.url,
        retrievedAt: null,
        validUntil: null,
        firstCapturedAt: null,
        revision: null,
        issue: spec.enabled ? "PROVIDER_UNAVAILABLE" : "LOCATION_NOT_SUPPORTED",
        payload: null,
        history: [],
      };
      if (!spec.enabled) return base;
      try {
        const result = await cache.read(
          spec.url,
          journalSourcePayloadSchema,
          spec.ttl,
          {
            accept: "text/html",
            respectExpires: false,
            decode: async (r) => spec.parse(await boundedHtml(r)),
          },
        );
        if (result.data && !result.failed && result.retrievedAt) {
          const revision = createHash("sha256")
            .update(JSON.stringify(result.data))
            .digest("hex");
          // One revision per day/content: 304/cache hits preserve the first capture.
          const url = `journal-snapshot:${spec.url}:${result.retrievedAt.slice(0, 10)}:${revision}`;
          await snapshots.updateOne(
            { url },
            {
              $setOnInsert: {
                url,
                snapshotOf: spec.url,
                revision,
                firstCapturedAt: result.retrievedAt,
                payload: result.data,
              },
            },
            { upsert: true },
          );
        }
        const past =
          spec.kind !== "CONSUMPTION" && weekEnd < parisDate(now.toISOString());
        const query = {
          snapshotOf: spec.url,
          ...(spec.kind === "CONSUMPTION"
            ? { "payload.consumption.period": { $lte: weekEnd.slice(0, 7) } }
            : {}),
          ...(past
            ? {
                firstCapturedAt: {
                  $lt: new Date(
                    Date.parse(`${weekEnd}T00:00:00Z`) + 86400000,
                  ).toISOString(),
                },
              }
            : {}),
        };
        // Narrow the conservative UTC upper bound to the Paris calendar below.
        const history = await snapshots
          .find(query)
          .sort({ firstCapturedAt: -1 })
          .limit(12)
          .toArray();
        const valid = history.flatMap((row) => {
          const parsed = journalSourcePayloadSchema.safeParse(row.payload);
          if (
            !parsed.success ||
            (past && parisDate(row.firstCapturedAt) > weekEnd) ||
            (parsed.data.consumption &&
              parsed.data.consumption.period > weekEnd.slice(0, 7))
          )
            return [];
          return [
            {
              revision: row.revision,
              firstCapturedAt: row.firstCapturedAt,
              payload: parsed.data,
            },
          ];
        });
        const selected = valid[0];
        return {
          ...base,
          status: selected
            ? past || result.failed
              ? "STALE"
              : "AVAILABLE"
            : "UNAVAILABLE",
          issue: selected
            ? result.failed
              ? "PROVIDER_UNAVAILABLE"
              : null
            : past
              ? "HISTORY_UNAVAILABLE"
              : "PROVIDER_UNAVAILABLE",
          retrievedAt: result.retrievedAt,
          validUntil: result.validUntil,
          firstCapturedAt: selected?.firstCapturedAt ?? null,
          revision: selected?.revision ?? null,
          payload: selected?.payload ?? null,
          history: valid
            .filter(
              (row, index) =>
                valid.findIndex((v) => v.revision === row.revision) === index,
            )
            .slice(0, 6),
        };
      } catch {
        return base;
      }
    }),
  );
  return journalContextSchema.parse({
    sources: results,
    transport: "NOT_CONFIGURED",
  });
}
