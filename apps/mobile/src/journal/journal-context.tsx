import { useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  journalItemsForDate,
  journalSourceForDate,
  parisDate,
  type JournalContext,
  type JournalSource,
} from "@fl-copilot/domain";
import { BottomSheet, SecondaryButton } from "../components/ui";
import { journalColors as c } from "./journal-theme";
const labels = {
  WORKS: "Travaux et accès",
  AGENDA: "Autour du magasin",
  CONSUMPTION: "Achats de fruits et légumes",
};
const stamp = (s: string | null) =>
  s
    ? new Date(s).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })
    : "Non connue";
const number = (n: number) =>
  n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
export function JournalExternalContext({
  date,
  context,
  busy,
  configured,
  onRefresh,
}: {
  date: string;
  context?: JournalContext;
  busy: boolean;
  configured: boolean;
  onRefresh(): void;
}) {
  const [selected, setSelected] = useState<JournalSource["kind"]>(),
    [revision, setRevision] = useState<string>(),
    [linkError, setLinkError] = useState(false);
  const sources = context?.sources.map((s) =>
    journalSourceForDate(s, date, parisDate(new Date().toISOString())),
  );
  const source = sources?.find((s) => s.kind === selected);
  const archived = source?.history.find(
    (h) => `${h.revision}:${h.firstCapturedAt}` === revision,
  );
  const payload = archived?.payload ?? source?.payload;
  const rows = source
    ? journalItemsForDate({ ...source, payload: payload ?? null }, date)
    : [];
  async function open(url: string) {
    try {
      await Linking.openURL(url);
    } catch {
      setLinkError(true);
    }
  }
  return (
    <>
      <View style={{ gap: 10, marginVertical: 16 }}>
        <Text style={{ color: c.ink, fontSize: 18, fontWeight: "600" }}>
          Les repères du jour
        </Text>
        <Text style={{ color: c.muted, fontSize: 12 }}>
          Annonces locales et tendances nationales, à croiser avec tes
          observations.
        </Text>
        {(["WORKS", "AGENDA", "CONSUMPTION"] as const).map((kind) => {
          const item = sources?.find((s) => s.kind === kind);
          const count = item ? journalItemsForDate(item, date).length : 0;
          const available = !!item?.payload;
          return (
            <Pressable
              key={kind}
              accessibilityRole="button"
              onPress={() => {
                setSelected(kind);
                setRevision(undefined);
                setLinkError(false);
              }}
              style={{
                backgroundColor: c.surface,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: c.line,
                padding: 16,
                flexDirection: "row",
                gap: 12,
                alignItems: "center",
                minHeight: 72,
              }}
            >
              <Ionicons
                name={
                  kind === "WORKS"
                    ? "trail-sign-outline"
                    : kind === "AGENDA"
                      ? "calendar-outline"
                      : "basket-outline"
                }
                size={23}
                color={c.mint}
              />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ color: c.ink, fontWeight: "600", fontSize: 14 }}>
                  {labels[kind]}
                </Text>
                <Text style={{ color: c.muted, fontSize: 12 }}>
                  {available
                    ? kind === "CONSUMPTION"
                      ? `Consommation · ${item.payload!.consumption?.period ?? "période à vérifier"}`
                      : `${count} annonce${count > 1 ? "s" : ""} à consulter · couverture partielle`
                    : item?.status === "NOT_CONFIGURED"
                      ? "Source locale à configurer"
                      : item?.issue === "HISTORY_UNAVAILABLE"
                        ? "Pas d’archive collectée pour cette semaine"
                        : "Aucune source enregistrée"}
                </Text>
                {available &&
                (item.status === "STALE" ||
                  !item.validUntil ||
                  item.validUntil <= new Date().toISOString()) ? (
                  <Text style={{ color: c.medium, fontSize: 11 }}>
                    Version conservée · voir la date de collecte
                  </Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={16} color={c.muted} />
            </Pressable>
          );
        })}
      </View>
      <BottomSheet
        visible={!!selected}
        title={selected ? labels[selected] : "Contexte"}
        swipeToClose
        onClose={() => setSelected(undefined)}
      >
        {selected === "CONSUMPTION" ? (
          <Text className="text-muted">
            Achats des ménages publiés par FranceAgriMer. Le mois de
            consommation diffère de la date de récupération. Ce sont des repères
            nationaux, pas les ventes de ton magasin.
          </Text>
        ) : (
          <Text className="text-muted">
            Sélection d’annonces municipales, non exhaustive. Le lieu, les
            créneaux et l’impact réel sur ton magasin restent à vérifier. Une
            annonce n’est pas un constat terrain ; une période absente n’est pas
            reconstituée.
          </Text>
        )}
        {payload?.consumption ? (
          <>
            <Text className="text-lg font-semibold text-ink">
              Consommation · {payload.consumption.period}
            </Text>
            {payload.consumption.editionLabel ? (
              <Text className="text-muted">
                {payload.consumption.editionLabel}
              </Text>
            ) : null}
            {payload.consumption.reportUrl ? (
              <SecondaryButton
                label="Ouvrir la note originale"
                onPress={() => void open(payload.consumption!.reportUrl!)}
              />
            ) : null}
            {payload.consumption.groups.map((g) => (
              <View
                key={g.group}
                className="gap-2 rounded-2xl border border-line p-4"
              >
                <Text className="font-semibold text-ink">
                  {g.group === "FRUITS" ? "Fruits" : "Légumes"}
                </Text>
                <Text className="text-ink">
                  {number(g.quantityKgPerHousehold)} kg / ménage ·{" "}
                  {number(g.quantityAnnualPercent)} % sur un an
                </Text>
                <Text className="text-ink">
                  {number(g.averagePriceEurPerKg)} €/kg en moyenne ·{" "}
                  {number(g.priceAnnualPercent)} % sur un an
                </Text>
              </View>
            ))}
            <Text className="text-muted">
              Le prix moyen reflète aussi le mélange des produits achetés ; ce
              n’est pas un indice d’inflation à panier constant. Aucune dépense
              totale ni effet sur ton magasin n’est calculé à partir de ces
              moyennes. Édition consultée aujourd’hui, susceptible de révision ;
              publication historique non reconstituée.
            </Text>
          </>
        ) : null}
        {rows.map((item, i) => (
          <View
            key={`${item.sourceUrl}:${i}`}
            className="gap-2 border-t border-line pt-4"
          >
            <Text className="text-lg font-semibold text-ink">{item.title}</Text>
            <Text className="text-muted">
              {item.periodLabel || "Date à vérifier dans l’annonce"}
            </Text>
            {item.summary ? (
              <Text className="text-ink" selectable>
                {item.summary}
              </Text>
            ) : null}
            <SecondaryButton
              label="Lire l’annonce originale"
              onPress={() => void open(item.sourceUrl)}
            />
          </View>
        ))}
        {!payload ? (
          <Text className="text-muted">
            {source?.issue === "HISTORY_UNAVAILABLE"
              ? "Aucune version n’a été collectée avant la fin de cette semaine. Les annonces actuelles ne permettent pas de reconstituer les événements passés."
              : source?.status === "NOT_CONFIGURED"
                ? "Cette commune n’a pas encore de source locale raccordée."
                : "La source est indisponible ou son format a changé. Aucune valeur n’a été devinée."}
          </Text>
        ) : selected !== "CONSUMPTION" && !rows.length ? (
          <Text className="text-muted">
            Aucune annonce datée correspondante dans la sélection récupérée.
            Cela ne prouve pas l’absence d’événement local.
          </Text>
        ) : null}
        {source ? (
          <>
            <Text className="text-muted">
              {source.provider}
              {"\n"}Collecte de cette version :{" "}
              {stamp(archived?.firstCapturedAt ?? source.firstCapturedAt)}
              {"\n"}Dernière vérification : {stamp(source.retrievedAt)}
              {"\n"}Actualisation prévue après : {stamp(source.validUntil)}
            </Text>
            <SecondaryButton
              label="Ouvrir la source officielle"
              onPress={() => void open(source.sourceUrl)}
            />
            {source.history.length > 1 ? (
              <View className="gap-2">
                <Text className="font-semibold text-ink">
                  Historique des collectes
                </Text>
                <SecondaryButton
                  label="Dernière version disponible"
                  onPress={() => setRevision(undefined)}
                />
                {source.history.map((h) => (
                  <SecondaryButton
                    key={`${h.revision}:${h.firstCapturedAt}`}
                    label={`${stamp(h.firstCapturedAt)}${`${h.revision}:${h.firstCapturedAt}` === (revision ?? `${source.revision}:${source.firstCapturedAt}`) ? " · affichée" : ""}`}
                    onPress={() =>
                      setRevision(`${h.revision}:${h.firstCapturedAt}`)
                    }
                  />
                ))}
              </View>
            ) : null}
          </>
        ) : null}

        {linkError ? (
          <Text className="text-critical">Impossible d’ouvrir la source.</Text>
        ) : null}
        <SecondaryButton
          label={busy ? "Actualisation…" : "Actualiser les sources"}
          disabled={busy || !configured}
          onPress={onRefresh}
        />
        <Text className="text-muted">
          Collecte automatique ou sur demande ; les données des fournisseurs
          encore valides sont réutilisées. Aucun appel IA pour récupérer ces
          repères.
        </Text>
      </BottomSheet>
    </>
  );
}
