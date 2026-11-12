import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { MainHeader } from "../../../components/main-header";
import {
  AppScreen,
  BottomSheet,
  MenuRow,
  PrimaryButton,
  SecondaryButton,
} from "../../../components/ui";
import { useSync } from "../../../sync/sync-provider";
export default function ImportsHub() {
  const [choosing, setChoosing] = useState(false);
  const sync = useSync();
  return (
    <AppScreen header={<MainHeader title="Imports" />}>
      <Text className="text-muted">Ajouter et retrouver tes données.</Text>
      <PrimaryButton
        label="Importer un fichier"
        onPress={() => setChoosing(true)}
      />
      <View className="gap-3 rounded-3xl border border-line bg-surface p-4">
        <MenuRow
          title="Mercalys"
          description="Fichiers Excel, ZIP et lots importés"
          icon="document-text-outline"
          onPress={() => router.push("/mercalys-imports")}
        />
        <MenuRow
          title="Casse"
          description="Photographier ou examiner un ticket"
          icon="camera-outline"
          onPress={() => router.push("/waste-tickets")}
        />
        <MenuRow
          title="Documents commerciaux"
          description="Pense-bêtes et PDF originaux"
          icon="documents-outline"
          onPress={() => router.push("/commercial-documents")}
        />
        <MenuRow
          title="Emails reçus"
          description="Les documents envoyés au magasin"
          icon="mail-outline"
          onPress={() => router.push("/email-inbox")}
        />
      </View>
      <SecondaryButton
        label={
          sync.pendingCount
            ? `Synchronisation · ${sync.pendingCount} éléments en attente`
            : "Synchronisation et envois"
        }
        onPress={() => router.push("/sync-center")}
      />
      <BottomSheet
        visible={choosing}
        title="Importer un document"
        onClose={() => setChoosing(false)}
        swipeToClose
      >
        <MenuRow
          title="Ventes Mercalys"
          description="Excel ou ZIP"
          icon="document-text-outline"
          onPress={() => {
            setChoosing(false);
            router.push("/mercalys-imports");
          }}
        />
        <MenuRow
          title="Ticket de casse"
          description="Photo ou fichier"
          icon="camera-outline"
          onPress={() => {
            setChoosing(false);
            router.push("/waste-tickets");
          }}
        />
        <MenuRow
          title="Document commercial"
          description="Pense-bête PDF"
          icon="documents-outline"
          onPress={() => {
            setChoosing(false);
            router.push("/commercial-documents");
          }}
        />
      </BottomSheet>
    </AppScreen>
  );
}
