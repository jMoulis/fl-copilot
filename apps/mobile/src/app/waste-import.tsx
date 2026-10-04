import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { Redirect, useRouter, type Href } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "@/auth/auth-provider";
import {
  AppHeader,
  AppScreen,
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
} from "@/components/ui";
import {
  persistWasteReceiptImport,
  UnsupportedWasteReceiptImageError,
} from "@/documents/waste-receipt-capture";
import { WasteReceiptRepository } from "@/documents/waste-receipt-repository";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";

export default function WasteImportScreen() {
  const router = useRouter();
  const { status, session } = useAuth();
  const database = useLocalDatabase();
  const { syncNow } = useSync();
  const receiptRepository = useMemo(
    () => new WasteReceiptRepository(database.sqlite),
    [database.sqlite],
  );
  const storeId = session?.stores[0]?.storeId;
  const [savedReceiptId, setSavedReceiptId] = useState<string>();
  const [possibleDuplicate, setPossibleDuplicate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (status === "loading") return null;
  if (status !== "authenticated") {
    return <Redirect href={"/login" as Href} />;
  }

  async function choosePhoto() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        allowsMultipleSelection: false,
        quality: 1,
        exif: false,
      });
      if (result.canceled) return;
      if (!storeId) throw new Error("WASTE_RECEIPT_STORE_MISSING");
      const asset = result.assets[0];
      if (!asset) throw new Error("WASTE_RECEIPT_IMAGE_MISSING");
      const receiptId = randomUUID();
      const saved = await persistWasteReceiptImport({
        temporaryUri: asset.uri,
        captureId: receiptId,
        mimeType: asset.mimeType,
        originalFilename: asset.fileName,
      });
      const created = await receiptRepository.createCapturedDraft({
        receiptId,
        fileId: randomUUID(),
        sourceDocumentId: randomUUID(),
        uploadJobId: randomUUID(),
        storeId,
        capturedAt: new Date().toISOString(),
        file: { ...saved, originalFilename: saved.filename },
      });
      if (created.uploadQueued) void syncNow(storeId);
      setPossibleDuplicate(Boolean(created.duplicateCandidate));
      setSavedReceiptId(receiptId);
    } catch (caught) {
      setError(
        caught instanceof UnsupportedWasteReceiptImageError
          ? "Ce format n’est pas pris en charge. Choisissez une photo JPEG, PNG ou HEIC."
          : "La photo n’a pas pu être importée. Réessayez avant de quitter.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (savedReceiptId) {
    return (
      <AppScreen>
        <AppHeader
          title="Photo importée"
          subtitle="Le ticket est conservé dans l’espace privé de l’application."
        />
        <View className="gap-4 rounded-3xl border border-line bg-white p-5">
          <StatusBadge status={possibleDuplicate ? "incomplete" : "pending"} />
          <Text className="text-base leading-6 text-ink">
            {possibleDuplicate
              ? "La même image existe déjà. Comparez les deux tickets avant tout envoi."
              : "Le ticket reste disponible après la fermeture de l’application. Son envoi reprendra automatiquement dès que le réseau sera disponible."}
          </Text>
        </View>
        <PrimaryButton
          label={possibleDuplicate ? "Examiner le doublon" : "Terminer"}
          onPress={() =>
            possibleDuplicate
              ? router.replace(`/waste-receipt/${savedReceiptId}`)
              : router.back()
          }
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen>
      <AppHeader
        title="Importer une photo"
        subtitle="Choisissez une photo complète et lisible du ticket de casse."
      />
      {error ? <InlineAlert title="Import impossible" message={error} /> : null}
      <View className="gap-3 rounded-3xl border border-line bg-white p-5">
        <Text className="text-base leading-6 text-ink">
          Formats acceptés : JPEG, PNG et HEIC.
        </Text>
        <Text className="text-sm leading-5 text-muted">
          La photo sélectionnée est copiée dans l’application. L’original reste
          dans votre photothèque.
        </Text>
      </View>
      <PrimaryButton
        label="Choisir une photo"
        loading={busy}
        onPress={() => {
          void choosePhoto();
        }}
      />
      <SecondaryButton label="Annuler" onPress={() => router.back()} />
    </AppScreen>
  );
}
