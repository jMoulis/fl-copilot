import { useState } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import type { StoreLayoutContent } from "@fl-copilot/domain";
import {
  BottomSheet,
  PrimaryButton,
  SecondaryButton,
  InlineAlert,
} from "../components/ui";
import { colors } from "../design/tokens";
import {
  layoutMeasurementLabel,
  layoutNumber,
  parseLayoutMeasure,
} from "./layout-view-model";
type Dimensions = StoreLayoutContent["furniture"][number]["dimensions"];
export function LayoutMeasurements({
  label,
  dimensions,
  onApply,
  busy,
}: {
  label: string;
  dimensions: Dimensions;
  onApply: (v: Dimensions) => void;
  busy: boolean;
}) {
  const [values, setValues] = useState({
      width: layoutNumber(dimensions.width),
      depth: layoutNumber(dimensions.depth),
      height: layoutNumber(dimensions.height),
    }),
    [measured, setMeasured] = useState(false),
    [errors, setErrors] = useState<Record<string, string>>({});
  function apply() {
    const next = { ...dimensions },
      issues: Record<string, string> = {};
    for (const key of ["width", "depth", "height"] as const)
      try {
        next[key] = parseLayoutMeasure(values[key], dimensions[key], measured);
      } catch (e) {
        issues[key] = e instanceof Error ? e.message : "Mesure à vérifier";
      }
    setErrors(issues);
    if (!Object.keys(issues).length) onApply(next);
  }
  return (
    <View style={{ gap: 14 }}>
      <Text className="font-semibold text-ink">Mesures de {label}</Text>
      {(["width", "depth", "height"] as const).map((key) => (
        <View key={key} style={{ gap: 6 }}>
          <Text className="text-ink">
            {{ width: "Largeur", depth: "Profondeur", height: "Hauteur" }[key]}{" "}
            (cm)
          </Text>
          <TextInput
            accessibilityLabel={`${{ width: "Largeur", depth: "Profondeur", height: "Hauteur" }[key]} de ${label} en centimètres`}
            keyboardType="decimal-pad"
            editable={!busy}
            value={values[key]}
            onChangeText={(v) => setValues((old) => ({ ...old, [key]: v }))}
            placeholder="À préciser"
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
      ))}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Switch
          accessibilityLabel="Ces mesures ont été relevées sur place"
          value={measured}
          onValueChange={setMeasured}
          disabled={busy}
        />
        <Text style={{ flex: 1, color: colors.ink }}>
          Mesures relevées sur place
        </Text>
      </View>
      <Text className="text-sm text-muted">
        Laissez vide ce qui reste inconnu. Sans relevé sur place, une nouvelle
        valeur est enregistrée comme déclarée. Les mesures de référence
        inchangées restent à confirmer.
      </Text>
      <PrimaryButton
        label="Appliquer au brouillon"
        onPress={apply}
        disabled={busy}
      />
    </View>
  );
}
export function StoreLayoutElementSheet({
  content,
  id,
  editing,
  busy,
  onClose,
  onSelect,
  onApply,
  blockedReason,
}: {
  content: StoreLayoutContent;
  id: string | null;
  editing: boolean;
  busy: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onApply: (content: StoreLayoutContent) => void;
  blockedReason?: string;
}) {
  const [surfaceId, setSurfaceId] = useState<string | null>(null),
    [applied, setApplied] = useState(false);
  const f = content.furniture.find((x) => x.id === id),
    surface = content.surfaces.find(
      (s) => s.id === surfaceId && s.furnitureId === id,
    );
  if (!f) return null;
  const surfaces = content.surfaces.filter((s) => s.furnitureId === f.id),
    mobiles = content.furniture.filter((m) => m.hostId === f.id);
  const target = surface ?? f;
  const row = (s: (typeof surfaces)[number]) => (
    <Pressable
      key={s.id}
      accessibilityRole="button"
      accessibilityLabel={`Consulter ${s.label} de ${f.label}`}
      accessibilityState={{ selected: surfaceId === s.id }}
      onPress={() => {
        setSurfaceId(s.id);
        setApplied(false);
      }}
      style={{
        minHeight: 64,
        padding: 14,
        borderRadius: s.kind === "BAC" ? 8 : 4,
        borderWidth: surfaceId === s.id ? 2 : 1,
        borderColor: surfaceId === s.id ? colors.forest : colors.muted,
        backgroundColor:
          s.kind === "BAC" ? colors.forestSoft : colors.surfaceMuted,
        justifyContent: "center",
      }}
    >
      <Text style={{ color: colors.ink, fontWeight: "600" }}>{s.label}</Text>
      <Text style={{ color: colors.muted, fontSize: 12 }}>
        Surface de vente
      </Text>
    </Pressable>
  );
  return (
    <BottomSheet visible title={f.label} onClose={onClose} swipeToClose>
      <Text className="text-sm text-muted">
        Vue de face schématique · les proportions ne sont pas des mesures.
      </Text>
      <View
        style={{
          gap: 18,
          padding: 16,
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: 16,
          backgroundColor: colors.canvas,
        }}
      >
        {surfaces.filter((s) => s.kind === "UPPER_SHELF").map(row)}
        {surfaces.filter((s) => s.kind !== "UPPER_SHELF").map(row)}
        {mobiles.length ? (
          <View
            style={{
              gap: 8,
              borderTopWidth: 1,
              borderTopColor: colors.line,
              paddingTop: 12,
            }}
          >
            {mobiles.map((m) => (
              <Pressable
                key={m.id}
                accessibilityRole="button"
                accessibilityLabel={`Ouvrir ${m.label}`}
                onPress={() => {
                  setSurfaceId(null);
                  setApplied(false);
                  onSelect(m.id);
                }}
                style={{
                  minHeight: 56,
                  padding: 12,
                  borderWidth: 1,
                  borderStyle: "dashed",
                  borderColor: colors.forest,
                  borderRadius: 12,
                }}
              >
                <Text style={{ color: colors.forest, fontWeight: "600" }}>
                  {m.label}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  Mobile de vente · compatibilité sous le meuble à vérifier
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {!surfaces.length ? (
          <Text className="text-muted">
            Composition des surfaces à préciser.
          </Text>
        ) : null}
      </View>
      {surface ? (
        <SecondaryButton
          label="Revenir aux mesures du meuble"
          onPress={() => {
            setSurfaceId(null);
            setApplied(false);
          }}
        />
      ) : null}
      <View style={{ gap: 8 }}>
        <Text className="font-semibold text-ink">{target.label}</Text>
        {(["width", "depth", "height"] as const).map((k) => (
          <Text key={k} className="text-muted">
            {{ width: "Largeur", depth: "Profondeur", height: "Hauteur" }[k]} :{" "}
            {layoutMeasurementLabel(target.dimensions[k])}
          </Text>
        ))}
      </View>
      {f.kind === "MOBILE" && f.hostId ? (
        <Text className="text-muted">
          Habituellement sous :{" "}
          {content.furniture.find((h) => h.id === f.hostId)?.label ??
            "Élément à retrouver"}
          . L’association ne confirme pas la hauteur libre.
        </Text>
      ) : null}
      {blockedReason ? (
        <InlineAlert title="Modification en pause" message={blockedReason} />
      ) : null}
      {editing ? (
        <LayoutMeasurements
          key={target.id}
          label={target.label}
          dimensions={target.dimensions}
          busy={busy}
          onApply={(dimensions) => {
            onApply(
              surface
                ? {
                    ...content,
                    surfaces: content.surfaces.map((s) =>
                      s.id === surface.id ? { ...s, dimensions } : s,
                    ),
                  }
                : {
                    ...content,
                    furniture: content.furniture.map((m) =>
                      m.id === f.id ? { ...m, dimensions } : m,
                    ),
                  },
            );
            setApplied(true);
          }}
        />
      ) : (
        <Text className="text-sm text-muted">
          Pour compléter une mesure, fermez cette fiche et choisissez « Modifier
          les mesures ».
        </Text>
      )}
      {applied ? (
        <InlineAlert
          title="Brouillon modifié"
          message="La mesure est appliquée au brouillon. Enregistrez-le depuis le plan pour le conserver hors connexion."
        />
      ) : null}
    </BottomSheet>
  );
}
