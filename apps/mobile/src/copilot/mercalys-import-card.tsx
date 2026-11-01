import { View } from "react-native";
import { ChatText as Text } from "./chat-text";
import {
  readCopilotImportReference,
  type CopilotMessage,
} from "@fl-copilot/domain";
import { colors } from "../design/tokens";
/** Historical references stay readable; mounting a message never starts an import. */
export function MercalysImportCard({ message }: { message: CopilotMessage }) {
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
        Fichiers conservés. Retrouvez leur état de publication dans Actions →
        Imports Mercalys.
      </Text>
    </View>
  );
}
