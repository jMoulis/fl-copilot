import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { MainHeader } from "../../../components/main-header";
import { BottomSheet, MenuRow } from "../../../components/ui";
import { colors } from "../../../design/tokens";
import { MercalysImportScreen } from "../../../documents/mercalys-import-screen";
import { useSync } from "../../../sync/sync-provider";

export default function ImportsHub() {
  const [choosing, setChoosing] = useState(false);
  const [mercalysChoosing, setMercalysChoosing] = useState(false);
  const nextMercalys = useRef(false);
  const nextCatalogue = useRef(false);
  const sync = useSync();
  function finishChoosing() {
    if (nextCatalogue.current) {
      nextCatalogue.current = false;
      router.push("/procurement-catalogue");
      return;
    }
    if (!nextMercalys.current) return;
    nextMercalys.current = false;
    setMercalysChoosing(true);
  }
  return (
    <>
      <MercalysImportScreen
        header={<MainHeader title="Imports" brand />}
        importMenu={{
          visible: mercalysChoosing,
          onClose: () => setMercalysChoosing(false),
        }}
        landing={
          <View className="gap-5">
            <View className="flex-row items-center justify-between gap-3">
              <View className="min-w-0 flex-1 gap-2">
                <Text className="text-xs text-muted">
                  Les documents du rayon
                </Text>
                <Text
                  accessibilityRole="header"
                  className="text-3xl font-semibold tracking-tight text-ink"
                >
                  Tes imports.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Importer un fichier"
                onPress={() => setChoosing(true)}
                className="min-h-11 flex-row items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-3 active:opacity-70"
              >
                <Ionicons
                  name="add-outline"
                  size={19}
                  color={colors.onAccent}
                  accessible={false}
                />
                <Text className="text-sm font-semibold text-on-accent">
                  Importer
                </Text>
              </Pressable>
            </View>
            <MenuRow
              title="Catalogue et offres"
              description="Référentiel Mercalys · offres de commande JSON"
              icon="layers-outline"
              onPress={() => router.push("/procurement-catalogue")}
            />
            <View className="flex-row items-center justify-between gap-3 border-b border-line pb-3">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Documents reçus par email"
                onPress={() => router.push("/email-inbox")}
                className="min-h-11 flex-row items-center gap-2 py-2"
              >
                <Ionicons
                  name="mail-outline"
                  size={18}
                  color={colors.forest}
                  accessible={false}
                />
                <Text className="text-sm text-forest">Réception email</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  sync.pendingCount
                    ? `Synchronisation · ${sync.pendingCount} éléments en attente`
                    : "Synchronisation et envois"
                }
                onPress={() => router.push("/sync-center")}
                className="min-h-11 min-w-0 flex-row items-center gap-2 py-2"
              >
                <Ionicons
                  name="sync-outline"
                  size={17}
                  color={colors.muted}
                  accessible={false}
                />
                <View>
                  <Text className="text-sm text-muted">Synchronisation</Text>
                  {sync.pendingCount ? (
                    <Text className="text-xs text-pending">
                      {sync.pendingCount} en attente
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            </View>
          </View>
        }
        footer={
          <View className="gap-2 border-t border-line pt-3">
            <MenuRow
              title="Tickets de casse"
              description="Photos, lignes à confirmer et originaux"
              icon="camera-outline"
              onPress={() => router.push("/waste-tickets")}
            />
            <MenuRow
              title="Documents commerciaux"
              description="Pense-bêtes et PDF conservés"
              icon="documents-outline"
              onPress={() => router.push("/commercial-documents")}
            />
          </View>
        }
      />
      <BottomSheet
        visible={choosing}
        title="Importer un document"
        onClose={() => setChoosing(false)}
        onDismiss={finishChoosing}
        swipeToClose
      >
        <MenuRow
          title="Ventes Mercalys"
          description="Ventes, casse ou prix d’achat · Excel ou ZIP"
          icon="document-text-outline"
          onPress={() => {
            nextMercalys.current = true;
            setChoosing(false);
          }}
        />
        <MenuRow
          title="Catalogue et offres"
          description="Référentiel Mercalys et JSON de commande"
          icon="layers-outline"
          onPress={() => {
            nextCatalogue.current = true;
            setChoosing(false);
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
    </>
  );
}
