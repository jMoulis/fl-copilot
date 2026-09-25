import {
  createContext,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { initializeLocalDatabase, type LocalDatabase } from "../db/client";

const DatabaseContext = createContext<LocalDatabase | null>(null);

export function DatabaseProvider({ children }: PropsWithChildren) {
  const [attempt, setAttempt] = useState(0);
  const [database, setDatabase] = useState<LocalDatabase>();
  const [error, setError] = useState<Error>();

  useEffect(() => {
    let mounted = true;
    setDatabase(undefined);
    setError(undefined);

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

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Base locale indisponible</Text>
        <Text style={styles.message}>{error.message}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => setAttempt((value) => value + 1)}
          style={styles.button}
        >
          <Text style={styles.buttonLabel}>Réessayer</Text>
        </Pressable>
      </View>
    );
  }

  if (!database) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#166534" />
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
    backgroundColor: "#f7fee7",
    flex: 1,
    gap: 16,
    justifyContent: "center",
    padding: 24,
  },
  title: {
    color: "#3f6212",
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
  },
  message: {
    color: "#4d7c0f",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  button: {
    backgroundColor: "#166534",
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  buttonLabel: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
});
