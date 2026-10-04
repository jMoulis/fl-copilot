import { useState } from "react";
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

export default function WasteImportScreen() {
  const router = useRouter();
  const { status } = useAuth();
  const [saved, setSaved] = useState(false);
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
      const asset = result.assets[0];
      if (!asset) throw new Error("WASTE_RECEIPT_IMAGE_MISSING");
      await persistWasteReceiptImport({
        temporaryUri: asset.uri,
        captureId: randomUUID(),
        mimeType: asset.mimeType,
        originalFilename: asset.fileName,
      });
      setSaved(true);
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

  if (saved) {
    return (
      <AppScreen>
        <AppHeader
          title="Photo importée"
          subtitle="Le ticket est conservé dans l’espace privé de l’application."
        />
        <View className="gap-4 rounded-3xl border border-line bg-white p-5">
          <StatusBadge status="local" />
          <Text className="text-base leading-6 text-ink">
            L’analyse et la synchronisation seront ajoutées dans les prochaines
            étapes du parcours Casse.
          </Text>
        </View>
        <PrimaryButton label="Terminer" onPress={() => router.back()} />
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
