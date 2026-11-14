import { expect, it } from "vitest";
import type { TransportContext, TransportDisruption } from "@fl-copilot/domain";
import { storeTransportsFixture } from "../../../../scripts/test-store-transports-fixtures";
import {
  groupTransportLines,
  transportAlertPresentation,
} from "./journal-transport-presentation";
const alert = (
  effect: string | null,
  message = "Message de trafic",
): TransportDisruption => ({
  id: effect ?? "unknown",
  effect,
  message,
  applicationPeriods: [],
  schedule: null,
  updatedAt: null,
});
const line = (
  id: string,
  name: string,
  disruptions: TransportDisruption[] = [],
): TransportContext["lines"][number] => ({
  id,
  name,
  disruptions,
  stopName: "Les Courtilles",
  distanceMetres: 73,
  status: "AVAILABLE",
  retrievedAt: null,
  validUntil: null,
  capturedAt: "2026-11-14T09:35:13.750Z",
  partial: false,
});
it("uses saved mode by stable line ID, never guesses Metro from a Bus 13 number", () => {
  const saved = storeTransportsFixture().lines[0]!;
  const groups = groupTransportLines(
    [
      line("IDFM:C02534", "Bus 13"),
      line(saved.id, "13"),
      line("IDFM:C00002", "Tramway T1"),
      line("IDFM:C00003", "Rail C"),
    ],
    [saved],
  );
  expect(groups.map((g) => [g.label, g.icon])).toEqual([
    ["Bus", "bus"],
    ["Métro", "subway-variant"],
    ["Train / RER", "train"],
    ["Tram", "tram"],
  ]);
  expect(groups.find((g) => g.mode === "BUS")!.lines.map((l) => l.id)).toEqual([
    "IDFM:C02534",
  ]);
  expect(
    groupTransportLines(
      [line(saved.id, "Metro 13")],
      [{ ...saved, mode: "Unrecognized" }],
    )[0]!.mode,
  ).toBe("OTHER");
});
it("orders groups, lines and alerts by circulation effect without changing captured data", () => {
  const stopped = alert("NO_SERVICE");
  const lines = [
    line("IDFM:C00001", "Bus 13", [
      alert("OTHER_EFFECT"),
      alert("SIGNIFICANT_DELAYS"),
    ]),
    line("IDFM:C00002", "Metro 13", [
      alert("MODIFIED_SERVICE"),
      stopped,
      alert("REDUCED_SERVICE"),
      alert("DETOUR"),
    ]),
    line("IDFM:C00003", "Bus 238", [stopped]),
    line("IDFM:C00004", "Tram T1"),
  ];
  const before = JSON.stringify(lines);
  const groups = groupTransportLines(lines);
  expect(groups.map((g) => g.mode)).toEqual(["BUS", "METRO", "TRAM"]);
  expect(groups[0]!.lines.map((l) => l.id)).toEqual([
    "IDFM:C00003",
    "IDFM:C00001",
  ]);
  expect(groups[1]!.lines[0]!.disruptions.map((d) => d.effect)).toEqual([
    "NO_SERVICE",
    "REDUCED_SERVICE",
    "MODIFIED_SERVICE",
    "DETOUR",
  ]);
  expect(groups[0]!.count).toBe(3);
  expect(JSON.stringify(lines)).toBe(before);
});
it("keeps equipment and unknown effects neutral rather than inventing high severity", () => {
  expect(
    transportAlertPresentation(
      alert("SIGNIFICANT_DELAYS", "Panne d'un ascenseur"),
    ),
  ).toMatchObject({ priority: 4, tone: "muted" });
  expect(transportAlertPresentation(alert(null))).toMatchObject({
    priority: 4,
    tone: "muted",
  });
  expect(transportAlertPresentation(alert("FUTURE_CODE"))).toMatchObject({
    priority: 4,
    tone: "muted",
  });
  expect(transportAlertPresentation(alert("NO_SERVICE"))).toMatchObject({
    priority: 0,
    tone: "high",
  });
  expect(transportAlertPresentation(alert("REDUCED_SERVICE"))).toMatchObject({
    priority: 1,
    tone: "medium",
  });
});
