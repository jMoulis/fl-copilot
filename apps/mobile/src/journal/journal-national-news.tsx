import { useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import {
  addContextDays,
  nationalNewsForPeriod,
  parisDate,
  type JournalContext,
} from "@fl-copilot/domain";
import { BottomSheet, SecondaryButton } from "../components/ui";
import { journalColors as c } from "./journal-theme";
const stamp = (s: string | null | undefined) =>
  s
    ? new Date(s).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })
    : "Non connue";
export function JournalNationalNews({
  context,
  date,
}: {
  context?: JournalContext;
  date: string;
}) {
  const [open, setOpen] = useState(false),
    [linkError, setLinkError] = useState(false);
  const today = parisDate(new Date().toISOString());
  const end = date < today ? date : addContextDays(date, 7);
  const rows = context ? nationalNewsForPeriod(context, date, end, today) : [];
  return (
    <View style={{ marginVertical: 8 }}>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          setLinkError(false);
          setOpen(true);
        }}
        style={{
          padding: 16,
          backgroundColor: c.surface,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: c.line,
          minHeight: 72,
        }}
      >
        <Text style={{ color: c.ink, fontWeight: "600" }}>
          Actualités et déplacements
        </Text>
        <Text style={{ color: c.muted }}>
          {rows.length
            ? `${rows.length} annonce${rows.length > 1 ? "s" : ""} à consulter`
            : "Aucune annonce retenue dans les sources disponibles"}
        </Text>
      </Pressable>
      <BottomSheet
        visible={open}
        title="Actualités et déplacements"
        swipeToClose
        onClose={() => setOpen(false)}
      >
        <Text className="text-muted">
          Sélection partielle de mouvements sociaux et restrictions. Les appels
          et annonces ne prouvent ni une perturbation au magasin ni un effet sur
          tes ventes.
        </Text>
        {rows.map(({ item, source, dated }) => (
          <View
            key={item.sourceUrl}
            className="gap-2 border-t border-line pt-4"
          >
            <Text className="text-lg font-semibold text-ink">{item.title}</Text>
            <Text className="text-muted">
              {source.provider} · Annonce publiée
            </Text>
            <Text className="text-ink">{item.summary}</Text>
            <Text className="text-muted">
              {dated
                ? `Période annoncée : ${item.startDate} — ${item.endDate}`
                : "Publication récente · période exacte à vérifier dans la source"}
            </Text>
            <Text className="text-muted">{item.scopeLabel}</Text>
            <Text className="text-muted">
              Publication : {stamp(item.publishedAt)}
              {"\n"}Version collectée : {stamp(source.firstCapturedAt)}
              {"\n"}Dernière vérification : {stamp(source.retrievedAt)}
            </Text>
            {source.status !== "AVAILABLE" ||
            !source.validUntil ||
            source.validUntil <= new Date().toISOString() ? (
              <Text className="text-muted">
                Version conservée · fraîcheur à vérifier
              </Text>
            ) : null}
            <SecondaryButton
              label="Lire la source"
              onPress={() => {
                void Linking.openURL(item.sourceUrl).catch(() =>
                  setLinkError(true),
                );
              }}
            />
          </View>
        ))}
        {!rows.length ? (
          <Text className="text-muted">
            Aucune annonce correspondante dans les archives disponibles. Cela ne
            prouve pas l’absence de mouvement ou de restriction.
          </Text>
        ) : null}
        {(context?.national ?? [])
          .filter((s) => s.status === "UNAVAILABLE" || s.status === "STALE")
          .map((s) => (
            <Text key={s.kind} className="text-muted">
              {s.provider} :{" "}
              {s.status === "UNAVAILABLE"
                ? "source ou archive indisponible"
                : "version conservée"}
              .
            </Text>
          ))}
        {linkError ? (
          <Text accessibilityRole="alert" className="text-muted">
            Impossible d’ouvrir la source. Réessaie lorsque la connexion est
            disponible.
          </Text>
        ) : null}
      </BottomSheet>
    </View>
  );
}
