import { useEffect, useMemo, useState } from "react";
import { Text } from "react-native";
import {
  randomUUID,
  digestStringAsync,
  CryptoDigestAlgorithm,
} from "expo-crypto";
import {
  recommendationDecisionSchema,
  copilotMessageSchema,
  type CopilotMessage,
} from "@fl-copilot/domain";
import { useAuth } from "../auth/auth-provider";
import { useLocalDatabase } from "../providers/database-provider";
import type { SyncConflict } from "../sync/conflict-repository";
import { CopilotDecisionRepository } from "./decision-repository";
import { RecommendationDecisionReview } from "./recommendation-decision-review";
export function RecommendationDecisionConflict({
  conflict,
}: {
  conflict: SyncConflict;
}) {
  const { session } = useAuth(),
    { deviceId } = useLocalDatabase(),
    store = session?.stores[0];
  return session && store?.storeId === conflict.storeId ? (
    <DecisionConflictContent
      key={`${session.user.id}:${store.storeId}:${store.role}:${deviceId}:${conflict.id}:${conflict.entityId}`}
      conflict={conflict}
    />
  ) : (
    <Text>
      Ouvrez cette décision depuis son compte et son magasin d’origine.
    </Text>
  );
}
function DecisionConflictContent({ conflict }: { conflict: SyncConflict }) {
  const { session } = useAuth(),
    { sqlite, deviceId } = useLocalDatabase(),
    ownerId = session?.user.id;
  const permitted =
    !!ownerId && !!session?.stores.some((s) => s.storeId === conflict.storeId);
  const repository = useMemo(
    () =>
      new CopilotDecisionRepository(
        sqlite,
        {
          storeId: conflict.storeId,
          ownerId: ownerId ?? "",
          deviceId,
          canDecide: permitted,
        },
        (s) => digestStringAsync(CryptoDigestAlgorithm.SHA256, s),
        randomUUID,
      ),
    [sqlite, conflict.storeId, ownerId, deviceId, permitted],
  );
  const [message, setMessage] = useState<CopilotMessage | null>();
  useEffect(() => {
    let active = true;
    setMessage(undefined);
    if (!permitted) {
      setMessage(null);
      return;
    }
    void (async () => {
      const row = await sqlite.getFirstAsync<{ payload_json: string }>(
        "SELECT payload_json FROM copilot_decisions WHERE id=? AND store_id=? AND owner_id=?",
        conflict.entityId,
        conflict.storeId,
        ownerId!,
      );
      if (!row) return null;
      const decision = recommendationDecisionSchema.parse(
        JSON.parse(row.payload_json),
      );
      if (decision.storeId !== conflict.storeId || decision.ownerId !== ownerId)
        throw Error("COPILOT_DECISION_SCOPE_INVALID");
      return sqlite.getFirstAsync<{ payload_json: string }>(
        "SELECT payload_json FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=?",
        decision.revisions.at(-1)!.proposalMessageId,
        conflict.storeId,
        ownerId!,
      );
    })()
      .then((row) => {
        if (active)
          setMessage(
            row
              ? copilotMessageSchema.parse(JSON.parse(row.payload_json))
              : null,
          );
      })
      .catch(() => {
        if (active) setMessage(null);
      });
    return () => {
      active = false;
    };
  }, [sqlite, conflict.entityId, conflict.storeId, ownerId, permitted]);
  return message ? (
    <RecommendationDecisionReview
      message={message}
      repository={repository}
      canConfirm={permitted}
      onResolved={() => undefined}
    />
  ) : (
    <Text>
      {message === undefined
        ? "Chargement de la décision…"
        : "La carte d’origine n’est pas disponible localement. Actualisez l’historique du chat avant de résoudre ce conflit."}
    </Text>
  );
}
