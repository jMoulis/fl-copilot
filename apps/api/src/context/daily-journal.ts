import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import {
  addContextDays,
  dailyJournalContextSchema,
  parisDate,
  storeContextFingerprint,
  storeContextSettingsSchema,
  weeklyContextSchema,
  type DailyJournalContext,
  type StoreContextSettings,
  type WeeklyContext,
} from "@fl-copilot/domain";
import type { DatabaseService } from "../database/types.js";
import type { WeekContextService } from "./week-context.js";

/** Geography/selection, not an unrelated settings version, binds the archive. */
export function dailyJournalScope(s: StoreContextSettings) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        s.storeId,
        s.city,
        s.postalCode,
        s.schoolZone,
        s.locationMode,
        s.position,
        s.transports ?? null,
      ]),
    )
    .digest("hex");
}
export function contextMonday(date: string) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addContextDays(date, -((weekday + 6) % 7));
}
const namespace = (storeId: string, scope: string) =>
  `journal-daily:${storeId}:${scope}`;
function retained<T extends { status: string }>(
  old: T | undefined,
  next: T,
): T {
  return old &&
    next.status === "UNAVAILABLE" &&
    (old.status === "AVAILABLE" || old.status === "STALE")
    ? { ...old, status: "STALE" }
    : next;
}
function distinct<T>(rows: T[], key: (row: T) => string, limit: number): T[] {
  const map = new Map<string, T>();
  for (const row of rows) if (!map.has(key(row))) map.set(key(row), row);
  return [...map.values()].slice(0, limit);
}

/** Retain known data on outages, with its real source time. Not last-write-wins
 * for business data: these are bounded derived public-source projections only. */
export function mergeDailyWeek(
  old: WeeklyContext | undefined,
  next: WeeklyContext,
): WeeklyContext {
  if (!old) return weeklyContextSchema.parse(next);
  if (old.storeId !== next.storeId || old.weekStart !== next.weekStart)
    throw Error("DAILY_JOURNAL_SCOPE_INVALID");
  const merged = structuredClone(next);
  merged.publicHolidays = retained(old.publicHolidays, next.publicHolidays);
  merged.schoolHolidays = retained(old.schoolHolidays, next.schoolHolidays);
  merged.weather = retained(old.weather, next.weather);
  if (next.weather.status !== "UNAVAILABLE") {
    const oldDays = old.weather.days.filter(
      (d) => !next.weather.days.some((n) => n.validDate === d.validDate),
    );
    merged.weather.days = [...next.weather.days, ...oldDays].sort((a, b) =>
      a.validDate.localeCompare(b.validDate),
    );
    if (oldDays.length) {
      merged.weather.status = "STALE";
      merged.weather.validUntil =
        [old.weather.validUntil, next.weather.validUntil]
          .filter((s): s is string => !!s)
          .sort()[0] ?? null;
    }
  }
  if (next.economy) merged.economy = retained(old.economy, next.economy);
  else if (old.economy) merged.economy = { ...old.economy, status: "STALE" };
  if (next.observedWeather) {
    merged.observedWeather = retained(
      old.observedWeather,
      next.observedWeather,
    );
    if (
      old.observedWeather &&
      next.observedWeather.status !== "UNAVAILABLE" &&
      old.observedWeather.reference?.station.id ===
        next.observedWeather.reference?.station.id
    ) {
      merged.observedWeather.days = distinct(
        [...next.observedWeather.days, ...old.observedWeather.days],
        (d) => d.producerDate,
        7,
      ).sort((a, b) => a.producerDate.localeCompare(b.producerDate));
    }
  } else if (old.observedWeather)
    merged.observedWeather = { ...old.observedWeather, status: "STALE" };
  if (next.journal) {
    merged.journal = structuredClone(next.journal);
    merged.journal.sources = next.journal.sources.map((s) => {
      const prior = old.journal?.sources.find((p) => p.kind === s.kind);
      const value = retained(prior, s);
      return {
        ...value,
        history: distinct(
          [...s.history, ...(prior?.history ?? [])].sort((a, b) =>
            b.firstCapturedAt.localeCompare(a.firstCapturedAt),
          ),
          (h) => `${h.firstCapturedAt}:${h.revision}`,
          12,
        ),
      };
    });
    const current = next.journal.transport,
      previous = old.journal?.transport;
    if (
      typeof current !== "string" &&
      previous &&
      typeof previous !== "string"
    ) {
      const traffic = structuredClone(current);
      traffic.lines = current.lines.map((line) => {
        const prior = previous.lines.find((l) => l.id === line.id);
        const value = retained(prior, line);
        const captures = [
          ...(line.history ?? []),
          ...(prior?.history ?? []),
          ...(prior?.capturedAt
            ? [
                {
                  capturedAt: prior.capturedAt,
                  disruptions: prior.disruptions.slice(0, 3),
                  partial: prior.partial || prior.disruptions.length > 3,
                },
              ]
            : []),
        ].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
        const history = distinct(captures, (h) => h.capturedAt, 7);
        return {
          ...value,
          history,
          partial:
            value.partial ||
            new Set(captures.map((h) => h.capturedAt)).size > 7,
        };
      });
      merged.journal.transport = traffic;
    }
  } else if (old.journal) {
    merged.journal = structuredClone(old.journal);
    for (const source of merged.journal.sources)
      if (source.status === "AVAILABLE") source.status = "STALE";
    const transport = merged.journal.transport;
    if (typeof transport !== "string") {
      if (transport.status === "AVAILABLE") transport.status = "STALE";
      for (const line of transport.lines)
        if (line.status === "AVAILABLE") line.status = "STALE";
    }
  }
  return weeklyContextSchema.parse(merged);
}

export function projectContext(
  context: WeeklyContext,
  symbols: boolean,
  economy: boolean,
  observed: boolean,
  journal: boolean,
): WeeklyContext {
  const result = structuredClone(context);
  if (!symbols)
    result.weather.days = result.weather.days.map(({ symbol, ...day }) => {
      void symbol;
      return day;
    });
  if (!economy) delete result.economy;
  if (!observed) delete result.observedWeather;
  if (!journal) delete result.journal;
  return result;
}

/** At most 23 daily entries: previous/current/next week captures, indexed by
 * the existing source/date index. Never invokes a network/provider/AI client. */
export async function readDailyJournalWeek(
  db: Db,
  settings: StoreContextSettings,
  weekStart: string,
): Promise<WeeklyContext | null> {
  const scope = dailyJournalScope(settings);
  const source = namespace(settings.storeId, scope);
  const rows = await db
    .collection("contextProviderCache")
    .find({
      snapshotOf: source,
      firstCapturedAt: {
        $gte: `${addContextDays(weekStart, -8)}T00:00:00.000Z`,
        $lt: `${addContextDays(weekStart, 15)}T00:00:00.000Z`,
      },
    })
    .sort({ firstCapturedAt: -1 })
    .limit(23)
    .toArray();
  let result: WeeklyContext | undefined;
  for (const row of rows.reverse()) {
    const parsed = dailyJournalContextSchema.safeParse(row.entry);
    if (
      !parsed.success ||
      parsed.data.storeId !== settings.storeId ||
      parsed.data.scope !== scope
    )
      continue;
    const context = parsed.data.contexts.find((c) => c.weekStart === weekStart);
    if (context) result = mergeDailyWeek(result, context);
  }
  if (!result) return null;
  return { ...result, settingsFingerprint: storeContextFingerprint(settings) };
}

/** One retained entry per shop/capture day. Existing immutable public-source
 * revisions retain original messages; this entry consolidates three week windows
 * to include delayed observations and next-week forecasts without extra AI calls. */
export async function collectDailyJournal(
  database: DatabaseService,
  service: WeekContextService,
  storeId: string,
  at = new Date(),
) {
  const db = await database.getDb();
  const load = async () => {
    const raw = await db
      .collection("storeContextSettings")
      .findOne({ storeId });
    if (!raw) throw Error("JOURNAL_STORE_SETTINGS_MISSING");
    const { _id, ...payload } = raw;
    void _id;
    return storeContextSettingsSchema.parse(payload);
  };
  const settings = await load(),
    scope = dailyJournalScope(settings);
  const date = parisDate(at.toISOString()),
    monday = contextMonday(date);
  const source = namespace(storeId, scope),
    url = `${source}:${date}`;
  const collection = db.collection("contextProviderCache");
  const existing = await collection.findOne({ url });
  const old = dailyJournalContextSchema.safeParse(existing?.entry);
  if (existing && !old.success) throw Error("JOURNAL_ARCHIVE_INVALID");
  if (old.success && old.data.lastCollectedAt >= at.toISOString())
    return { storeId, date, status: "ALREADY_COLLECTED" as const };
  const contexts: WeeklyContext[] = [];
  // Sequential windows share provider cache. Per-source outages are independent.
  for (const offset of [-7, 0, 7]) {
    const start = addContextDays(monday, offset);
    const next = await service.read(storeId, start, true, true, true, true);
    if (
      next.storeId !== storeId ||
      next.weekStart !== start ||
      next.settingsFingerprint !== storeContextFingerprint(settings)
    )
      throw Error("JOURNAL_CONTEXT_SCOPE_CHANGED");
    contexts.push(
      mergeDailyWeek(
        old.success
          ? old.data.contexts.find((c) => c.weekStart === start)
          : undefined,
        next,
      ),
    );
  }
  if (dailyJournalScope(await load()) !== scope)
    throw Error("JOURNAL_SETTINGS_CHANGED");
  const entry: DailyJournalContext = dailyJournalContextSchema.parse({
    version: 1,
    storeId,
    scope,
    date,
    firstCollectedAt: old.success
      ? old.data.firstCollectedAt
      : at.toISOString(),
    lastCollectedAt: at.toISOString(),
    contexts,
  });
  // Unique URL index plus CAS: duplicate/concurrent retries cannot overwrite a
  // newer collection. No operational store/source/Outbox record is changed.
  if (!old.success) {
    try {
      const write = await collection.updateOne(
        { url },
        {
          $setOnInsert: {
            url,
            snapshotOf: source,
            firstCapturedAt: entry.firstCollectedAt,
            entry,
          },
        },
        { upsert: true },
      );
      if (!write.upsertedCount) throw Error("JOURNAL_COLLECTION_RETRY");
    } catch (e) {
      if (!(
        typeof e === "object" &&
        e !== null &&
        "code" in e &&
        e.code === 11000
      ))
        throw e;
      throw Error("JOURNAL_COLLECTION_RETRY");
    }
  } else {
    const write = await collection.updateOne(
      { url, "entry.lastCollectedAt": old.data.lastCollectedAt },
      { $set: { entry } },
    );
    if (!write.matchedCount) throw Error("JOURNAL_COLLECTION_RETRY");
  }
  return { storeId, date, status: "COLLECTED" as const };
}
