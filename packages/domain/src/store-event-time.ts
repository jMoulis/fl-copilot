/** Exact instants for a store wall time; never silently pick an autumn DST occurrence. */
export function storeEventTimeCandidates(date: string, time: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
  )
    throw Error("Choisissez une date et une heure au format 24 h.");
  const seed = Date.parse(`${date}T${time}:00Z`);
  if (
    !Number.isFinite(seed) ||
    new Date(seed).toISOString().slice(0, 10) !== date
  )
    throw Error("Choisissez une date valide.");
  const wanted = `${date}T${time}`,
    candidates: string[] = [];
  for (const offset of [120, 60]) {
    const instant = new Date(seed - offset * 60000).toISOString();
    const parts = storeEventTimeParts(instant);
    if (`${parts.date}T${parts.time}` === wanted) candidates.push(instant);
  }
  return candidates.sort();
}
export function storeEventTimeParts(instant: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const p = (key: string) => parts.find((p) => p.type === key)!.value;
  return {
    date: `${p("year")}-${p("month")}-${p("day")}`,
    time: `${p("hour")}:${p("minute")}`,
  };
}
export function selectStoreEventTime(
  date: string,
  time: string,
  occurrence?: string,
) {
  const c = storeEventTimeCandidates(date, time);
  if (!c.length)
    throw Error(
      "Cette heure n’existe pas lors du passage à l’heure d’été. Choisissez une autre heure.",
    );
  if (c.length > 1 && !c.includes(occurrence ?? ""))
    throw Error(
      "Cette heure existe deux fois. Précisez le premier ou le second passage.",
    );
  return c.length === 1 ? c[0]! : occurrence!;
}
export function storeEventTimeLabel(instant: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instant));
}
