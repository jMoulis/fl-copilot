import { Image, Text, View } from "react-native";
import type { CopilotReceiptCameraSelection } from "@fl-copilot/domain";
import { SecondaryButton } from "../components/ui";
export function ReceiptPhotoOrder({
  assets,
  disabled = false,
  onMove,
  onRemove,
  onRetake,
}: {
  assets: CopilotReceiptCameraSelection["assets"];
  disabled?: boolean;
  onMove(index: number, delta: -1 | 1): void;
  onRemove(index: number): void;
  onRetake?(index: number): void;
}) {
  return assets.map((asset, index) => (
    <View key={asset.uri} className="gap-2 rounded-2xl border border-line p-3">
      <Text className="font-semibold text-ink">
        Vue {index + 1} · {asset.filename}
      </Text>
      <Image
        source={{ uri: asset.uri }}
        resizeMode="contain"
        style={{ height: 240, width: "100%" }}
        accessibilityLabel={`Vue ${index + 1} du même ticket`}
      />
      {assets.length > 1 ? (
        <>
          <SecondaryButton
            label={`Monter la vue ${index + 1}`}
            disabled={disabled || index === 0}
            onPress={() => onMove(index, -1)}
          />
          <SecondaryButton
            label={`Descendre la vue ${index + 1}`}
            disabled={disabled || index === assets.length - 1}
            onPress={() => onMove(index, 1)}
          />
        </>
      ) : null}
      {onRetake ? (
        <SecondaryButton
          label={`Reprendre la vue ${index + 1}`}
          disabled={disabled}
          onPress={() => onRetake(index)}
        />
      ) : null}
      <SecondaryButton
        label={`Retirer la vue ${index + 1}`}
        disabled={disabled}
        onPress={() => onRemove(index)}
      />
    </View>
  ));
}
