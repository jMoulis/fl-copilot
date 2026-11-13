import { useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { economicPeriodSummary } from "@fl-copilot/analytics-core";
import { economicSeriesLabels, type EconomicContext } from "@fl-copilot/domain";
import { BottomSheet, SecondaryButton } from "../components/ui";
import { contextIsStale } from "../store/weekly-context-repository";
import { journalColors as c } from "./journal-theme";
const number = (s: string | null) =>
  s === null
    ? "Indisponible"
    : Number(s).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const monthLabel = (month: string | null) =>
  month
    ? new Intl.DateTimeFormat("fr-FR", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${month}-01T12:00:00Z`))
    : "Période indisponible";
export function JournalEconomy({
  date,
  context,
  busy,
  error,
  configured = false,
  onRefresh,
}: {
  date: string;
  context?: EconomicContext;
  busy: boolean;
  error?: string;
  configured?: boolean;
  onRefresh(): void;
}) {
  const [visible, setVisible] = useState(false),
    [linkError, setLinkError] = useState(false);
  const summaries = economicPeriodSummary(context, date.slice(0, 7));
  const stale = !!context && contextIsStale(context, new Date());
  const food = summaries.find((s) => s.id === "011813720"),
    confidence = summaries.find((s) => s.id === "001587668");
  async function source(id: string) {
    try {
      await Linking.openURL(`https://www.insee.fr/fr/statistiques/serie/${id}`);
    } catch {
      setLinkError(true);
    }
  }
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ouvrir le contexte économique national"
        onPress={() => setVisible(true)}
        className="active:opacity-70"
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          minHeight: 44,
          paddingVertical: 8,
          borderTopWidth: 1,
          borderColor: c.line,
        }}
      >
        <Ionicons name="pulse-outline" size={18} color={c.muted} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ color: c.muted, fontSize: 12, fontWeight: "600" }}>
            Contexte national{stale ? " · à actualiser" : ""}
          </Text>
          {food?.period || confidence?.period ? (
            <Text style={{ color: c.muted, fontSize: 11, lineHeight: 16 }}>
              Prix alimentaires ·{" "}
              {food?.annualChangePercent != null
                ? `${number(food.annualChangePercent)} % / an`
                : food?.value != null
                  ? "indice à consulter"
                  : "indisponible"}{" "}
              · {monthLabel(food?.period ?? null)}
              {"\n"}Confiance · {number(confidence?.value ?? null)}
              {confidence?.value != null ? " points" : ""} ·{" "}
              {monthLabel(confidence?.period ?? null)}
            </Text>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={16} color={c.muted} />
      </Pressable>
      <BottomSheet
        title="Contexte économique"
        visible={visible}
        swipeToClose
        onClose={() => setVisible(false)}
      >
        <Text className="text-muted">
          Repères mensuels de l’INSEE pour la France métropolitaine. Ils ne
          mesurent pas l’effet sur ton magasin.
        </Text>
        {summaries.length ? (
          summaries.map((s) => (
            <View key={s.id} className="gap-2 border-t border-line pt-4">
              <Text className="text-lg font-semibold text-ink">
                {economicSeriesLabels[s.id]}
              </Text>
              <Text className="text-muted">{monthLabel(s.period)}</Text>
              <Text className="text-2xl font-semibold text-ink">
                {s.id === "011813720" && s.annualChangePercent !== null
                  ? `${number(s.annualChangePercent)} % sur un an`
                  : s.value !== null
                    ? `${number(s.value)} · indice`
                    : "Indisponible"}
              </Text>
              <Text className="text-muted">
                {s.id === "011813720"
                  ? `Indice ${number(s.value)}, base 100 en 2025. La variation annuelle compare exactement le même mois à un an d’écart.`
                  : `Moyenne de long terme : 100.${s.monthlyDifferencePoints !== null ? ` Écart au mois précédent : ${number(s.monthlyDifferencePoints)} points.` : ""}`}
              </Text>
              {s.period && s.period !== date.slice(0, 7) ? (
                <Text className="text-muted">
                  Le mois sélectionné n’est pas renseigné dans la source
                  récupérée ; voici le dernier mois antérieur disponible.
                </Text>
              ) : null}
              {s.value !== null ? (
                <Text className="text-muted">
                  {s.quality === "DEF"
                    ? "Valeur définitive à la récupération."
                    : "Valeur dont le statut reste à vérifier dans la source."}
                  {s.revised ? " Valeur révisée par le producteur." : ""}
                </Text>
              ) : null}
              <SecondaryButton
                label="Consulter la source INSEE"
                onPress={() => void source(s.id)}
              />
            </View>
          ))
        ) : (
          <Text className="text-muted">
            {context?.status === "UNAVAILABLE" &&
            context.issue === "PROVIDER_UNAVAILABLE"
              ? "La source INSEE est momentanément indisponible."
              : "Aucune donnée économique enregistrée pour cette période."}
          </Text>
        )}
        {context?.retrievedAt ? (
          <Text className="text-muted">
            Récupéré le{" "}
            {new Date(context.retrievedAt).toLocaleString("fr-FR", {
              timeZone: "Europe/Paris",
            })}
            .
            {stale
              ? " Source ancienne ou indisponible ; les valeurs conservées restent consultables."
              : ""}
          </Text>
        ) : null}
        <Text className="text-muted">
          Il s’agit de la dernière édition des séries, susceptible de révision.
          Pour une journée passée, elle ne reconstitue pas les informations
          connues à cette date.
        </Text>
        {linkError ? (
          <Text className="text-critical">
            La source ne peut pas être ouverte.
          </Text>
        ) : null}
        {!configured ? (
          <Text className="text-muted">
            Enregistre puis synchronise les réglages du magasin avant
            d’actualiser ce contexte.
          </Text>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" className="text-critical">
            {error}
          </Text>
        ) : null}
        <SecondaryButton
          label={busy ? "Actualisation…" : "Actualiser le contexte"}
          disabled={busy || !configured}
          onPress={onRefresh}
        />
      </BottomSheet>
    </>
  );
}
