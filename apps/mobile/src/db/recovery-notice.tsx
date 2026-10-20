import { InlineAlert } from "../components/ui";
import { useLocalDatabase } from "../providers/database-provider";

export function LocalDatabaseRecoveryNotice() {
  const { recovery } = useLocalDatabase();
  if (!recovery) return null;
  return (
    <InlineAlert
      title="Ancienne copie locale conservée"
      message="Les données synchronisées sont retrouvées par la synchronisation normale après connexion. Les modifications non envoyées de l’ancienne copie ne sont pas comptées dans cette liste et restent à examiner. Les fichiers sont conservés : ne supprimez pas l’application."
    />
  );
}
