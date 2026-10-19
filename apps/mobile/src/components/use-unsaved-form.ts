import { useEffect } from "react";
import { Alert, Platform } from "react-native";
import { useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";

/** Tabs keep the editor mounted; only destructive removals require confirmation. */
export function useUnsavedForm(dirty: boolean, saving: boolean) {
  const navigation = useNavigation();
  usePreventRemove(dirty || saving, ({ data }) => {
    if (saving) {
      if (Platform.OS === "web") {
        window.alert("Patientez jusqu’à la fin de l’opération en cours.");
        return;
      }
      Alert.alert(
        "Opération en cours",
        "Patientez jusqu’à la fin de l’opération en cours.",
      );
      return;
    }
    if (Platform.OS === "web") {
      if (
        window.confirm(
          "Quitter sans enregistrer ? Vos modifications non enregistrées seront perdues.",
        )
      )
        navigation.dispatch(data.action);
      return;
    }
    Alert.alert(
      "Quitter sans enregistrer ?",
      "Vos modifications non enregistrées seront perdues.",
      [
        { text: "Continuer la saisie", style: "cancel" },
        {
          text: "Abandonner les modifications",
          style: "destructive",
          onPress: () => navigation.dispatch(data.action),
        },
      ],
    );
  });
  useEffect(() => {
    if (Platform.OS !== "web" || (!dirty && !saving)) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty, saving]);
}
