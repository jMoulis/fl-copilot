import { View } from "react-native";
import { ChatText as Text } from "./chat-text";
import type { RecommendationDecision } from "@fl-copilot/domain";
const done = {
  ACCEPT: "Acceptée",
  MODIFY: "Action modifiée",
  POSTPONE: "Reportée",
  REJECT: "Refusée",
};
export const decisionDate = (v: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  }).format(new Date(v));
export function ChoiceSummary({
  value,
}: {
  value: RecommendationDecision["revisions"][number];
}) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ fontWeight: "600" }}>
        {done[value.type]} · {decisionDate(value.decidedAt)}
      </Text>
      {value.modifiedAction ? <Text>{value.modifiedAction}</Text> : null}
      {value.postponeUntil ? (
        <Text>
          À reprendre le {value.postponeUntil.split("-").reverse().join("/")}
        </Text>
      ) : null}
      {value.reason ? <Text>Note : {value.reason}</Text> : null}
    </View>
  );
}
