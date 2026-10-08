import { useState } from "react";
import { Linking, Platform, Share } from "react-native";
import { File, Paths } from "expo-file-system";
import { ApiClient } from "@fl-copilot/api-client";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { getApiBaseUrl } from "@/config/environment";
import { SecondaryButton, InlineAlert } from "@/components/ui";
export function CommercialOriginalButton({
  sourceDocumentId,
}: {
  sourceDocumentId: string;
}) {
  const { session, withAccessToken } = useAuth();
  const storeId = session?.stores[0]?.storeId;
  const { sqlite } = useLocalDatabase();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  async function open() {
    if (!storeId || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const row = await sqlite.getFirstAsync<{ local_uri: string }>(
        "SELECT f.local_uri FROM local_files f JOIN source_documents s ON s.id=f.source_document_id WHERE s.store_id = ? AND s.id = ? AND s.source_type = 'WEEKLY_COMMERCIAL_PDF' ORDER BY f.created_at LIMIT 1",
        storeId,
        sourceDocumentId,
      );
      if (row && Platform.OS === "ios") {
        const direct = new File(row.local_uri);
        const recovered = new File(
          Paths.document,
          "commercial-pdfs",
          direct.name,
        );
        const local = direct.exists
          ? direct
          : recovered.exists
            ? recovered
            : null;
        if (local) {
          await Share.share({
            url: local.uri,
            title: "PDF commercial original",
          });
          return;
        }
      }
      const link = await withAccessToken((token) =>
        new ApiClient(getApiBaseUrl()).commercialOriginalLink(
          token,
          storeId,
          sourceDocumentId,
        ),
      );
      await Linking.openURL(link.url);
    } catch {
      setError(
        "Le PDF n’a pas pu être ouvert. La copie locale reste conservée ; reconnectez-vous pour accéder à l’original en ligne.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <SecondaryButton
        label={busy ? "Ouverture du PDF…" : "Consulter le PDF original"}
        disabled={busy || !storeId}
        onPress={() => void open()}
      />
      {error ? (
        <InlineAlert title="PDF original indisponible" message={error} />
      ) : null}
    </>
  );
}
