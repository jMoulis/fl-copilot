import { useState } from "react";
import { Text, View } from "react-native";
import type {
  StoreLayoutContent,
  StoreLayoutGeometry,
} from "@fl-copilot/domain";
import { InlineAlert, SecondaryButton } from "../components/ui";
import { colors } from "../design/tokens";

export function LayoutGeometryReport({
  content,
  result,
  onSelect,
}: {
  content: StoreLayoutContent;
  result: StoreLayoutGeometry;
  onSelect?: (id: string) => void;
}) {
  const [limit, setLimit] = useState(0);
  const blocking = result.issues.filter((i) => i.severity === "BLOCKING"),
    missing = result.issues.filter((i) => i.severity === "MISSING"),
    notices = result.issues.filter((i) => i.severity === "NOTICE");
  const ordered = [...blocking, ...missing, ...notices],
    count = limit || Math.min(5, blocking.length),
    shown = ordered.slice(0, count);
  const name = (id: string) =>
    id === "room"
      ? "Rayon"
      : ([...content.assemblies, ...content.furniture].find((f) => f.id === id)
          ?.label ?? "Élément à retrouver");
  return (
    <View style={{ gap: 14 }}>
      <Text className="font-semibold text-ink">
        {result.status === "BLOCKED"
          ? "Emprises à corriger"
          : result.status === "INCOMPLETE"
            ? "Mesures à compléter ou confirmer"
            : "Aucune incompatibilité détectée sur les emprises renseignées"}
      </Text>
      <Text className="text-muted">
        {result.counts.furniture} éléments · {result.counts.located} positions
        et emprises complètes · {result.counts.mobiles} mobiles. Les{" "}
        {result.counts.assemblies} îlots regroupent leurs éléments, sans être
        comptés comme du mobilier supplémentaire.
      </Text>
      {blocking.length ? (
        <InlineAlert
          title={`${blocking.length} incompatibilité${blocking.length > 1 ? "s" : ""}`}
          message="Vous pouvez conserver ce brouillon. Corrigez les éléments signalés avant de choisir ce plan comme référence."
        />
      ) : null}
      {missing.length ? (
        <Text className="text-muted">
          {missing.length} point{missing.length > 1 ? "s" : ""} à préciser. Les
          mesures de référence et superpositions sans hauteur libre restent à
          vérifier ; l’absence d’information ne vaut pas validation.
        </Text>
      ) : null}
      {shown.map((issue, i) => (
        <View
          key={`${issue.code}:${issue.targets.join(":")}:${i}`}
          style={{
            gap: 8,
            borderLeftWidth: 3,
            borderLeftColor:
              issue.severity === "BLOCKING" ? colors.critical : colors.line,
            paddingLeft: 12,
          }}
        >
          <Text
            style={{
              color:
                issue.severity === "BLOCKING" ? colors.critical : colors.ink,
            }}
          >
            {issue.message}
          </Text>
          {onSelect
            ? issue.targets.map((id) => (
                <SecondaryButton
                  key={id}
                  label={`Ouvrir ${name(id)}`}
                  onPress={() => onSelect(id)}
                />
              ))
            : null}
        </View>
      ))}
      {count < ordered.length ? (
        <SecondaryButton
          label={
            count
              ? `Afficher les points suivants (${ordered.length - count})`
              : `Voir les points à vérifier (${ordered.length})`
          }
          onPress={() => setLimit(count + 10)}
        />
      ) : null}
      {limit > 0 ? (
        <SecondaryButton
          label="Réduire le détail du contrôle"
          onPress={() => setLimit(0)}
        />
      ) : null}
      <Text className="text-sm text-muted">
        Contrôle provisoire des emprises et des hauteurs libres renseignées. Les
        passages, obstacles, charges, stabilité et surfaces de vente ne sont pas
        contrôlés ici. Une surface inconnue ne reçoit aucune capacité déduite.
      </Text>
    </View>
  );
}
