import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import type { StoreLayoutContent } from "@fl-copilot/domain";
import {
  associateStoreLayoutMobile,
  placeStoreLayoutObject,
} from "@fl-copilot/commercial-core";
import { InlineAlert, PrimaryButton, SecondaryButton } from "../components/ui";
import { colors } from "../design/tokens";
import { layoutNumber, parseLayoutMeasure } from "./layout-view-model";
type Furniture = StoreLayoutContent["furniture"][number];
export function LayoutPhysicalFields({
  content,
  id,
  kind,
  busy,
  onApply,
}: {
  content: StoreLayoutContent;
  id: string;
  kind: "ASSEMBLY" | "FURNITURE";
  busy: boolean;
  onApply: (content: StoreLayoutContent) => void;
}) {
  const object =
    kind === "ASSEMBLY"
      ? content.assemblies.find((a) => a.id === id)!
      : content.furniture.find((f) => f.id === id)!;
  const furniture =
    kind === "FURNITURE" ? content.furniture.find((f) => f.id === id)! : null;
  const [label, setLabel] = useState(object.label),
    [x, setX] = useState(layoutNumber(object.x)),
    [y, setY] = useState(layoutNumber(object.y)),
    [rotation, setRotation] = useState(object.rotation),
    [clearance, setClearance] = useState(
      furniture ? layoutNumber(furniture.clearanceBelow) : "",
    ),
    [hostId, setHostId] = useState(furniture?.hostId ?? null),
    [showHosts, setShowHosts] = useState(false),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [applied, setApplied] = useState(false);
  function apply() {
    const issues: Record<string, string> = {};
    const name = label.trim();
    if (!name || name.length > 120)
      issues.label = "Indiquez un nom de 1 à 120 caractères.";
    const parse = (key: string, text: string, previous: Furniture["x"]) => {
      try {
        return parseLayoutMeasure(text, previous, false, true);
      } catch (e) {
        issues[key] = e instanceof Error ? e.message : "Valeur à vérifier";
        return previous;
      }
    };
    const px = parse("x", x, object.x),
      py = parse("y", y, object.y),
      pc = furniture
        ? parse("clearance", clearance, furniture.clearanceBelow)
        : null;
    setErrors(issues);
    if (Object.keys(issues).length) return;
    try {
      let next = placeStoreLayoutObject(content, kind, id, {
        x: px,
        y: py,
        rotation,
      });
      if (furniture?.kind === "MOBILE")
        next = associateStoreLayoutMobile(next, id, hostId);
      next = {
        ...next,
        assemblies: next.assemblies.map((a) =>
          kind === "ASSEMBLY" && a.id === id ? { ...a, label: name } : a,
        ),
        furniture: next.furniture.map((f) =>
          kind === "FURNITURE" && f.id === id
            ? { ...f, label: name, clearanceBelow: pc! }
            : f,
        ),
      };
      onApply(next);
      setApplied(true);
    } catch (e) {
      setErrors({
        action: e instanceof Error ? e.message : "Emplacement à vérifier.",
      });
    }
  }
  function field(
    key: string,
    title: string,
    value: string,
    change: (value: string) => void,
    numeric = true,
  ) {
    return (
      <View style={{ gap: 6 }}>
        <Text className="text-ink">{title}</Text>
        <TextInput
          accessibilityLabel={`${title} de ${object.label}`}
          value={value}
          onChangeText={change}
          editable={!busy}
          keyboardType={numeric ? "decimal-pad" : "default"}
          placeholder={numeric ? "À préciser" : "Nom de l’élément"}
          style={{
            borderWidth: 1,
            borderColor: errors[key] ? colors.critical : colors.line,
            borderRadius: 12,
            padding: 12,
            fontSize: 16,
            color: colors.ink,
          }}
        />
        {errors[key] ? (
          <Text accessibilityRole="alert" style={{ color: colors.critical }}>
            {errors[key]}
          </Text>
        ) : null}
      </View>
    );
  }
  return (
    <View
      style={{
        gap: 14,
        borderTopWidth: 1,
        borderTopColor: colors.line,
        paddingTop: 16,
      }}
    >
      <Text className="font-semibold text-ink">Identité et emplacement</Text>
      {field("label", "Nom", label, setLabel, false)}
      <Text className="text-sm text-muted">
        Coordonnées du coin supérieur gauche de l’emprise tournée, depuis le
        coin supérieur gauche du rayon. Dimensions et surfaces restent dans leur
        orientation locale. Une case vide reste inconnue.
      </Text>
      {field("x", "Distance depuis la gauche (cm)", x, setX)}
      {field("y", "Distance depuis le haut (cm)", y, setY)}
      <Text className="text-ink">Orientation dans le sens horaire</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {([null, 0, 90, 180, 270] as const).map((value) => (
          <SecondaryButton
            key={String(value)}
            label={value === null ? "À préciser" : `${value}°`}
            disabled={busy || rotation === value}
            onPress={() => setRotation(value)}
          />
        ))}
      </View>
      <Text className="text-sm text-muted">
        Orientation choisie :{" "}
        {rotation === null ? "à préciser" : `${rotation}°`}. A et B conservent
        leur identité.
      </Text>
      {kind === "ASSEMBLY" || furniture?.kind !== "MOBILE" ? (
        <Text className="text-sm text-muted">
          Ce déplacement emporte les positions déjà renseignées des éléments et
          de leurs mobiles associés. Les positions inconnues restent inconnues.
          Les surfaces ne sont pas redimensionnées.
        </Text>
      ) : null}
      {furniture && furniture.kind !== "MOBILE"
        ? field(
            "clearance",
            "Hauteur libre sous le meuble (cm)",
            clearance,
            setClearance,
          )
        : null}
      {furniture?.kind === "MOBILE" ? (
        <>
          <Text className="text-ink">
            Habituellement sous :{" "}
            {content.furniture.find((f) => f.id === hostId)?.label ??
              "Aucun meuble associé"}
          </Text>
          <SecondaryButton
            label={
              showHosts
                ? "Fermer le choix du meuble"
                : "Choisir le meuble associé"
            }
            disabled={busy}
            onPress={() => setShowHosts(!showHosts)}
          />
          {showHosts ? (
            <>
              <SecondaryButton
                label="Aucun meuble associé"
                disabled={busy}
                onPress={() => {
                  setHostId(null);
                  setShowHosts(false);
                }}
              />
              {content.furniture
                .filter((f) => f.kind !== "MOBILE")
                .map((f) => (
                  <SecondaryButton
                    key={f.id}
                    label={`Sous ${f.label}`}
                    disabled={busy}
                    onPress={() => {
                      setHostId(f.id);
                      setShowHosts(false);
                    }}
                  />
                ))}
            </>
          ) : null}
          <Text className="text-sm text-muted">
            L’association décrit l’usage habituel ; elle ne change pas les
            coordonnées et ne prouve pas que le mobile tient sous ce meuble.
          </Text>
        </>
      ) : null}
      {errors.action ? (
        <InlineAlert title="Emplacement non appliqué" message={errors.action} />
      ) : null}
      <PrimaryButton
        label="Appliquer l’emplacement au brouillon"
        disabled={busy}
        onPress={apply}
      />
      {applied ? (
        <InlineAlert
          title="Brouillon modifié"
          message="Fermez la fiche puis enregistrez le brouillon pour conserver ces changements hors connexion."
        />
      ) : null}
    </View>
  );
}
