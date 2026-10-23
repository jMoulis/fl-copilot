import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { colors } from "../design/tokens";
import {
  initializeLocalDatabase,
  recoverLocalDatabase,
  type LocalDatabase,
} from "../db/client";
import { activatePreparedLocalCopy } from "../db/local-copies-native";
import type { PreparedLocalCopy } from "../db/local-copy-contracts";
import { DatabaseStartupError } from "../db/database-recovery";
import { DatabaseStartupScreen } from "../db/database-startup-screen";

const RestoreContext = createContext<
  ((copy: PreparedLocalCopy, logout: Promise<void>) => void) | null
>(null);
const DatabaseContext = createContext<LocalDatabase | null>(null);

export function DatabaseProvider({ children }: PropsWithChildren) {
  const [restore, setRestore] = useState<{
    copy: PreparedLocalCopy;
    logout: Promise<void>;
  }>();
  const [restoreState, setRestoreState] = useState<
    "switching" | "restart" | "failed"
  >("switching");
  const requestRestore = useCallback(
    (copy: PreparedLocalCopy, logout: Promise<void>) => {
      void logout.catch(() => {});
      setRestore({ copy, logout });
    },
    [],
  );
  const [attempt, setAttempt] = useState(0);
  const [database, setDatabase] = useState<LocalDatabase>();
  const [error, setError] = useState<Error>();
  const [confirmRecovery, setConfirmRecovery] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [showRecoveryCompletion, setShowRecoveryCompletion] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    setDatabase(undefined);
    setError(undefined);
    setConfirmRecovery(false);

    void initializeLocalDatabase()
      .then((nextDatabase) => {
        if (mounted) setDatabase(nextDatabase);
      })
      .catch((reason: unknown) => {
        if (!mounted) return;
        setError(reason instanceof Error ? reason : new Error(String(reason)));
      });

    return () => {
      mounted = false;
    };
  }, [attempt]);

  const recover = async () => {
    setRecovering(true);
    try {
      const next = await recoverLocalDatabase();
      if (alive.current) {
        setDatabase(next);
        setError(undefined);
        setShowRecoveryCompletion(true);
      }
    } catch {
      if (alive.current) {
        setError(new DatabaseStartupError("UNAVAILABLE"));
        setConfirmRecovery(false);
      }
    } finally {
      if (alive.current) setRecovering(false);
    }
  };

  useEffect(() => {
    if (!restore) return;
    // Children are already unmounted at commit. Do not hot-swap SQLite under old callbacks.
    void restore.logout
      .then(() => activatePreparedLocalCopy(restore.copy))
      .then(() => {
        if (alive.current) setRestoreState("restart");
      })
      .catch(() => {
        if (alive.current) setRestoreState("failed");
      });
  }, [restore]);

  if (restore)
    return (
      <View style={styles.centered}>
        {restoreState === "switching" ? (
          <ActivityIndicator size="large" color={colors.forest} />
        ) : null}
        <Text style={styles.title}>
          {restoreState === "switching"
            ? "Préparation de la reprise…"
            : "Fermez puis rouvrez l’application"}
        </Text>
        <Text style={styles.message} accessibilityLiveRegion="polite">
          {restoreState === "failed"
            ? "La reprise n’a pas pu être confirmée. Toutes les copies restent conservées. Au redémarrage, reconnectez-vous puis vérifiez les données, sans supprimer l’application."
            : restoreState === "restart"
              ? "La copie vérifiée est prête. Reconnectez-vous avec le même compte après le redémarrage. Votre base précédente et les fichiers restent sur cet appareil ; aucune fusion automatique n’a été faite."
              : "Les accès sont fermés avant le changement de copie. Vos données restent conservées."}
        </Text>
      </View>
    );

  if (error || showRecoveryCompletion) {
    return (
      <DatabaseStartupScreen
        state={
          showRecoveryCompletion
            ? "recovered"
            : recovering
              ? "recovering"
              : confirmRecovery
                ? "confirm"
                : error instanceof DatabaseStartupError &&
                    error.kind === "CORRUPTION"
                  ? "corruption"
                  : "unavailable"
        }
        onRetry={() => setAttempt((value) => value + 1)}
        onPrepare={() => setConfirmRecovery(true)}
        onCancel={() => setConfirmRecovery(false)}
        onRecover={() => {
          void recover();
        }}
        onContinue={() => setShowRecoveryCompletion(false)}
      />
    );
  }

  if (!database) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.forest} />
        <Text style={styles.message}>Préparation des données locales…</Text>
      </View>
    );
  }

  return (
    <DatabaseContext.Provider value={database}>
      <RestoreContext.Provider value={requestRestore}>
        {children}
      </RestoreContext.Provider>
    </DatabaseContext.Provider>
  );
}

export function useLocalDatabase() {
  const database = useContext(DatabaseContext);
  if (!database) {
    throw new Error("useLocalDatabase must be used within DatabaseProvider.");
  }
  return database;
}

export function useDatabaseRestore() {
  const request = useContext(RestoreContext);
  if (!request) throw new Error("Database restore is unavailable.");
  return request;
}
export function useDatabaseAccessBinding() {
  return useLocalDatabase().accessBinding;
}

export function useDeviceIdentity() {
  return useLocalDatabase().deviceId;
}

const styles = StyleSheet.create({
  centered: {
    alignItems: "center",
    backgroundColor: colors.canvas,
    flex: 1,
    gap: 16,
    justifyContent: "center",
    padding: 24,
  },
  title: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
  },
  message: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
});
