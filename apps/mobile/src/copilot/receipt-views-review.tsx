import { ReceiptPhotoOrder } from "./receipt-photo-order";
import { useState } from "react";
import { Modal, ScrollView, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { CopilotReceiptViewsSelection } from "@fl-copilot/domain";
import { PrimaryButton, SecondaryButton } from "../components/ui";
import { colors } from "../design/tokens";
type Assets = CopilotReceiptViewsSelection["assets"];
export function ReceiptViewsReview({
  assets,
  onFinish,
}: {
  assets: Assets;
  onFinish(assets: Assets | null): void;
}) {
  const [ordered, setOrdered] = useState(assets);
  const move = (index: number, delta: number) =>
    setOrdered((previous) => {
      const next = [...previous],
        target = index + delta;
      if (target < 0 || target >= next.length) return previous;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  return (
    <Modal visible animationType="slide" onRequestClose={() => onFinish(null)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
          <Text className="text-2xl font-semibold text-ink">
            Un seul ticket · {ordered.length} vues
          </Text>
          <Text className="text-base text-muted">
            Placez les photos du haut vers le bas, avec un léger recouvrement.
            Incluez le bas du ticket pour la date et le numéro de caissier.
          </Text>
          <ReceiptPhotoOrder
            assets={ordered}
            onMove={move}
            onRemove={(index) =>
              setOrdered((previous) => previous.filter((_, i) => i !== index))
            }
          />
          {ordered.length < 2 ? (
            <Text className="text-base text-muted">
              Conservez au moins deux vues, ou annulez et choisissez « Tickets
              de casse » pour une seule photo.
            </Text>
          ) : null}
          <PrimaryButton
            label="Joindre ce ticket"
            disabled={ordered.length < 2}
            onPress={() => onFinish(ordered)}
          />
          <SecondaryButton label="Annuler" onPress={() => onFinish(null)} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
