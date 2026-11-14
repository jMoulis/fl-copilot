import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import { z } from "zod";
import {
  addContextDays,
  parisDate,
  selectStoreEventTime,
  weeklyContextSchema,
  journalAssociationInputSchema,
  journalAssociationStudySchema,
  copilotEvidenceSchema,
  type WeeklyContext,
} from "@fl-copilot/domain";
import {
  aggregateAnalyticsDailyPoints,
  compareJMinus7,
  compareYearOverYear,
  previousIsoYearDate,
  describeJournalAssociations,
  weatherDifference,
  type AnalyticsQueryPoint,
  type DatedKpiValue,
} from "@fl-copilot/analytics-core";
import { departmentEvidencePerformanceSchema } from "./daily-evidence.js";
import { performanceSchema as productEvidencePerformanceSchema } from "./analytics-query-tool.js";
import type { WeekContextService } from "../context/week-context.js";
import { contextMonday } from "../context/daily-journal.js";
import {
  serializeStoreProductEvent,
  type StoreProductEventDocument,
} from "../store-product-event-sync.js";

export const journalAssociationResultSchema =
  journalAssociationStudySchema.extend({
    evidence: z.array(copilotEvidenceSchema).max(5),
  });
const warnings = [
  "Étude descriptive exploratoire, ni causalité, ni prévision, ni gain attribuable. Les quatre associations sont rendues, sans sélection de la meilleure.",
  "21 paires et 4 semaines sont une règle de restitution, pas un seuil de significativité. Les journées sont dépendantes ; les retraits de semaine ne sont pas des intervalles de confiance.",
  "Prix, promotions, assortiment, trafic et ruptures non déclarées ne sont pas ajustés. L'absence de signalement ne prouve pas une disponibilité ; la variante sans signalements n'isole pas un effet météo.",
  "Seules les mesures météo observées qualifiées sont utilisées. Pluie de 06 h UTC à 06 h UTC le lendemain, pas uniquement pendant l'ouverture. Station proche non certifiée représentative du magasin.",
  "Calendriers connus et identiques exigés ; chiffres AVAILABLE des deux côtés. Manquants et références nulles/zéro non estimés. Les indices économiques mensuels ne sont pas corrélés aux journées.",
  "Sources révisées consultées aujourd'hui, pas reconstitution de ce qui était connu à la date passée. Les familles reposent sur le catalogue actuel, pas sa composition historique.",
];
/** Read-only: bounded canonical snapshots and retained Journal; never a provider request. */
export async function readJournalAssociations(
  db: Db,
  service: WeekContextService,
  storeId: string,
  raw: unknown,
  now = new Date(),
) {
  z.uuid().parse(storeId);
  const query = journalAssociationInputSchema.parse(raw);
  if (query.endDate >= parisDate(now.toISOString()))
    throw Error("JOURNAL_STUDY_UNCLOSED_DAY");
  if (!service.readStored) throw Error("JOURNAL_STUDY_STORED_READER_REQUIRED");
  const dates: string[] = [];
  for (let d = query.startDate; d <= query.endDate; d = addContextDays(d, 1))
    dates.push(d);
  const reference = new Map(
    dates.map((d) => [
      d,
      query.referenceMode === "YEAR_OVER_YEAR"
        ? previousIsoYearDate(d)
        : addContextDays(d, -7),
    ]),
  );
  const allDates = [
    ...new Set(
      [...dates, ...reference.values()].filter((v): v is string => v !== null),
    ),
  ].sort();
  const provenance: unknown[] = [storeId, query];
  const base = {
    version: "journal-spearman-v1" as const,
    query,
    scope: query.familyId
      ? ("CURRENT_PRODUCT_FAMILY" as const)
      : ("DEPARTMENT" as const),
    requestedDays: dates.length,
    policy: { minimumPairs: 21 as const, minimumWeeks: 4 as const },
    stationIds: [] as string[],
    warnings,
  };
  const limited = () =>
    journalAssociationResultSchema.parse({
      ...base,
      status: "LIMIT_EXCEEDED",
      series: [],
      evidence: [],
    });
  const metrics = {
    sales: new Map<string, DatedKpiValue>(),
    margin: new Map<string, DatedKpiValue>(),
  };
  let productIds: string[] | null = null;
  if (query.familyId) {
    const products = await db
      .collection<{ _id: string; storeId: string; familyId: string }>(
        "products",
      )
      .find(
        { storeId, familyId: query.familyId },
        { projection: { _id: 1, storeId: 1, familyId: 1 } },
      )
      .sort({ _id: 1 })
      .maxTimeMS(3000)
      .limit(10001)
      .toArray();
    if (products.length > 10000) return limited();
    if (
      products.some(
        (p) => p.storeId !== storeId || p.familyId !== query.familyId,
      )
    )
      throw Error("JOURNAL_STUDY_SCOPE_INVALID");
    productIds = products.map((p) => z.uuid().parse(p._id));
    provenance.push(products);
  }
  type Row = {
    _id: string;
    storeId: string;
    productId?: string;
    date: string;
    performance: unknown;
  };
  const rows =
    productIds?.length === 0
      ? []
      : await db
          .collection<Row>(
            productIds
              ? "productDailyPerformance"
              : "departmentDailyPerformance",
          )
          .find(
            {
              storeId,
              date: { $in: allDates },
              ...(productIds ? { productId: { $in: productIds } } : {}),
            },
            {
              projection: {
                _id: 1,
                storeId: 1,
                productId: 1,
                date: 1,
                "performance.storeId": 1,
                "performance.productId": 1,
                "performance.date": 1,
                "performance.formulaVersion": 1,
                "performance.inputRevision": 1,
                "performance.computedAt": 1,
                "performance.sales.salesValue": 1,
                "performance.sales.marginValue": 1,
                "performance.waste.salesValue": 1,
                "performance.availability": 1,
              },
            },
          )
          .sort({ _id: 1 })
          .maxTimeMS(5000)
          .limit(productIds ? 100001 : 187)
          .toArray();
  if (rows.length > (productIds ? 100000 : 186)) return limited();
  const points: AnalyticsQueryPoint[] = [],
    seen = new Set<string>();
  for (const row of rows) {
    const p = productIds
      ? productEvidencePerformanceSchema.parse(row.performance)
      : departmentEvidencePerformanceSchema.parse(row.performance);
    const key = `${row.productId ?? "department"}/${row.date}`;
    if (
      row.storeId !== storeId ||
      p.storeId !== storeId ||
      row.date !== p.date ||
      !allDates.includes(row.date) ||
      seen.has(key) ||
      (productIds &&
        (!row.productId ||
          !productIds.includes(row.productId) ||
          !("productId" in p) ||
          p.productId !== row.productId))
    )
      throw Error("JOURNAL_STUDY_SCOPE_INVALID");
    seen.add(key);
    provenance.push([row._id, p.inputRevision]);
    const sales = {
      value: p.sales.salesValue,
      status: p.availability.salesValue.status,
    };
    const margin = {
      value: p.sales.marginValue,
      status: p.availability.salesMarginValue.status,
    };
    if (productIds)
      points.push({
        storeId,
        productId: row.productId!,
        businessDate: p.date,
        sales,
        margin,
        waste: { value: null, status: "UNAVAILABLE" },
      });
    else {
      metrics.sales.set(p.date, { businessDate: p.date, ...sales });
      metrics.margin.set(p.date, { businessDate: p.date, ...margin });
    }
  }
  if (productIds) {
    // Reuse the same current observed cohort rule as analytics_query DAY.
    const cohortSize = new Set(points.map((p) => p.productId)).size;
    for (const metric of ["sales", "margin"] as const)
      for (const p of aggregateAnalyticsDailyPoints(points, metric, cohortSize))
        metrics[metric].set(p.businessDate, p);
  }
  const weeks = [...new Set(allDates.map(contextMonday))];
  const contexts = new Map<string, WeeklyContext>();
  let fingerprint: string | undefined;
  // Four bounded reads at a time; service has no live-reader fallback here.
  for (let i = 0; i < weeks.length; i += 4) {
    const batch = await Promise.all(
      weeks
        .slice(i, i + 4)
        .map(
          async (w) =>
            [
              w,
              weeklyContextSchema.parse(await service.readStored!(storeId, w)),
            ] as const,
        ),
    );
    for (const [w, c] of batch) {
      if (
        c.storeId !== storeId ||
        c.weekStart !== w ||
        !c.settingsFingerprint ||
        (fingerprint !== undefined && c.settingsFingerprint !== fingerprint)
      )
        throw Error("JOURNAL_STUDY_SCOPE_INVALID");
      fingerprint = c.settingsFingerprint;
      contexts.set(w, c);
      provenance.push(c);
    }
  }
  const startAt = selectStoreEventTime(allDates[0]!, "00:00"),
    endAt = selectStoreEventTime(addContextDays(allDates.at(-1)!, 1), "00:00");
  const eventRows =
    productIds?.length === 0
      ? []
      : await db
          .collection<StoreProductEventDocument>("storeProductEvents")
          .find({
            storeId,
            startedAt: { $lt: endAt },
            $or: [{ endedAt: null }, { endedAt: { $gt: startAt } }],
            ...(productIds ? { productId: { $in: productIds } } : {}),
          })
          .sort({ _id: 1 })
          .maxTimeMS(3000)
          .limit(1001)
          .toArray();
  if (eventRows.length > 1000) return limited();
  const events = eventRows.map((row) => {
    const e = serializeStoreProductEvent(row);
    if (
      e.storeId !== storeId ||
      e.id !== row._id ||
      (productIds && !productIds.includes(e.productId))
    )
      throw Error("JOURNAL_STUDY_SCOPE_INVALID");
    provenance.push(e);
    return e;
  });
  const eventOn = (date: string) =>
    events.some(
      (e) =>
        parisDate(e.startedAt) <= date &&
        (!e.endedAt ||
          parisDate(new Date(Date.parse(e.endedAt) - 1).toISOString()) >= date),
    );
  const calendar = (date: string) => {
    const c = contexts.get(contextMonday(date))!;
    if (
      c.publicHolidays.status === "UNAVAILABLE" ||
      c.schoolHolidays.status === "UNAVAILABLE" ||
      !c.schoolHolidays.zone
    )
      return null;
    return [
      c.publicHolidays.days.some((d) => d.date === date),
      c.schoolHolidays.periods.some(
        (p) => p.startDate <= date && date < p.resumeDate,
      ),
    ];
  };
  const stations = new Set<string>();
  const pairs = dates.map((date) => {
    const ref = reference.get(date)!;
    const a = contexts.get(contextMonday(date))!,
      b = ref ? contexts.get(contextMonday(ref)) : undefined;
    const wa =
      a.observedWeather?.status !== "UNAVAILABLE"
        ? a.observedWeather?.days.find((d) => d.producerDate === date)
        : undefined;
    const wb =
      b?.observedWeather?.status !== "UNAVAILABLE"
        ? b?.observedWeather?.days.find((d) => d.producerDate === ref)
        : undefined;
    const sameStation = !!wa && !!wb && wa.station.id === wb.station.id;
    if (wa) stations.add(wa.station.id);
    if (wb) stations.add(wb.station.id);
    const change = (metric: "sales" | "margin") => {
      const current = metrics[metric].get(date),
        previous = ref ? metrics[metric].get(ref) : undefined;
      if (
        !current ||
        !previous ||
        current.status !== "AVAILABLE" ||
        previous.status !== "AVAILABLE"
      )
        return null;
      const r =
        query.referenceMode === "YEAR_OVER_YEAR"
          ? compareYearOverYear({ kpiId: metric, current, history: [previous] })
          : compareJMinus7({ kpiId: metric, current, history: [previous] });
      return r.status === "AVAILABLE" ? r.percentageDifference : null;
    };
    const ca = calendar(date),
      cb = ref ? calendar(ref) : null;
    return {
      date,
      calendarMatched:
        ca !== null && cb !== null && ca[0] === cb[0] && ca[1] === cb[1],
      recordedEvent: eventOn(date) || (!!ref && eventOn(ref)),
      salesChange: change("sales"),
      marginChange: change("margin"),
      temperatureDelta: sameStation
        ? weatherDifference(
            wa!.measurements.TX.analysisValue,
            wb!.measurements.TX.analysisValue,
          )
        : null,
      rainfallDelta: sameStation
        ? weatherDifference(
            wa!.measurements.RR.analysisValue,
            wb!.measurements.RR.analysisValue,
          )
        : null,
    };
  });
  // Never combine coefficients from different station geographies implicitly.
  if (stations.size > 1)
    for (const p of pairs) {
      p.temperatureDelta = null;
      p.rainfallDelta = null;
    }
  const series = describeJournalAssociations(pairs);
  const digest = createHash("sha256")
    .update(JSON.stringify([provenance, pairs]))
    .digest("hex");
  const sourceId = `journal-associations/${digest}`;
  const studyWarnings =
    stations.size > 1
      ? [
          ...warnings,
          "Plusieurs stations dans les sources : regroupement météo refusé, aucune station de remplacement inventée.",
        ]
      : warnings;
  const referenceLabel =
    query.referenceMode === "YEAR_OVER_YEAR"
      ? "mêmes semaine et jour ISO de l'année précédente"
      : "même jour de semaine sept jours avant";
  const statuses = {
    INSUFFICIENT_DATA: "Données insuffisantes",
    UNDEFINED: "Coefficient non calculable (série constante)",
    FRAGILE: "Association fragile",
    ASSOCIATION_OBSERVED:
      "Association descriptive observée, sans preuve de significativité",
  };
  const coefficientLabel = (n: number | null) =>
    n === null ? "non calculable" : n.toFixed(4);
  const evidence = [
    copilotEvidenceSchema.parse({
      id: `ja:${digest.slice(0, 24)}:scope`,
      sourceId,
      sourceVersion: null,
      sourceType: "DATA_QUALITY",
      factKind: "QUALITY",
      label: "Périmètre de l'étude du Journal",
      value: `${query.startDate} au ${query.endDate} ; référence : ${referenceLabel} ; ${query.familyId ? "famille du catalogue actuel" : "ensemble du rayon"}.`,
      detail: studyWarnings.join(" "),
    }),
    ...series.map((s, i) =>
      copilotEvidenceSchema.parse({
        id: `ja:${digest.slice(0, 24)}:${i}`,
        sourceId,
        sourceVersion: null,
        sourceType: "COMPARISON",
        factKind: "DERIVED",
        label: `${s.metric === "sales" ? "CA net TTC" : "Marge importée"} / ${s.exposure === "TEMPERATURE_MAX_DELTA_C" ? "température maximale observée" : "pluie observée"} — association descriptive`,
        value: s.rho === null ? null : String(s.rho),
        detail: `${query.startDate} au ${query.endDate}, référence : ${referenceLabel}. ${statuses[s.status]}. ${s.pairs} paires de jours exploitables sur ${dates.length}, réparties sur ${s.weeks} semaines. Spearman : ${coefficientLabel(s.rho)}. Exclusions successives sans double compte : calendrier inconnu/différent ${s.excluded.calendar}, chiffres incomplets ou référence non calculable ${s.excluded.business}, météo absente/non qualifiée ou station différente ${s.excluded.weather}. Retrait d'une semaine à la fois : ${s.leaveOneWeekOut.evaluatedWeeks} variantes, de ${coefficientLabel(s.leaveOneWeekOut.min)} à ${coefficientLabel(s.leaveOneWeekOut.max)} ; direction ${s.leaveOneWeekOut.sameDirection === null ? "non évaluée" : s.leaveOneWeekOut.sameDirection ? "conservée" : "non stable"}. Sans les jours avec signalement enregistré : ${s.withoutRecordedEvents.pairs} paires, coefficient ${coefficientLabel(s.withoutRecordedEvents.rho)}. Ces retraits ne contrôlent pas les causes ; plages de sensibilité, pas intervalles de confiance. Seuil de restitution 21 paires/4 semaines, pas seuil statistique ; les coefficients sous ce seuil ne permettent pas de conclure.`,
      }),
    ),
  ];
  return journalAssociationResultSchema.parse({
    ...base,
    status: "DESCRIPTIVE_ONLY",
    stationIds: [...stations].sort(),
    warnings: studyWarnings,
    series,
    evidence,
  });
}
