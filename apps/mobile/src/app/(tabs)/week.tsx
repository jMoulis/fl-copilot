import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { requireOptionalNativeModule } from "expo-modules-core";
import { randomUUID } from "expo-crypto";
import type { LocalSourceDocument } from "@fl-copilot/domain";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { SourceDocumentRepository } from "@/documents/source-document-repository";
import { captureCommercialPdf } from "@/documents/commercial-pdf-capture";
import {
  AppScreen,
  AppHeader,
  EmptyState,
  InlineAlert,
  PrimaryButton,
  SectionCard,
} from "@/components/ui";

interface NativePdfPicker {
  getDocumentAsync(options: {
    type: string[];
    copyToCacheDirectory: boolean;
    multiple: boolean;
    base64: boolean;
  }): Promise<
    | { canceled: true }
    | {
        canceled: false;
        assets: Array<{ uri: string; name: string; mimeType?: string }>;
      }
  >;
}
const picker =
  requireOptionalNativeModule<NativePdfPicker>("ExpoDocumentPicker");

export default function WeekScreen() {
  const { session } = useAuth();
  const { sqlite } = useLocalDatabase();
  const storeId = session?.stores[0]?.storeId;
  const repository = useMemo(
    () => new SourceDocumentRepository(sqlite),
    [sqlite],
  );
  const [documents, setDocuments] = useState<LocalSourceDocument[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (storeId)
        void repository
          .listDocuments(storeId, "WEEKLY_COMMERCIAL_PDF")
          .then((items) => {
            if (active) setDocuments(items);
          })
          .catch(() => {
            if (active)
              setError(
                "Les documents enregistrés ne peuvent pas être lus. Réouvrez cet écran pour réessayer.",
              );
          });
      return () => {
        active = false;
      };
    }, [repository, storeId]),
  );

  async function importPdf() {
    if (!storeId || !picker || busy) return;
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const selection = await picker.getDocumentAsync({
        type: ["application/pdf"],
        copyToCacheDirectory: true,
        multiple: false,
        base64: false,
      });
      if (selection.canceled) return;
      const asset = selection.assets[0];
      if (!asset) throw new Error("COMMERCIAL_PDF_INVALID");
      const result = await captureCommercialPdf(
        {
          uri: asset.uri,
          originalFilename: asset.name,
          mimeType: asset.mimeType,
          storeId,
          documentId: randomUUID(),
          fileId: randomUUID(),
          capturedAt: new Date().toISOString(),
        },
        repository,
      );
      setMessage(
        result.duplicate
          ? "Ce PDF est déjà enregistré. Aucune nouvelle copie n’a été ajoutée."
          : "Document enregistré sur cet appareil, disponible hors connexion.",
      );
      setDocuments(
        await repository.listDocuments(storeId, "WEEKLY_COMMERCIAL_PDF"),
      );
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "";
      setError(
        code === "COMMERCIAL_PDF_INVALID"
          ? "Ce fichier n’est pas un PDF reconnu. Choisissez le document commercial au format PDF."
          : code === "COMMERCIAL_PDF_SIZE_INVALID"
            ? "Le PDF est vide ou dépasse 100 Mo. Choisissez un document plus petit."
            : "Le PDF n’a pas pu être enregistré. Le fichier original reste conservé. Réessayez l’import.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppScreen>
      <AppHeader
        title="Ma semaine"
        subtitle="Préparer les temps forts du rayon."
      />
      <SectionCard
        title="Documents commerciaux"
        description="Conservez les PDF du rayon sur cet appareil, même hors connexion."
      >
        <PrimaryButton
          label={busy ? "Enregistrement…" : "Importer le PDF hebdo"}
          loading={busy}
          disabled={!storeId || !picker}
          onPress={() => void importPdf()}
        />
        {!picker ? (
          <InlineAlert
            title="Mise à jour nécessaire"
            message="Installez le dernier build de l’application pour choisir un PDF."
          />
        ) : null}
        <Text className="text-sm leading-5 text-muted">
          L’analyse commerciale sera disponible dans une prochaine version. Vos
          documents restent enregistrés en attendant.
        </Text>
      </SectionCard>
      {message ? (
        <InlineAlert title="Document enregistré" message={message} />
      ) : null}
      {error ? <InlineAlert title="Import impossible" message={error} /> : null}
      {documents.map((document) => (
        <SectionCard
          key={document.id}
          title={document.originalFilename ?? "Document commercial"}
        >
          <View className="gap-2">
            <Text className="text-sm text-muted">
              Enregistré le{" "}
              {new Date(document.createdAt).toLocaleDateString("fr-FR")}
            </Text>
            <Text className="font-semibold text-forest">
              Conservé sur cet appareil
            </Text>
            <Text className="text-sm text-muted">Analyse en attente</Text>
          </View>
        </SectionCard>
      ))}
      <EmptyState
        title="Aucune opération disponible"
        message="Les opérations apparaîtront ici après l’analyse et la validation de vos documents commerciaux."
        icon="calendar-outline"
      />
    </AppScreen>
  );
}
