import { Text, View } from "react-native";
import type { ObservedWeatherContext } from "@fl-copilot/domain";
import { SecondaryButton } from "../components/ui";
import { contextIsStale } from "../store/weekly-context-repository";
import { weatherNumber } from "./journal-presentation";

export function observedValue(value: string | null | undefined) {
  return value == null ? null : Number(value);
}
export function JournalObservedWeather({
  context,
  date,
  onSource,
}: {
  context: ObservedWeatherContext;
  date: string;
  onSource(url: string): void;
}) {
  const day = context.days.find((d) => d.producerDate === date),
    reference = context.reference;
  const stamp = (s: string) =>
    new Date(s).toLocaleString("fr-FR", {
      timeZone: "Europe/Paris",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  return (
    <View className="gap-3">
      <Text className="text-lg font-semibold text-ink">
        Météo observée · station
      </Text>
      {reference ? (
        <>
          <Text className="text-ink">
            {reference.station.name} · {weatherNumber(reference.distanceKm)} km
            à vol d’oiseau
          </Text>
          <Text className="text-muted">
            La référence automatique est la station la plus proche dans le
            fichier récent de ton département. Ses mesures décrivent la station,
            pas précisément le magasin.
          </Text>
        </>
      ) : null}
      {day ? (
        <>
          <Text className="text-ink">
            Min.{" "}
            {weatherNumber(observedValue(day.measurements.TN.analysisValue))} °C
            · max.{" "}
            {weatherNumber(observedValue(day.measurements.TX.analysisValue))} °C
          </Text>
          <Text className="text-ink">
            {day.measurements.RR.analysisValue === null
              ? "Cumul de pluie indisponible"
              : `${weatherNumber(observedValue(day.measurements.RR.analysisValue))} mm · cumul producteur`}
          </Text>
          <Text className="text-muted">
            Cumul de 06 h UTC à 06 h UTC le lendemain : du{" "}
            {stamp(day.rainfallWindow.from)} au {stamp(day.rainfallWindow.to)},
            heure de Paris. La source l’affecte au {day.producerDate} : ce ne
            sont pas les horaires d’ouverture du magasin.
          </Text>
          <Text className="text-muted">
            Seules les mesures protégées ou validées par le producteur sont
            affichées. Une valeur absente ou non validée reste inconnue. La
            température et la pluie seules ne décrivent pas l’ensoleillement.
          </Text>
          <Text className="text-muted">
            Source récupérée le {stamp(day.sourceRetrievedAt)}
            {contextIsStale(context, new Date())
              ? " · données à actualiser"
              : ""}
            . Les séries peuvent être révisées ; la publication initiale de
            chaque mesure n’est pas connue.
          </Text>
        </>
      ) : (
        <Text className="text-muted">
          {context.issue === "UNSUPPORTED_REGION"
            ? "La météo observée de cette région n’est pas encore prise en charge."
            : context.issue === "NO_ARCHIVE"
              ? "L’archive nécessaire n’est pas disponible."
              : context.issue === "PROVIDER_UNAVAILABLE"
                ? "La source météo est momentanément indisponible."
                : "Aucune mesure exploitable enregistrée pour cette journée."}{" "}
          Une absence de mesure ne signifie pas zéro pluie.
        </Text>
      )}
      <SecondaryButton
        label="Source météo · Météo-France · Licence ouverte"
        onPress={() => onSource(context.sourceUrl)}
      />
    </View>
  );
}
