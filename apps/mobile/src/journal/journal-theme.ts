import { colors } from "../design/tokens";

/** The Journal shares Marché solaire roles with the rest of the native app. */
export const journalColors = {
  canvas: colors.canvas,
  surface: colors.surface,
  ink: colors.ink,
  muted: colors.muted,
  mint: colors.forest,
  accent: colors.accent,
  onAccent: colors.onAccent,
  line: colors.line,
  low: colors.positive,
  medium: colors.warning,
  high: colors.critical,
  sun: "#F6E3BF",
  sunInk: "#654322",
  rain: "#DCEBF0",
  rainInk: "#285061",
  neutral: "#E5EBD9",
  neutralInk: "#3E5235",
} as const;
