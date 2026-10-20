import { useState } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import { randomUUID } from "expo-crypto";
import type { StoreLayoutContent } from "@fl-copilot/domain";
import {
  addStoreLayoutInventory,
  addStoreLayoutTgSurface,
  duplicateStoreLayoutInventory,
  removeStoreLayoutInventory,
  renameStoreLayoutInventory,
  type LayoutInventoryTarget,
  type LayoutFixedSlot,
} from "@fl-copilot/commercial-core";
import { InlineAlert, PrimaryButton, SecondaryButton } from "../components/ui";
import { colors } from "../design/tokens";
const kinds = [
  { value: "ASSEMBLY", label: "Îlot" },
  { value: "FIXED", label: "Élément fixe" },
  { value: "TG", label: "TG" },
  { value: "MOBILE", label: "Mobile de vente" },
] as const;
type Kind = (typeof kinds)[number]["value"];
function errorText(e: unknown) {
  return e instanceof Error && !("issues" in e)
    ? e.message
    : "Vérifiez les champs et la capacité du plan. Aucune modification n’a été appliquée.";
}
function nameError(s: string) {
  return !s.trim() || s.trim().length > 120
    ? "Indiquez un nom de 1 à 120 caractères."
    : null;
}
function TargetChoice({
  label,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      aria-checked={selected}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-12 justify-center rounded-xl border px-3 py-3 ${selected ? "border-forest bg-forest-soft" : "border-line bg-surface"}`}
    >
      <Text className={selected ? "font-semibold text-forest" : "text-ink"}>
        {selected ? "✓ " : ""}
        {label}
      </Text>
    </Pressable>
  );
}
function NameField({
  label,
  value,
  onChange,
  busy,
}: {
  label: string;
  value: string;
  onChange(v: string): void;
  busy: boolean;
}) {
  return (
    <View className="gap-2">
      <Text className="text-ink">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        maxLength={120}
        editable={!busy}
        onChangeText={onChange}
        placeholderTextColor={colors.muted}
        placeholder="Nom dans votre magasin"
        className="min-h-12 rounded-xl border border-line p-3 text-ink"
      />
    </View>
  );
}
/** Applies only to the current in-memory draft. Saving/adopting remains the parent's reviewed action. */
export function LayoutInventoryForm({
  content,
  source,
  busy,
  onApply,
  onCancel,
  onDirty,
}: {
  content: StoreLayoutContent;
  source?: LayoutInventoryTarget;
  busy: boolean;
  onApply(content: StoreLayoutContent, id: string): boolean;
  onCancel(): void;
  onDirty?(): void;
}) {
  const original =
    source?.kind === "ASSEMBLY"
      ? content.assemblies.find((a) => a.id === source.id)
      : source?.kind === "FURNITURE"
        ? content.furniture.find((f) => f.id === source.id)
        : undefined;
  const sourceFurniture =
    source?.kind === "FURNITURE"
      ? content.furniture.find((f) => f.id === source.id)
      : undefined;
  const [kind, setKind] = useState<Kind | null>(
      source?.kind === "ASSEMBLY"
        ? "ASSEMBLY"
        : (sourceFurniture?.kind ?? null),
    ),
    [name, setName] = useState(
      original ? `${original.label.slice(0, 110)} — copie` : "",
    ),
    [assemblyId, setAssemblyId] = useState<string | null>(
      sourceFurniture?.assemblyId ?? null,
    ),
    [face, setFace] = useState<"A" | "B" | null>(sourceFurniture?.face ?? null),
    [order, setOrder] = useState(""),
    [copyDimensions, setCopyDimensions] = useState(false),
    [error, setError] = useState<string>();
  const dirty = () => {
    onDirty?.();
    setError(undefined);
  };
  function apply() {
    if (busy) return;
    setError(undefined);
    try {
      const invalid = nameError(name);
      if (invalid) throw Error(invalid);
      if (!kind) throw Error("Choisissez ce que vous souhaitez ajouter.");
      let slot: LayoutFixedSlot | undefined;
      if (kind === "FIXED") {
        if (
          !assemblyId ||
          !face ||
          !/^(?:[1-9]|[1-5][0-9]|6[0-4])$/.test(order.trim())
        )
          throw Error("Choisissez un îlot, une face et un rang de 1 à 64.");
        slot = { assemblyId, face, order: Number(order) };
      }
      const result = source
        ? duplicateStoreLayoutInventory(
            content,
            source,
            { label: name, copyDimensions, slot },
            randomUUID,
          )
        : kind === "FIXED"
          ? addStoreLayoutInventory(
              content,
              { kind, label: name, ...slot! },
              randomUUID,
            )
          : addStoreLayoutInventory(content, { kind, label: name }, randomUUID);
      if (!onApply(result.content, result.id))
        setError(
          "La modification est en pause. Votre saisie reste conservée ; vérifiez l’état du plan.",
        );
    } catch (e) {
      setError(errorText(e));
    }
  }
  if (source && !original)
    return (
      <InlineAlert
        title="Élément à retrouver"
        message="L’élément choisi n’est plus dans ce brouillon. Fermez cette fiche et relisez le plan."
      />
    );
  return (
    <View className="gap-4">
      {!source ? (
        <View className="gap-2">
          <Text className="font-semibold text-ink">Ajouter au plan</Text>
          <View
            className="flex-row flex-wrap gap-2"
            accessibilityRole="radiogroup"
            accessibilityLabel="Type de mobilier"
          >
            {kinds.map((k) => (
              <TargetChoice
                key={k.value}
                label={k.label}
                selected={kind === k.value}
                disabled={busy}
                onPress={() => {
                  setKind(k.value);
                  dirty();
                }}
              />
            ))}
          </View>
        </View>
      ) : (
        <Text className="font-semibold text-ink">Copier {original!.label}</Text>
      )}
      <NameField
        label={source ? "Nom de la copie" : "Nom du nouvel élément"}
        value={name}
        busy={busy}
        onChange={(v) => {
          setName(v);
          dirty();
        }}
      />
      {kind === "FIXED" ? (
        <View className="gap-3">
          <Text className="font-semibold text-ink">
            Emplacement dans l’inventaire
          </Text>
          <Text className="text-sm text-muted">
            La face et le rang identifient l’élément ; ils ne constituent pas
            une position mesurée sur le plan.
          </Text>
          {content.assemblies.length ? (
            <View
              className="gap-2"
              accessibilityRole="radiogroup"
              accessibilityLabel="Îlot de destination"
            >
              {content.assemblies.map((a) => (
                <TargetChoice
                  key={a.id}
                  label={a.label}
                  selected={assemblyId === a.id}
                  disabled={busy}
                  onPress={() => {
                    setAssemblyId(a.id);
                    dirty();
                  }}
                />
              ))}
            </View>
          ) : (
            <InlineAlert
              title="Îlot nécessaire"
              message="Ajoutez d’abord un îlot au brouillon pour y placer un élément fixe."
            />
          )}
          <View
            className="flex-row flex-wrap gap-2"
            accessibilityRole="radiogroup"
            accessibilityLabel="Face de destination"
          >
            {(["A", "B"] as const).map((f) => (
              <TargetChoice
                key={f}
                label={`Face ${f}`}
                selected={face === f}
                disabled={busy}
                onPress={() => {
                  setFace(f);
                  dirty();
                }}
              />
            ))}
          </View>
          <TextInput
            accessibilityLabel="Rang sur la face, de 1 à 64"
            keyboardType="number-pad"
            placeholder="Rang de 1 à 64"
            placeholderTextColor={colors.muted}
            value={order}
            maxLength={2}
            editable={!busy}
            onChangeText={(v) => {
              setOrder(v);
              dirty();
            }}
            className="min-h-12 rounded-xl border border-line p-3 text-ink"
          />
        </View>
      ) : null}
      {kind === "TG" ? (
        <Text className="text-warning">
          TG physiques :{" "}
          {content.furniture.filter((f) => f.kind === "TG").length} →{" "}
          {content.furniture.filter((f) => f.kind === "TG").length + 1}. Cet
          ajout change le mobilier du rayon, pas le nombre d’idées commerciales.
        </Text>
      ) : null}
      {source?.kind === "ASSEMBLY" ? (
        <Text className="text-muted">
          La copie reprend les{" "}
          {content.furniture.filter((f) => f.assemblyId === source.id).length}{" "}
          éléments de ses faces, chacun avec ses propres surfaces. Aucun mobile
          n’est ajouté.
        </Text>
      ) : null}
      {source ? (
        <>
          <View className="flex-row items-center gap-3">
            <Switch
              accessibilityLabel="Reprendre les dimensions comme déclarées"
              value={copyDimensions}
              disabled={busy}
              onValueChange={(v) => {
                setCopyDimensions(v);
                dirty();
              }}
            />
            <Text className="flex-1 text-ink">
              Reprendre les dimensions comme déclarées, à confirmer
            </Text>
          </View>
          <Text className="text-sm leading-5 text-muted">
            La copie a ses propres identités. Positions, orientation et charges
            restent inconnues. Aucun mobile associé n’est dupliqué. Les
            anciennes mesures relevées ne deviennent pas des mesures de la
            copie.
          </Text>
        </>
      ) : (
        <Text className="text-sm leading-5 text-muted">
          Dimensions, position, orientation et charges restent à préciser. Un
          élément fixe crée son bac et sa propre étagère. Un îlot commence vide
          ; les mobiles et la composition des TG sont ajoutés explicitement.
        </Text>
      )}
      {error ? <InlineAlert title="Ajout à vérifier" message={error} /> : null}
      <PrimaryButton
        label={
          source ? "Appliquer la copie au brouillon" : "Ajouter au brouillon"
        }
        onPress={apply}
        disabled={busy}
      />
      <SecondaryButton
        label={source ? "Annuler la copie" : "Annuler l’ajout"}
        disabled={busy}
        onPress={onCancel}
      />
    </View>
  );
}

/** Explicit controls inside the existing element sheet, so no nested native modal is presented. */
export function LayoutInventoryControls({
  content,
  target,
  busy,
  onApply,
  onSelect,
  onRemoved,
  onDirty,
  onApplied,
}: {
  content: StoreLayoutContent;
  target: LayoutInventoryTarget;
  busy: boolean;
  onApply(content: StoreLayoutContent): boolean;
  onSelect(id: string): void;
  onRemoved(): void;
  onDirty?(): void;
  onApplied?(): void;
}) {
  const object =
    target.kind === "ASSEMBLY"
      ? content.assemblies.find((a) => a.id === target.id)
      : target.kind === "FURNITURE"
        ? content.furniture.find((f) => f.id === target.id)
        : content.surfaces.find((s) => s.id === target.id);
  const [mode, setMode] = useState<"COPY" | "REMOVE" | "SURFACE" | null>(null),
    [name, setName] = useState(object?.label ?? ""),
    [surfaceKind, setSurfaceKind] = useState<
      "BAC" | "UPPER_SHELF" | "OTHER" | null
    >(null),
    [error, setError] = useState<string>(),
    [notice, setNotice] = useState<string>();
  if (!object) return null;
  const furniture =
    target.kind === "FURNITURE"
      ? content.furniture.find((f) => f.id === target.id)
      : null;
  const tgSurface =
    target.kind === "SURFACE" &&
    content.surfaces.some(
      (s) =>
        s.id === target.id &&
        content.furniture.some(
          (f) => f.id === s.furnitureId && f.kind === "TG",
        ),
    );
  function apply(task: () => StoreLayoutContent) {
    if (busy) return false;
    setError(undefined);
    try {
      if (!onApply(task()))
        throw Error("La modification est en pause. Relisez l’état du plan.");
      onApplied?.();
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  }
  return (
    <View className="gap-3">
      <Text className="font-semibold text-ink">Inventaire du brouillon</Text>
      {notice ? (
        <InlineAlert title="Brouillon modifié" message={notice} />
      ) : null}
      {error ? (
        <InlineAlert title="Modification à vérifier" message={error} />
      ) : null}
      {target.kind === "SURFACE" ? (
        <>
          <NameField
            label="Nom de la surface"
            value={name}
            onChange={(v) => {
              setName(v);
              onDirty?.();
            }}
            busy={busy}
          />
          <SecondaryButton
            label="Appliquer le nom de la surface"
            disabled={busy}
            onPress={() => {
              const invalid = nameError(name);
              if (invalid) {
                setError(invalid);
                return;
              }
              if (
                apply(() => renameStoreLayoutInventory(content, target, name))
              )
                setNotice(
                  "Nom appliqué au brouillon ; enregistrez le plan pour le conserver.",
                );
            }}
          />
        </>
      ) : null}
      {mode === "COPY" ? (
        <LayoutInventoryForm
          key={`copy:${target.id}`}
          content={content}
          source={target}
          busy={busy}
          onApply={(next, id) => {
            if (!onApply(next)) return false;
            onApplied?.();
            onSelect(id);
            setMode(null);
            return true;
          }}
          onDirty={onDirty}
          onCancel={() => {
            setMode(null);
            onApplied?.();
          }}
        />
      ) : target.kind !== "SURFACE" && mode === null ? (
        <SecondaryButton
          label={
            target.kind === "ASSEMBLY"
              ? "Dupliquer cet îlot"
              : "Dupliquer cet élément"
          }
          disabled={busy}
          onPress={() => {
            setMode("COPY");
            setError(undefined);
          }}
        />
      ) : null}
      {furniture?.kind === "TG" ? (
        <>
          {mode === null ? (
            <SecondaryButton
              label="Ajouter une surface de vente à cette TG"
              disabled={busy}
              onPress={() => {
                setMode("SURFACE");
                setName("");
                setSurfaceKind(null);
                setError(undefined);
              }}
            />
          ) : null}
          {mode === "SURFACE" ? (
            <View className="gap-3">
              <NameField
                label="Nom de la nouvelle surface"
                value={name}
                onChange={(v) => {
                  setName(v);
                  onDirty?.();
                }}
                busy={busy}
              />
              <View
                className="gap-2"
                accessibilityRole="radiogroup"
                accessibilityLabel="Composition déclarée de la TG"
              >
                {(
                  [
                    { kind: "BAC", label: "Bac" },
                    { kind: "UPPER_SHELF", label: "Étagère supérieure" },
                    { kind: "OTHER", label: "Autre surface de vente" },
                  ] as const
                ).map((s) => (
                  <TargetChoice
                    key={s.kind}
                    label={s.label}
                    selected={surfaceKind === s.kind}
                    disabled={busy}
                    onPress={() => {
                      setSurfaceKind(s.kind);
                      onDirty?.();
                    }}
                  />
                ))}
              </View>
              <Text className="text-sm text-muted">
                La surface a une identité propre. Dimensions utiles et charge
                admissible restent inconnues ; elles ne sont pas déduites de
                l’emprise de la TG.
              </Text>
              <PrimaryButton
                label="Ajouter cette surface au brouillon"
                disabled={busy}
                onPress={() => {
                  const invalid = nameError(name);
                  if (invalid) {
                    setError(invalid);
                    return;
                  }
                  if (!surfaceKind) {
                    setError(
                      "Choisissez la composition de cette surface de TG.",
                    );
                    return;
                  }
                  if (
                    apply(
                      () =>
                        addStoreLayoutTgSurface(
                          content,
                          target.id,
                          name,
                          surfaceKind,
                          randomUUID,
                        ).content,
                    )
                  ) {
                    setMode(null);
                    setNotice(
                      "Surface ajoutée au brouillon. Retrouvez-la dans la fiche de la TG puis enregistrez le plan.",
                    );
                  }
                }}
              />
              <SecondaryButton
                label="Annuler la surface"
                disabled={busy}
                onPress={() => {
                  setMode(null);
                  onApplied?.();
                }}
              />
            </View>
          ) : null}
        </>
      ) : null}
      {target.kind !== "SURFACE" || tgSurface ? (
        <>
          {mode === null ? (
            <SecondaryButton
              label={
                target.kind === "SURFACE"
                  ? "Retirer cette surface du brouillon"
                  : target.kind === "ASSEMBLY"
                    ? "Retirer cet îlot du brouillon"
                    : "Retirer cet élément du brouillon"
              }
              disabled={busy}
              onPress={() => {
                setMode("REMOVE");
                setError(undefined);
              }}
            />
          ) : null}
          {mode === "REMOVE" ? (
            <View className="gap-3">
              <Text className="text-warning">
                Retirer « {object.label} »
                {target.kind === "SURFACE"
                  ? " de cette version ? "
                  : " et ses surfaces de cette version ? "}
                {target.kind === "ASSEMBLY"
                  ? "Les éléments de ses deux faces seront retirés. "
                  : ""}
                {target.kind === "SURFACE"
                  ? "Le meuble et ses mobiles restent inchangés. "
                  : furniture?.kind === "MOBILE"
                    ? "Seul ce mobile et sa surface sont retirés. "
                    : "Les mobiles sous les meubles retirés restent dans le plan, sans association à ces meubles. "}
                Les versions historiques sont conservées et le retrait peut être
                annulé dans le brouillon.
              </Text>
              <PrimaryButton
                label="Confirmer le retrait du brouillon"
                disabled={busy}
                onPress={() => {
                  if (
                    apply(() => removeStoreLayoutInventory(content, target))
                  ) {
                    setMode(null);
                    onRemoved();
                  }
                }}
              />
              <SecondaryButton
                label="Conserver cet élément"
                disabled={busy}
                onPress={() => setMode(null)}
              />
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
