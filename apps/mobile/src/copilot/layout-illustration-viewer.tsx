import { useEffect, useRef, useState } from "react";
import { Image, Text, View } from "react-native";
import type { CopilotMessage } from "@fl-copilot/domain";
import { InlineAlert, SecondaryButton } from "../components/ui";
import type {
  LayoutIllustrationTransfer,
  LayoutIllustrationView,
} from "./layout-illustration-transfer";
export function LayoutIllustrationViewer({
  transfer,
  message,
  current,
  synced,
}: {
  transfer: Pick<
    LayoutIllustrationTransfer,
    "load" | "refresh" | "setOfflineRequired"
  >;
  message: CopilotMessage;
  current: boolean;
  synced: boolean;
}) {
  const [view, setView] = useState<LayoutIllustrationView | null>(null),
    [busy, setBusy] = useState(false),
    [reading, setReading] = useState(true),
    [error, setError] = useState<string>(),
    [notice, setNotice] = useState<string>(),
    [original, setOriginal] = useState(false),
    epoch = useRef(0),
    working = useRef(false);
  useEffect(() => {
    const e = ++epoch.current;
    setView(null);
    setReading(true);
    setBusy(false);
    working.current = false;
    setOriginal(false);
    setError(undefined);
    setNotice(undefined);
    void transfer
      .load(message)
      .then((v) => {
        if (e === epoch.current) setView(v);
      })
      .catch(() => {
        if (e === epoch.current)
          setError(
            "Les images conservées ne peuvent pas être relues. Vous pouvez les récupérer à nouveau.",
          );
      })
      .finally(() => {
        if (e === epoch.current) setReading(false);
      });
    return () => {
      epoch.current = e + 1;
    };
  }, [transfer, message]);
  async function restore(wantOriginal = false) {
    if (working.current || !synced || reading) return;
    working.current = true;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    const e = epoch.current;
    try {
      const next = await transfer.refresh(message, wantOriginal);
      if (e === epoch.current) {
        if (next) {
          setView(next);
          setOriginal(wantOriginal);
        } else
          setNotice(
            "Aucune illustration n’est disponible pour cette préparation.",
          );
      }
    } catch (err) {
      if (e === epoch.current)
        setError(
          err instanceof Error &&
            err.message === "LAYOUT_ILLUSTRATION_CACHE_FULL"
            ? "L’espace réservé aux illustrations est plein (64 Mo par magasin et compte). Retirez la conservation hors connexion d’anciennes illustrations avant de réessayer. Les photos et documents d’origine restent conservés."
            : "Les images n’ont pas pu être récupérées. Les images déjà conservées restent disponibles.",
        );
    } finally {
      if (e === epoch.current) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  async function retainOffline() {
    if (working.current || reading || !view) return;
    const e = epoch.current;
    working.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const next = await transfer.setOfflineRequired(
        message,
        view.manifest.id,
        !view.offlineRequired,
      );
      if (e === epoch.current) setView(next);
    } catch {
      if (e === epoch.current)
        setError(
          "La préférence de conservation n’a pas pu être enregistrée. Vos images restent inchangées.",
        );
    } finally {
      if (e === epoch.current) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  const ready = !!view?.imageUri && !!view.sourceUri;
  return (
    <View className="gap-3">
      {view && !current ? (
        <InlineAlert
          title="Illustration historique"
          message="Les sources ont évolué. Cette image reste liée au plan et au scénario d’origine ; vérifiez-les avant de l’utiliser."
        />
      ) : null}
      {ready ? (
        <>
          <Text className="font-semibold text-ink">
            Schéma source · plan v{view.manifest.preparation.physicalVersion}
          </Text>
          <Image
            source={{ uri: view.sourceUri! }}
            accessibilityLabel="Schéma source, proportions et affectations enregistrées"
            resizeMode="contain"
            style={{
              width: "100%",
              aspectRatio: 1.5,
              backgroundColor: "white",
              borderRadius: 12,
            }}
            onError={() =>
              setError(
                "Le schéma ne peut pas être affiché. Récupérez-le à nouveau.",
              )
            }
          />
          <Text className="font-semibold text-ink">
            Illustration proposée par l’IA
          </Text>
          <Image
            source={{
              uri:
                original && view.originalUri
                  ? view.originalUri
                  : view.imageUri!,
            }}
            accessibilityLabel={
              original
                ? "Image originale produite par l’IA"
                : "Illustration indicative du scénario"
            }
            resizeMode="contain"
            style={{ width: "100%", aspectRatio: 1.5, borderRadius: 12 }}
            onError={() =>
              setError(
                "L’illustration ne peut pas être affichée. Récupérez-la à nouveau.",
              )
            }
          />
          <Text className="text-muted">
            L’illustration ne confirme ni les mesures, ni la capacité, ni la
            mise en place. Le schéma et les affectations enregistrées restent la
            référence.
          </Text>
          <SecondaryButton
            label={
              original
                ? "Voir l’image de consultation"
                : "Consulter l’image originale"
            }
            disabled={busy || reading || !synced}
            onPress={() => {
              if (original) setOriginal(false);
              else if (view.originalUri) setOriginal(true);
              else void restore(true);
            }}
          />
        </>
      ) : (
        <Text className="text-muted">
          {reading
            ? "Lecture des images conservées…"
            : view
              ? "Les images de cette illustration ne sont pas toutes disponibles sur cet appareil."
              : "Aucune illustration n’est conservée sur cet appareil."}
        </Text>
      )}
      {view && (ready || view.offlineRequired) ? (
        <View className="gap-3">
          {" "}
          <Text className="text-muted">
            {view.offlineRequired
              ? "Ces images sont conservées hors connexion sur cet appareil."
              : "Les anciennes copies peuvent être libérées pour limiter l’espace utilisé. Leurs originaux restent récupérables."}
          </Text>
          <SecondaryButton
            label={
              view.offlineRequired
                ? "Autoriser la libération de ces copies"
                : "Conserver hors connexion"
            }
            disabled={busy || reading}
            onPress={() => void retainOffline()}
          />
        </View>
      ) : null}
      <SecondaryButton
        label={
          busy
            ? "Récupération…"
            : ready
              ? "Actualiser l’illustration"
              : "Récupérer l’illustration"
        }
        disabled={busy || reading || !synced}
        onPress={() => void restore()}
      />
      {!synced ? (
        <Text className="text-muted">
          Synchronisez d’abord cette préparation pour retrouver ses images.
        </Text>
      ) : null}
      {notice ? (
        <Text accessibilityLiveRegion="polite" className="text-muted">
          {notice}
        </Text>
      ) : null}
      {error ? (
        <InlineAlert title="Images indisponibles" message={error} />
      ) : null}
    </View>
  );
}
