/** Calendar-only dates; UTC construction prevents timezone shifts in labels. */
export function calendarDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]),
    month = Number(match[2]),
    day = Number(match[3]);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(12, 0, 0, 0);
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null;
}
export function isoCalendarDate(date: Date) {
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
export function todayCalendarDate(date = new Date()) {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function formatFrenchCalendarDate(iso: string) {
  const date = calendarDate(iso);
  return date
    ? new Intl.DateTimeFormat("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "UTC",
      }).format(date)
    : "Choisir une date";
}
export function calendarMonthLabel(month: string) {
  const date = calendarDate(`${month}-01`);
  if (!date) throw new Error("Invalid calendar month");
  return new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
export function shiftCalendarMonth(month: string, amount: number) {
  const date = calendarDate(`${month}-01`);
  if (!date) throw new Error("Invalid calendar month");
  date.setUTCMonth(date.getUTCMonth() + amount);
  if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return month;
  return isoCalendarDate(date).slice(0, 7);
}
export function calendarCells(month: string): (string | null)[] {
  const date = calendarDate(`${month}-01`);
  if (!date) throw new Error("Invalid calendar month");
  const offset = (date.getUTCDay() + 6) % 7;
  const end = new Date(date);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  const cells: (string | null)[] = Array(offset).fill(null);
  for (let day = 1; day <= end.getUTCDate(); day++)
    cells.push(`${month}-${String(day).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}
