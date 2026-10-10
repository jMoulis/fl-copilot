import {
  BusinessDecimal,
  sumAvailableCurrency,
} from "@fl-copilot/analytics-core";
import {
  parisDate,
  addContextDays,
  selectStoreEventTime,
  SUBSTITUTION_EVIDENCE_RULE_VERSION,
  substitutionEvidenceId,
  substitutionEvidenceSchema,
  type SubstitutionEvidence,
  type StoreProductEvent,
  type ProductSubstitution,
} from "@fl-copilot/domain";
export type EvidenceSales = {
  id: string;
  storeId: string;
  productId: string;
  date: string;
  salesValue: string | null;
  sourceRecordId: string;
  version: number;
  updatedAt: string;
};
export type EvidenceParent = {
  id: string;
  storeId: string;
  status: string;
  deletedAt?: string | null;
};
export type EvidenceContext = {
  operations: {
    id: string;
    productIds: string[];
    start: string;
    end: string;
    state: "PLANNED" | "DECLARED_TASK_DONE";
  }[];
  sourceIds: string[];
  holidayDates: string[];
  schoolHolidayDates: string[];
  publicHolidayCoverage: "KNOWN" | "PARTIAL" | "UNKNOWN";
  schoolHolidayCoverage: "KNOWN" | "PARTIAL" | "UNKNOWN";
};
const decimal = (s: string) => new BusinessDecimal(s);
const unique = (a: string[]) => [...new Set(a)].sort();
function intersects(e: StoreProductEvent, start: string, end: string) {
  return (
    e.source === "USER" &&
    Date.parse(e.startedAt) < Date.parse(end) &&
    (!e.endedAt || Date.parse(e.endedAt) > Date.parse(start))
  );
}
export function evidenceWindow(e: StoreProductEvent) {
  if (!e.endedAt || Date.parse(e.endedAt) <= Date.parse(e.startedAt))
    return { dates: [] as string[], start: null, end: null, partial: true };
  const first = parisDate(e.startedAt),
    last = parisDate(new Date(Date.parse(e.endedAt) - 1).toISOString());
  const dates: string[] = [];
  for (let d = first; d <= last && dates.length < 94; d = addContextDays(d, 1))
    dates.push(d);
  const start = selectStoreEventTime(first, "00:00"),
    end = selectStoreEventTime(addContextDays(last, 1), "00:00");
  return {
    dates,
    start,
    end,
    partial: start !== e.startedAt || end !== e.endedAt,
  };
}
export function referenceDateCandidates(dates: string[]) {
  const first = dates[0];
  return unique(
    dates.flatMap((d) =>
      [7, 14, 21, 28]
        .map((n) => addContextDays(d, -n))
        .filter((d) => first && d < first),
    ),
  );
}
export async function buildDailySubstitutionEvidence(input: {
  event: StoreProductEvent;
  relation: ProductSubstitution;
  source?: EvidenceParent;
  candidate?: EvidenceParent;
  need?: EvidenceParent;
  events: StoreProductEvent[];
  sales: EvidenceSales[];
  context: EvidenceContext;
  now: string;
  digest: (s: string) => Promise<string>;
}) {
  const { event: e, relation: r, context: ctx } = input,
    window = evidenceWindow(e),
    id = await substitutionEvidenceId(e.storeId, e.id, r.id, input.digest);
  if (e.storeId !== r.storeId || e.productId !== r.sourceProductId)
    throw Error("SUBSTITUTION_EVIDENCE_SCOPE_INVALID");
  const reasons: string[] = [
      "DAILY_NOT_HOURLY",
      "SOURCE_SALES_VALUE_NOT_QUANTITY",
      "NEED_NOT_OBSERVED_IN_SALES",
      "WEATHER_NOT_OBSERVED",
      "MARKET_CONTEXT_UNKNOWN",
    ],
    observations: EvidenceSales[] = [],
    references: EvidenceSales[] = [],
    sourceSales: EvidenceSales[] = [];
  let status: SubstitutionEvidence["status"] = "READY";
  if (
    e.source !== "USER" ||
    !["PROPOSED", "VALIDATED", "LEARNING"].includes(r.status) ||
    [input.source, input.candidate, input.need].some(
      (p) =>
        !p || p.storeId !== e.storeId || p.status === "INACTIVE" || p.deletedAt,
    )
  ) {
    status = "INELIGIBLE";
    reasons.push("PARENT_OR_RELATION_INELIGIBLE");
  } else if (!e.endedAt) status = "WAITING_EVENT_END";
  else if (!window.dates.length) {
    status = "INELIGIBLE";
    reasons.push("ZERO_OR_INVALID_EVENT_INTERVAL");
  } else if (window.dates.length > 93) status = "WINDOW_TOO_LONG";
  else if (window.dates.some((d) => d >= parisDate(input.now)))
    status = "WAITING_DAILY_CLOSE";
  const relevant = input.events.filter(
    (other) =>
      other.storeId === e.storeId &&
      other.id !== e.id &&
      [r.sourceProductId, r.substituteProductId].includes(other.productId) &&
      window.start &&
      window.end &&
      intersects(other, window.start, window.end),
  );
  const duplicates = relevant.filter(
    (other) =>
      other.productId === e.productId &&
      other.type === e.type &&
      intersects(other, e.startedAt, e.endedAt ?? input.now),
  );
  if (
    duplicates.length &&
    !["INELIGIBLE", "WINDOW_TOO_LONG"].includes(status)
  ) {
    status = "DUPLICATE_EVENT_REVIEW";
    reasons.push("PROBABLE_DUPLICATE_EVENT");
  }
  if (relevant.length) reasons.push("CONCURRENT_STORE_EVENTS");
  if (
    relevant.some((x) => x.type === "PRICE_INCREASE") ||
    e.type === "PRICE_INCREASE"
  )
    reasons.push("PRICE_CONTEXT_CHANGED");
  if (
    relevant.some(
      (x) =>
        x.productId === r.substituteProductId &&
        ["OUT_OF_STOCK", "LOW_STOCK", "QUALITY_ISSUE"].includes(x.type),
    )
  )
    reasons.push("CANDIDATE_UNAVAILABLE_OR_QUALITY");
  const dates = window.dates.slice(0, 93),
    refPossible = referenceDateCandidates(dates),
    allScopeSales = input.sales
      .filter(
        (s) =>
          s.storeId === e.storeId &&
          [r.sourceProductId, r.substituteProductId].includes(s.productId) &&
          [...dates, ...refPossible].includes(s.date),
      )
      .sort((a, b) => a.id.localeCompare(b.id));
  const operations = ctx.operations.filter(
    (o) =>
      [...dates, ...refPossible].some((d) => d >= o.start && d <= o.end) &&
      o.productIds.some((id) =>
        [r.sourceProductId, r.substituteProductId].includes(id),
      ),
  );
  if (operations.length) reasons.push("COMMERCIAL_CONTEXT_PLANNED_OR_DECLARED");
  if (!operations.length) reasons.push("PROMOTIONS_NOT_EXHAUSTIVELY_KNOWN");
  if (window.partial) reasons.push("PARTIAL_EVENT_WHOLE_DAY_CONTEXT");
  if (r.status === "PROPOSED") reasons.push("RELATION_STILL_PROPOSED");
  if ([...dates, ...refPossible].some((d) => ctx.holidayDates.includes(d)))
    reasons.push("PUBLIC_HOLIDAY_CONTEXT");
  if (
    [...dates, ...refPossible].some((d) => ctx.schoolHolidayDates.includes(d))
  )
    reasons.push("SCHOOL_HOLIDAY_CONTEXT");
  if (ctx.publicHolidayCoverage !== "KNOWN")
    reasons.push("PUBLIC_HOLIDAY_CONTEXT_INCOMPLETE");
  if (ctx.schoolHolidayCoverage !== "KNOWN")
    reasons.push("SCHOOL_HOLIDAY_CONTEXT_INCOMPLETE");
  const dayRows = (product: string, date: string) =>
    allScopeSales.filter((s) => s.productId === product && s.date === date);
  const usable = (rows: EvidenceSales[]) => {
    const sum = sumAvailableCurrency(rows.map((s) => s.salesValue));
    return rows.length && sum.status === "AVAILABLE" && sum.value !== null
      ? sum.value
      : null;
  };
  const comparisons: SubstitutionEvidence["dailyComparisons"] = [];
  let actual: InstanceType<typeof BusinessDecimal> | null = null,
    expected: InstanceType<typeof BusinessDecimal> | null = null,
    minimumReferences = 4;
  if (status === "READY") {
    for (const date of dates) {
      const rows = dayRows(r.substituteProductId, date);
      observations.push(...rows);
      sourceSales.push(...dayRows(r.sourceProductId, date));
      comparisons.push({
        date,
        actualSalesValue: usable(rows),
        expectedSalesValue: null,
        referenceDays: [],
      });
    }
    if (comparisons.some((d) => d.actualSalesValue === null)) {
      status = "MISSING_SALES";
      reasons.push("CANDIDATE_DAILY_SALES_MISSING_OR_PARTIAL");
    } else {
      actual = comparisons.reduce(
        (sum, d) => sum.plus(d.actualSalesValue!),
        decimal("0"),
      );
      expected = decimal("0");
      for (const comparison of comparisons) {
        const date = comparison.date;
        const refs = [7, 14, 21, 28]
          .map((n) => addContextDays(date, -n))
          .filter((d) => d < dates[0]!)
          .filter(
            (d) =>
              !input.events.some(
                (other) =>
                  other.storeId === e.storeId &&
                  [r.sourceProductId, r.substituteProductId].includes(
                    other.productId,
                  ) &&
                  intersects(
                    other,
                    selectStoreEventTime(d, "00:00"),
                    selectStoreEventTime(addContextDays(d, 1), "00:00"),
                  ),
              ),
          )
          .filter(
            (d) =>
              !ctx.operations.some(
                (o) =>
                  o.productIds.some((p) =>
                    [r.sourceProductId, r.substituteProductId].includes(p),
                  ) &&
                  d >= o.start &&
                  d <= o.end,
              ),
          )
          .filter(
            (d) =>
              ctx.publicHolidayCoverage !== "KNOWN" ||
              ctx.holidayDates.includes(d) === ctx.holidayDates.includes(date),
          )
          .filter(
            (d) =>
              ctx.schoolHolidayCoverage !== "KNOWN" ||
              ctx.schoolHolidayDates.includes(d) ===
                ctx.schoolHolidayDates.includes(date),
          );
        const complete = refs
          .map((d) => ({
            date: d,
            rows: dayRows(r.substituteProductId, d),
            value: usable(dayRows(r.substituteProductId, d)),
          }))
          .filter((v) => v.value !== null && !decimal(v.value).isNegative());
        minimumReferences = Math.min(minimumReferences, complete.length);
        references.push(...complete.flatMap((c) => c.rows));
        comparison.referenceDays = complete.map((c) => ({
          date: c.date,
          salesValue: c.value!,
          observationIds: c.rows.map((s) => s.id).sort(),
        }));
        if (!complete.length) {
          status = "INVALID_REFERENCE";
          reasons.push("COMPARABLE_REFERENCE_MISSING");
          expected = null;
          continue;
        }
        const mean = complete
          .reduce((sum, c) => sum.plus(c.value!), decimal("0"))
          .div(complete.length);
        comparison.expectedSalesValue = mean.toFixed(6);
        if (expected) expected = expected.plus(mean);
      }
    }
  }
  if (!sourceSales.length && status === "READY")
    reasons.push("SOURCE_SALES_MISSING_NOT_ZERO");
  if (status === "READY" && (actual!.isNegative() || expected!.lte(0))) {
    status = "INVALID_REFERENCE";
    reasons.push(
      actual!.isNegative()
        ? "NEGATIVE_NET_SALES_NOT_INTERPRETABLE"
        : "REFERENCE_ZERO_OR_NEGATIVE",
    );
  }
  let variation: string | null = null,
    quality: number | null = null,
    strength: number | null = null,
    interpretation: SubstitutionEvidence["interpretation"] = null;
  if (status === "READY") {
    const delta = actual!.minus(expected!).div(expected!).times(100);
    variation = delta.toFixed(6);
    quality = Number(
      (
        (minimumReferences >= 3 ? 1 : minimumReferences === 2 ? 0.7 : 0.4) *
        (window.partial ? 0.35 : 1) *
        (r.status === "PROPOSED" ? 0.5 : 1) *
        (relevant.length || operations.length ? 0.5 : 1) *
        (ctx.publicHolidayCoverage === "KNOWN" &&
        ctx.schoolHolidayCoverage === "KNOWN"
          ? 0.75
          : 0.5) *
        (sourceSales.length ? 1 : 0.8)
      ).toFixed(4),
    );
    strength = Math.min(0.5, Number(delta.abs().div(100).toString()) * quality);
    interpretation = delta.gte(10) ? "SUPPORTS_SUBSTITUTION" : "NEUTRAL";
    if (delta.lt(-10))
      reasons.push("NEGATIVE_VARIATION_INSUFFICIENT_CAUSAL_CONTEXT");
    if (minimumReferences === 1) reasons.push("SINGLE_REFERENCE_WEEKDAY");
  }
  const refDates = unique(references.map((s) => s.date)),
    base = {
      id,
      storeId: e.storeId,
      relationshipId: r.id,
      sourceProductId: r.sourceProductId,
      candidateSubstituteProductId: r.substituteProductId,
      needUnitId: r.needUnitId,
      eventId: e.id,
      status,
      granularity: "DAY" as const,
      metric: "MERCALYS_SOURCE_SALES_VALUE_EUR" as const,
      ruleVersion: SUBSTITUTION_EVIDENCE_RULE_VERSION,
      version: 1,
      eventStartedAt: e.startedAt,
      eventEndedAt: e.endedAt,
      observationStart: dates.length ? window.start : null,
      observationEnd: dates.length ? window.end : null,
      observationDates: dates,
      partialEventDays: window.partial,
      dailyComparisons: comparisons,
      contextSnapshot: {
        holidayDates: unique(ctx.holidayDates),
        schoolHolidayDates: unique(ctx.schoolHolidayDates),
        operations: operations.sort((a, b) => a.id.localeCompare(b.id)),
      },
      referenceMethod: "SAME_WEEKDAY_PRE_EVENT_MEAN_4_WEEKS" as const,
      referenceStart: refDates[0] ?? null,
      referenceEnd: refDates.at(-1) ?? null,
      referenceDates: refDates,
      expectedSalesValue: expected?.toFixed(6) ?? null,
      actualSalesValue: actual?.toFixed(2) ?? null,
      expectedQuantity: null,
      actualQuantity: null,
      observedVariationPct: variation,
      observationSalesIds: unique(observations.map((s) => s.id)),
      referenceSalesIds: unique(references.map((s) => s.id)),
      sourceSalesIds: unique(sourceSales.map((s) => s.id)),
      sourceRecordIds: unique(
        [...observations, ...references, ...sourceSales].map(
          (s) => s.sourceRecordId,
        ),
      ),
      concurrentCommercialOperationIds: unique(operations.map((o) => o.id)),
      concurrentStoreEventIds: unique(relevant.map((x) => x.id)),
      weatherRecordIds: [],
      contextSourceIds: unique(ctx.sourceIds),
      contextCoverage: {
        promotions: operations.length
          ? ("PARTIAL" as const)
          : ("UNKNOWN" as const),
        weather: "UNKNOWN" as const,
        publicHolidays: ctx.publicHolidayCoverage,
        schoolHolidays: ctx.schoolHolidayCoverage,
        marketTension: "UNKNOWN" as const,
      },
      reasons: unique(reasons),
      evidenceStrength: strength,
      dataQuality: quality,
      interpretation,
      notes:
        "Comparaison des ventes sources en euros sur des journées entières. Référence : moyenne des mêmes jours de semaine antérieurs à l’événement, sur quatre semaines disponibles et sans incident ou opération déclarée. Aucun prorata horaire, volume perdu ou effet causal n’est estimé. Promotions et météo observée restent incomplètes ; un recul ne suffit pas à contredire une substitution.",
      createdAt: input.now,
      updatedAt: input.now,
    };
  const fingerprint = {
    base: { ...base, createdAt: undefined, updatedAt: undefined },
    event: e,
    relation: {
      id: r.id,
      source: r.source,
      status: r.status === "LEARNING" ? "VALIDATED" : r.status,
      needCompatibility: r.needCompatibility,
      usageCompatibility: r.usageCompatibility,
      priceCompatibility: r.priceCompatibility,
      packagingCompatibility: r.packagingCompatibility,
    },
    parents: [input.source, input.candidate, input.need],
    sales: allScopeSales,
    events: input.events
      .filter(
        (x) =>
          x.storeId === e.storeId &&
          [r.sourceProductId, r.substituteProductId].includes(x.productId),
      )
      .sort((a, b) => a.id.localeCompare(b.id)),
    context: ctx,
  };
  const inputRevision = await input.digest(JSON.stringify(fingerprint));
  return substitutionEvidenceSchema.parse({ ...base, inputRevision });
}
