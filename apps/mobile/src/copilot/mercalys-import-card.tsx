import { View } from "react-native";
import { ChatText as Text } from "./chat-text";
import {
  readCopilotImportReference,
  type CopilotMessage,
} from "@fl-copilot/domain";
import { SecondaryButton } from "../components/ui";
import { colors } from "../design/tokens";
/** Historical references stay readable; mounting a message never starts an import. */
export function MercalysImportCard({
  message,
  canOpen,
  onOpen,
}: {
  message: CopilotMessage;
  canOpen: boolean;
  onOpen(): void;
}) {
  const { reference } = readCopilotImportReference(message);
  return (
    <View
      style={{
        padding: 16,
        gap: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.forest,
      }}
    >
      <Text style={{ fontWeight: "700", color: colors.forest }}>
        {reference.label}
      </Text>
      <Text>
        Retrouvez les fichiers conservés et leur état de publication dans les
        imports Mercalys.
      </Text>
      {canOpen ? (
        <SecondaryButton label="Ouvrir les imports Mercalys" onPress={onOpen} />
      ) : null}
    </View>
  );
}
