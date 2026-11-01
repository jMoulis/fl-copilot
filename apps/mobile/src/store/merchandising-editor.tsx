import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { randomUUID } from "expo-crypto";
import {
  merchandisingHeatLabels,
  type StoreMerchandisingZone,
} from "@fl-copilot/domain";
import { SectionCard, SecondaryButton } from "../components/ui";
import { SegmentedControl } from "../components/dashboard";
import {
  emptyMerchandisingDraft,
  type MerchandisingDraft,
} from "./merchandising-draft";
export function MerchandisingEditor({
  value,
  disabled,
  issue,
  onChange,
}: {
  value: MerchandisingDraft | undefined;
  disabled: boolean;
  issue?: string;
  onChange(value: MerchandisingDraft): void;
}) {
  const [open, setOpen] = useState(false);
  const [selectedZone, setSelectedZone] = useState<string>();
  const draft = value ?? emptyMerchandisingDraft();
  const update = (patch: Partial<MerchandisingDraft>) => {
    if (!disabled) onChange({ ...draft, ...patch });
  };
  const zone = (id: string, patch: Partial<StoreMerchandisingZone>) =>
    update({
      zones: draft.zones.map((z) => (z.id === id ? { ...z, ...patch } : z)),
    });
  const inputClass = "rounded-xl border border-line p-3 text-base text-ink";
  return (
    <SectionCard
      title="Mon rayon · merchandising"
      description="Des repères réutilisés par le copilote, sans avoir à dessiner un plan."
    >
      <Text className="text-muted">TG actives pour les fruits et légumes</Text>
      <TextInput
        accessibilityLabel="Nombre de TG actives F&L"
        value={draft.activeTgCount}
        onChangeText={(activeTgCount) => update({ activeTgCount })}
        editable={!disabled}
        keyboardType="number-pad"
        maxLength={3}
        placeholder="Non renseigné"
        className={inputClass}
      />
      <Text className="text-muted">Implantation et familles de produits</Text>
      <TextInput
        accessibilityLabel="Repères d’implantation du rayon"
        value={draft.implantation}
        onChangeText={(implantation) => update({ implantation })}
        editable={!disabled}
        multiline
        maxLength={1200}
        placeholder="Îlots, familles et repères utiles…"
        className={inputClass}
      />
      <Text className="text-muted">Parcours principal des clients</Text>
      <TextInput
        accessibilityLabel="Circulation principale déclarée"
        value={draft.circulation}
        onChangeText={(circulation) => update({ circulation })}
        editable={!disabled}
        multiline
        maxLength={1200}
        placeholder="Entrée, allée principale, premier emplacement rencontré…"
        className={inputClass}
      />
      <SecondaryButton
        label={
          open
            ? "Masquer les emplacements"
            : `Emplacements et zones (${draft.zones.length})`
        }
        expanded={open}
        onPress={() => setOpen((v) => !v)}
      />
      {open ? (
        <>
          <Text className="text-sm text-muted">
            Chaud, intermédiaire ou froid : ton observation du passage et de la
            visibilité, pas un classement calculé à partir des ventes. Tu peux
            laisser un emplacement non qualifié.
          </Text>
          {draft.zones.map((z) => (
            <View
              key={z.id}
              className="gap-3 rounded-xl border border-line p-3"
            >
              <SecondaryButton
                label={`${z.label || "Nouvel emplacement"} · zone ${merchandisingHeatLabels[z.heat]}`}
                expanded={selectedZone === z.id}
                onPress={() =>
                  setSelectedZone((current) =>
                    current === z.id ? undefined : z.id,
                  )
                }
              />
              {selectedZone === z.id ? (
                <>
                  <TextInput
                    accessibilityLabel="Nom de l’emplacement"
                    value={z.label}
                    onChangeText={(label) => zone(z.id, { label })}
                    editable={!disabled}
                    maxLength={80}
                    placeholder="TG1, face d’îlot, fond de rayon…"
                    className={inputClass}
                  />
                  <SegmentedControl
                    disabled={disabled}
                    label={`Type de ${z.label || "l’emplacement"}`}
                    value={z.kind}
                    options={[
                      { value: "TG", label: "TG" },
                      { value: "ISLAND_FACE", label: "Face d’îlot" },
                      { value: "AREA", label: "Autre zone" },
                    ]}
                    onChange={(kind) =>
                      zone(z.id, {
                        kind,
                        active: kind === "TG" ? z.active : null,
                      })
                    }
                  />
                  {z.kind === "TG" ? (
                    <SegmentedControl
                      disabled={disabled}
                      label={`Activité F&L de ${z.label || "la TG"}`}
                      value={
                        z.active === null
                          ? "UNKNOWN"
                          : z.active
                            ? "ACTIVE"
                            : "INACTIVE"
                      }
                      options={[
                        { value: "UNKNOWN", label: "À préciser" },
                        { value: "ACTIVE", label: "Active" },
                        { value: "INACTIVE", label: "Inactive" },
                      ]}
                      onChange={(v) =>
                        zone(z.id, {
                          active: v === "UNKNOWN" ? null : v === "ACTIVE",
                        })
                      }
                    />
                  ) : null}
                  <TextInput
                    accessibilityLabel={`Position de ${z.label || "l’emplacement"}`}
                    value={z.position ?? ""}
                    onChangeText={(v) =>
                      zone(z.id, { position: v.trim() ? v : null })
                    }
                    editable={!disabled}
                    multiline
                    maxLength={300}
                    placeholder="Où se trouve cet emplacement ?"
                    className={inputClass}
                  />
                  <SegmentedControl
                    disabled={disabled}
                    label={`Zone de ${z.label || "l’emplacement"}`}
                    value={z.heat}
                    options={[
                      { value: "UNKNOWN", label: "Non définie" },
                      { value: "HOT", label: "Chaude" },
                      { value: "INTERMEDIATE", label: "Intermédiaire" },
                      { value: "COLD", label: "Froide" },
                    ]}
                    onChange={(heat) => zone(z.id, { heat })}
                  />
                  <TextInput
                    accessibilityLabel={`Observation sur ${z.label || "l’emplacement"}`}
                    value={z.note ?? ""}
                    onChangeText={(v) =>
                      zone(z.id, { note: v.trim() ? v : null })
                    }
                    editable={!disabled}
                    multiline
                    maxLength={300}
                    placeholder="Pourquoi ? (facultatif)"
                    className={inputClass}
                  />
                  <SecondaryButton
                    label="Retirer cet emplacement des repères"
                    disabled={disabled}
                    onPress={() =>
                      update({
                        zones: draft.zones.filter((other) => other.id !== z.id),
                      })
                    }
                  />
                </>
              ) : null}
            </View>
          ))}
          <SecondaryButton
            label="Ajouter un emplacement"
            disabled={disabled || draft.zones.length >= 32}
            onPress={() => {
              const id = randomUUID();
              update({
                zones: [
                  ...draft.zones,
                  {
                    id,
                    label: "",
                    kind: "AREA",
                    active: null,
                    position: null,
                    heat: "UNKNOWN",
                    note: null,
                  },
                ],
              });
              setSelectedZone(id);
            }}
          />
        </>
      ) : null}
      {issue ? (
        <Text accessibilityRole="alert" className="text-danger">
          {issue}
        </Text>
      ) : null}
      <Text className="text-sm text-muted">
        Ces repères ne modifient ni le mobilier physique ni une préparation de
        semaine. Enregistre les réglages pour les conserver.
      </Text>
    </SectionCard>
  );
}
