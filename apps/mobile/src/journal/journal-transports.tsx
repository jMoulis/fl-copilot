import { useState } from "react";
import { Text, View, Pressable, Linking } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  parisDate,
  type JournalContext,
  type TransportContext,
} from "@fl-copilot/domain";
import { BottomSheet, SecondaryButton } from "../components/ui";
import { journalColors as c } from "./journal-theme";
const source = "https://me-deplacer.iledefrance-mobilites.fr/infos-trafic";
const stamp = (s: string) =>
  new Date(s).toLocaleString("fr-FR", { timeZone: "Europe/Paris" });
const period = (s: string) =>
  `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)} à ${s.slice(9, 11)}:${s.slice(11, 13)}`;
export function transportLinesForDate(
  traffic: TransportContext,
  date: string,
  today: string,
) {
  return traffic.lines.map((line) => {
    if (date >= today) return line;
    const historical = line.history?.find(
      (h) => parisDate(h.capturedAt) <= date,
    );
    if (
      line.capturedAt &&
      parisDate(line.capturedAt) <= date &&
      (!historical || line.capturedAt >= historical.capturedAt)
    )
      return {
        ...line,
        status: line.status === "AVAILABLE" ? ("STALE" as const) : line.status,
      };
    if (historical) return { ...line, ...historical, status: "STALE" as const };
    return {
      ...line,
      status: "UNAVAILABLE" as const,
      capturedAt: null,
      disruptions: [],
      partial: false,
    };
  });
}
export function JournalTransports({
  context,
  date,
  busy,
  onRefresh,
}: {
  context?: JournalContext;
  date: string;
  busy: boolean;
  onRefresh(): void;
}) {
  const [open, setOpen] = useState(false),
    [linkError, setLinkError] = useState(false);
  const traffic =
    typeof context?.transport === "object" ? context.transport : undefined;
  const lines = traffic
    ? transportLinesForDate(traffic, date, parisDate(new Date().toISOString()))
    : [];
  const count = lines.reduce((n, l) => n + l.disruptions.length, 0),
    known = lines.some((l) => l.capturedAt);
  const issues = {
    MISSING_API_KEY:
      "Le service de trafic n’est pas encore activé sur le serveur.",
    LOCATION_CHANGED:
      "La localisation du magasin a changé. Relance la détection dans ses réglages.",
    NO_SELECTED_LINES: "Aucune ligne n’est sélectionnée pour le suivi.",
    PROVIDER_UNAVAILABLE: "La source trafic est momentanément indisponible.",
    HISTORY_UNAVAILABLE:
      "Aucune capture historique n’est disponible pour cette période.",
  };
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Consulter les transports à proximité"
        onPress={() => setOpen(true)}
        style={{
          backgroundColor: c.surface,
          borderColor: c.line,
          borderWidth: 1,
          borderRadius: 16,
          padding: 16,
          marginBottom: 16,
          flexDirection: "row",
          gap: 12,
          alignItems: "center",
        }}
      >
        <Ionicons name="bus-outline" size={23} color={c.mint} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: c.ink, fontWeight: "600" }}>
            Transports à proximité
          </Text>
          <Text style={{ color: c.muted, fontSize: 12 }}>
            {known
              ? `${count} message${count > 1 ? "s" : ""} publié${count > 1 ? "s" : ""} · ${lines.length} ligne${lines.length > 1 ? "s" : ""} suivie${lines.length > 1 ? "s" : ""}`
              : traffic?.status === "NOT_CONFIGURED"
                ? "Suivi à configurer"
                : "Consulter le suivi du magasin"}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={c.muted} />
      </Pressable>
      <BottomSheet
        visible={open}
        title="Transports à proximité"
        swipeToClose
        onClose={() => setOpen(false)}
      >
        <Text className="text-muted">
          Lignes choisies autour de ton magasin. Les messages viennent
          d’Île-de-France Mobilités ; ils ne prouvent pas un effet sur les
          visites ou les ventes.
        </Text>
        {traffic?.issue ? (
          <Text className="text-warning">{issues[traffic.issue]}</Text>
        ) : null}
        {!traffic ? (
          <Text className="text-muted">
            Définis l’adresse ou la position du magasin, puis les lignes à
            suivre dans ses réglages.
          </Text>
        ) : null}
        {lines.map((line) => (
          <View key={line.id} className="gap-2 border-t border-line pt-4">
            <Text className="text-lg font-semibold text-ink">{line.name}</Text>
            <Text className="text-muted">
              {line.stopName} · {line.distanceMetres} m à vol d’oiseau
            </Text>
            {line.capturedAt ? (
              <Text className="text-sm text-muted">
                Collecte : {stamp(line.capturedAt)}
                {line.status === "STALE" ? " · version conservée" : ""}
              </Text>
            ) : (
              <Text className="text-warning">
                Aucune capture disponible pour cette journée. Une absence de
                donnée ne signifie pas une absence de perturbation.
              </Text>
            )}
            {line.disruptions.map((d) => (
              <View key={d.id} className="gap-2 rounded-xl bg-canvas p-3">
                <Text selectable className="text-ink">
                  {d.message || "Message publié sans texte exploitable."}
                </Text>
                {d.applicationPeriods.slice(0, 3).map((p, i) => (
                  <Text key={i} className="text-sm text-muted">
                    Application annoncée : {period(p.begin)} – {period(p.end)} ·
                    heure de Paris
                  </Text>
                ))}
                {d.schedule ? (
                  <Text className="text-sm text-muted">{d.schedule}</Text>
                ) : null}
              </View>
            ))}
            {line.capturedAt && !line.disruptions.length ? (
              <Text className="text-muted">
                Aucun message publié pour cette ligne dans la réponse consultée.
                Cela ne garantit pas un trafic normal.
              </Text>
            ) : null}
            {line.partial ? (
              <Text className="text-warning">
                Extrait partiel des messages publiés. Consulte la source pour le
                détail.
              </Text>
            ) : null}
          </View>
        ))}
        <SecondaryButton
          label="Régler les transports du magasin"
          onPress={() => {
            setOpen(false);
            router.push("/store-transports");
          }}
        />
        <SecondaryButton
          label="Ouvrir les informations trafic"
          onPress={() =>
            void Linking.openURL(source).catch(() => setLinkError(true))
          }
        />
        {linkError ? (
          <Text className="text-critical">Impossible d’ouvrir la source.</Text>
        ) : null}
        <SecondaryButton
          label={busy ? "Actualisation…" : "Actualiser maintenant"}
          disabled={busy}
          onPress={onRefresh}
        />
        <Text className="text-sm text-muted">
          Un relevé est enregistré sur demande ou lors des collectes
          automatiques. Le cache trafic est partagé pendant 30 minutes. Les
          périodes d’application annoncées restent distinctes de la date de
          collecte.
        </Text>
      </BottomSheet>
    </>
  );
}
