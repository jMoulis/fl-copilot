import { copilotImportMessageText } from "@fl-copilot/domain";
import { ActionSheetIOS, Alert, Platform } from "react-native";
import type { CopilotMessage } from "@fl-copilot/domain";
/** Native long-press actions; copy strips private citation payloads. */
export function showMessageMenu(message: CopilotMessage, onDelete: () => void) {
  const canCopy = !!message.text.trim();
  const copy = async () => {
    try {
      const clipboard = await import("expo-clipboard");
      const text = copilotImportMessageText(message).replace(
        /\[([^\]]+)\]\(copilot-source:[^)]+\)/g,
        "$1",
      );
      if (!(await clipboard.setStringAsync(text))) throw Error("COPY_FAILED");
    } catch {
      Alert.alert("Copie impossible", "Réessayez de copier ce message.");
    }
  };
  if (Platform.OS === "ios")
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: canCopy
          ? ["Copier", "Supprimer", "Annuler"]
          : ["Supprimer", "Annuler"],
        destructiveButtonIndex: canCopy ? 1 : 0,
        cancelButtonIndex: canCopy ? 2 : 1,
      },
      (index) => {
        if (canCopy && index === 0) void copy();
        if (index === (canCopy ? 1 : 0)) onDelete();
      },
    );
  else
    Alert.alert("Message", undefined, [
      ...(canCopy
        ? [
            {
              text: "Copier",
              onPress: () => {
                void copy();
              },
            },
          ]
        : []),
      { text: "Supprimer", style: "destructive", onPress: onDelete },
      { text: "Annuler", style: "cancel" },
    ]);
}
