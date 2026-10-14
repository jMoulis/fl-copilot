import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { MercalysBatchRepository } from "../documents/mercalys-batch-repository";
import { MercalysArchiveRepository } from "../documents/mercalys-archive-repository";
import { SecondaryButton } from "../components/ui";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
/** Private device-local intake reference, not a remotely published assistant message. */
export function CopilotIntakeSummary({
  db,
  storeId,
  ownerId,
  conversationId,
  revision,
  onOpen,
}: {
  db: AtomicMutationDatabase & OutboxDatabase;
  storeId: string;
  ownerId: string;
  conversationId: string;
  revision: number;
  onOpen(): void;
}) {
  const repositories = useMemo(() => {
    const scope = { storeId, ownerId, conversationId };
    return {
      batches: new MercalysBatchRepository(db, scope),
      archives: new MercalysArchiveRepository(db, scope),
    };
  }, [db, storeId, ownerId, conversationId]);
  const [available, setAvailable] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void Promise.all([
      repositories.batches.recent(),
      repositories.archives.recent(),
    ])
      .then(([b, a]) => {
        if (alive) {
          setAvailable(!!(b.batches.length || a.archives.length));
          setFailed(false);
        }
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [repositories, revision]);
  if (!available && !failed) return null;
  return (
    <View className="mb-4 gap-2 rounded-xl border border-line p-3">
      <Text className="font-semibold text-ink">
        Fichiers Mercalys de cette conversation
      </Text>
      <Text className="text-sm text-muted">
        {failed
          ? "La liste ne peut pas être relue. Vos originaux restent conservés ; réessayez."
          : "Retrouvez vos lots et leur publication sur cet appareil."}
      </Text>
      <SecondaryButton label="Retrouver les fichiers" onPress={onOpen} />
    </View>
  );
}
