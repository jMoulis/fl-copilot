import {
  addContextDays,
  parisDate,
  type ForecastDay,
  type WeeklyContext,
} from "@fl-copilot/domain";
import { contextIsStale } from "../store/weekly-context-repository";

export function weatherPresentation(day?: ForecastDay) {
  const code = day?.symbol?.code ?? "";
  const base = code.replace(/_(day|night|polartwilight)$/, "");
  const night = code.endsWith("_night");
  if (base.includes("thunder"))
    return {
      icon: "thunderstorm" as const,
      label: "Orage",
      tone: "rain" as const,
    };
  if (base.includes("sleet"))
    return {
      icon: "snow" as const,
      label: "Pluie et neige",
      tone: "rain" as const,
    };
  if (base.includes("snow"))
    return { icon: "snow" as const, label: "Neige", tone: "rain" as const };
  if (base.includes("rain"))
    return {
      icon: "rainy" as const,
      label: base.includes("showers") ? "Averses" : "Pluie",
      tone: "rain" as const,
    };
  if (base === "clearsky")
    return {
      icon: night ? ("moon" as const) : ("sunny" as const),
      label: night ? "Ciel dégagé" : "Ensoleillé",
      tone: night ? ("rain" as const) : ("sun" as const),
    };
  if (base === "fair" || base === "partlycloudy")
    return {
      icon: night ? ("cloudy-night" as const) : ("partly-sunny" as const),
      label: "Éclaircies",
      tone: "sun" as const,
    };
  if (base === "cloudy")
    return {
      icon: "cloud" as const,
      label: "Couvert",
      tone: "neutral" as const,
    };
  if (base === "fog")
    return {
      icon: "cloud-outline" as const,
      label: "Brouillard",
      tone: "neutral" as const,
    };
  // Dry rain totals alone do not establish a clear sky.
  return {
    icon: "thermometer-outline" as const,
    label: "Prévision",
    tone: "neutral" as const,
  };
}
export const weatherNumber = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
export function journalDateLabel(date: string, short = false) {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: short ? "short" : "long",
    ...(short ? {} : { day: "numeric", month: "long" }),
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}
export function journalCalendar(
  context: WeeklyContext | null,
  date: string,
  now: Date,
) {
  if (!context) return [];
  const lines: string[] = [];
  const holidays = context.publicHolidays;
  if (holidays.status === "AVAILABLE" || holidays.status === "STALE") {
    const holiday = holidays.days.find((d) => d.date === date);
    if (holiday)
      lines.push(
        `${holiday.label} · jour férié${contextIsStale(holidays, now) ? " · calendrier ancien" : ""}`,
      );
  }
  const school = context.schoolHolidays;
  if (
    school.zone &&
    (school.status === "AVAILABLE" || school.status === "STALE")
  ) {
    const periods = school.periods.filter(
      (p) => p.startDate <= date && date < p.resumeDate,
    );
    if (periods.length) {
      const labels = [
        ...new Set(
          periods.map(
            (p) =>
              `${p.label}${p.startDate === date ? " · départ après la classe" : ""}`,
          ),
        ),
      ];
      lines.push(
        `${labels.join(" / ")} · Zone ${school.zone}${contextIsStale(school, now) ? " · calendrier ancien" : ""}`,
      );
    } else if (!contextIsStale(school, now))
      lines.push(`Hors vacances scolaires · Zone ${school.zone}`);
  }
  return lines;
}
export function journalWeatherDate(date: string, now: Date) {
  return date < parisDate(now.toISOString())
    ? "Prévision archivée"
    : "Prévision";
}
export function journalWeekDates(weekStart: string) {
  return Array.from({ length: 7 }, (_, i) => addContextDays(weekStart, i));
}
