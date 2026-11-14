import {
  isStationEquipmentNotice,
  transportAlertType,
  transportAlertTypeLabels,
  type StoreTransports,
  type TransportContext,
  type TransportDisruption,
} from "@fl-copilot/domain";

const modes = {
  METRO: { label: "Métro", icon: "subway-variant" },
  TRAM: { label: "Tram", icon: "tram" },
  TRAIN: { label: "Train / RER", icon: "train" },
  BUS: { label: "Bus", icon: "bus" },
  OTHER: { label: "Autres transports", icon: "map-marker-path" },
} as const;
const priorities = {
  INTERRUPTION: 0,
  REDUCED_SERVICE: 1,
  DELAYS: 2,
  DETOUR: 3,
  SERVICE_CHANGE: 3,
  INFORMATION: 4,
} as const;
export function transportAlertPresentation(disruption: TransportDisruption) {
  const type = isStationEquipmentNotice(disruption.message)
    ? "INFORMATION"
    : transportAlertType(disruption.effect);
  return {
    label: transportAlertTypeLabels[type],
    priority: priorities[type],
    tone:
      type === "INTERRUPTION"
        ? "high"
        : type === "INFORMATION"
          ? "muted"
          : "medium",
  } as const;
}
function transportMode(value: string): keyof typeof modes {
  const mode = value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (mode === "metro") return "METRO";
  if (mode === "tram" || mode === "tramway") return "TRAM";
  if (["rail", "train", "rer"].includes(mode)) return "TRAIN";
  if (mode === "bus" || mode === "coach") return "BUS";
  return "OTHER";
}
const linePriority = (line: TransportContext["lines"][number]) =>
  line.disruptions.length
    ? transportAlertPresentation(line.disruptions[0]!).priority
    : 5;

/** Presentation only: use saved line identity, keep unknown modes neutral and
 * never mutate the captured source order or interpret shop impact. */
export function groupTransportLines(
  lines: TransportContext["lines"],
  configuredLines: StoreTransports["lines"] = [],
) {
  const configured = new Map(
    configuredLines.map((line) => [line.id, line.mode]),
  );
  const grouped = new Map<keyof typeof modes, TransportContext["lines"]>();
  for (const source of lines) {
    // Older captures retained a mode prefix in their name, not a separate field.
    const mode = transportMode(
      configured.get(source.id) ?? source.name.trim().split(/\s+/)[0] ?? "",
    );
    const line = {
      ...source,
      disruptions: [...source.disruptions].sort(
        (a, b) =>
          transportAlertPresentation(a).priority -
          transportAlertPresentation(b).priority,
      ),
    };
    const bucket = grouped.get(mode) ?? [];
    bucket.push(line);
    grouped.set(mode, bucket);
  }
  return [...grouped]
    .map(([mode, members]) => {
      members.sort(
        (a, b) =>
          linePriority(a) - linePriority(b) ||
          a.distanceMetres - b.distanceMetres ||
          a.name.localeCompare(b.name, "fr", { numeric: true }),
      );
      return {
        mode,
        ...modes[mode],
        lines: members,
        count: members.reduce((n, line) => n + line.disruptions.length, 0),
        missing: members.filter((line) => !line.capturedAt).length,
        priority: linePriority(members[0]!),
      };
    })
    .sort(
      (a, b) => a.priority - b.priority || a.label.localeCompare(b.label, "fr"),
    );
}
export type TransportGroup = ReturnType<typeof groupTransportLines>[number];
