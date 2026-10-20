import {
  createContext,
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
import { DatabaseStartupError } from "../db/database-recovery";
import { DatabaseStartupScreen } from "../db/database-startup-screen";

const DatabaseContext = createContext<LocalDatabase | null>(null);

export function DatabaseProvider({ children }: PropsWithChildren) {
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
      {children}
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
