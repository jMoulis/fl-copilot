import {
  explorerChartBuckets,
  type DatedKpiValue,
  type ExplorerPeriod,
} from "@fl-copilot/analytics-core";

/** Geometry only. The canonical Explorer supplies periods, amounts and missing bins. */
export function productSparkline(
  period: ExplorerPeriod,
  points: readonly DatedKpiValue[],
  width = 66,
  height = 30,
) {
  const buckets = explorerChartBuckets(period, points);
  const values = buckets.map((bucket) => {
    const value = bucket.value === null ? null : Number(bucket.value);
    return value !== null && Number.isFinite(value) ? value : null;
  });
  const available = values.filter((value): value is number => value !== null);
  const low = Math.min(...available),
    high = Math.max(...available);
  const scale = Math.max(Math.abs(low), Math.abs(high), 1);
  const span = high / scale - low / scale;
  const dots = values.map((value, index) =>
    value === null
      ? null
      : {
          x:
            values.length === 1
              ? width / 2
              : 3 + (index * (width - 6)) / (values.length - 1),
          y:
            span === 0
              ? height / 2
              : 3 + ((high / scale - value / scale) / span) * (height - 6),
          complete: buckets[index]!.complete,
        },
  );
  const segments = dots.flatMap((dot, index) => {
    const next = dots[index + 1];
    if (!dot || !next) return [];
    const dx = next.x - dot.x,
      dy = next.y - dot.y;
    return [
      {
        x: dot.x,
        y: dot.y,
        length: Math.hypot(dx, dy),
        angle: Math.atan2(dy, dx),
        complete: dot.complete && next.complete,
      },
    ];
  });
  // Isolated observations remain dots; never join across an unknown day.
  const isolated = dots.flatMap((dot, index) =>
    dot && !dots[index - 1] && !dots[index + 1] ? [dot] : [],
  );
  return {
    segments,
    isolated,
    available: available.length,
    expected: buckets.length,
  };
}
