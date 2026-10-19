import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Text } from "react-native";
import { router, type Href } from "expo-router";
import { catalogueSnapshotIdentity } from "@fl-copilot/domain";
import {
  AppScreen,
  AppHeader,
  InlineAlert,
  SecondaryButton,
} from "../components/ui";
import { ProductEditorForm } from "./product-editor-form";
import {
  productSnapshotToDraft,
  type ProductEditorSnapshot,
} from "./product-editor-service";
import { useProductEditor } from "./use-product-editor";
import { useUnsavedProduct } from "./use-unsaved-product";
import type { ProductEditorState } from "./product-editor-hooks.types";
export function ProductEditScreen({ id }: { id: string }) {
  const state = useProductEditor(id === "new" ? undefined : id);
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (state.snapshot || (id === "new" && !state.storeMissing))
      setOpened(true);
  }, [state.snapshot, state.storeMissing, id]);
  if (
    state.storeMissing ||
    (!opened &&
      (state.loading || state.missing || (state.error && !state.snapshot)))
  )
    return (
      <AppScreen>
        <AppHeader
          title={id === "new" ? "Nouveau produit" : "Modifier le produit"}
        />
        <SecondaryButton
          label="Retour aux produits"
          onPress={() => router.navigate("/(tabs)/products")}
        />
        {state.loading ? (
          <Text className="text-muted">Chargement de la fiche…</Text>
        ) : (
          <InlineAlert
            title="Fiche indisponible"
            message={
              state.error ??
              "Ce produit n’est pas disponible dans le magasin actif."
            }
          />
        )}
      </AppScreen>
    );
  return <LoadedProductEditor key={id} id={id} state={state} />;
}
function LoadedProductEditor({
  id,
  state,
}: {
  id: string;
  state: ProductEditorState;
}) {
  const [base, setBase] = useState<ProductEditorSnapshot | undefined>(
    () => state.snapshot,
  );
  const [revision, setRevision] = useState(0);
  const [form, setForm] = useState({ dirty: false, saving: false });
  const [savedId, setSavedId] = useState<string>();
  const changed =
    catalogueSnapshotIdentity(base ?? null) !==
    catalogueSnapshotIdentity(state.snapshot ?? null);
  const initial = useMemo(
    () => (base ? productSnapshotToDraft(base) : undefined),
    [base],
  );
  const formState = useCallback(
    (dirty: boolean, saving: boolean) =>
      setForm((old) =>
        old.dirty === dirty && old.saving === saving ? old : { dirty, saving },
      ),
    [],
  );
  useUnsavedProduct(form.dirty, form.saving);
  useEffect(() => {
    if (savedId && !form.dirty && !form.saving)
      router.replace(`/(tabs)/products/${savedId}` as Href);
  }, [savedId, form.dirty, form.saving]);
  function reload() {
    const apply = () => {
      setBase(state.snapshot);
      setRevision((r) => r + 1);
      setForm({ dirty: false, saving: false });
    };
    if (form.dirty)
      Alert.alert(
        "Relire la version actuelle ?",
        "Votre saisie non enregistrée sera remplacée par la fiche actuelle.",
        [
          { text: "Continuer la saisie", style: "cancel" },
          { text: "Relire la fiche", style: "destructive", onPress: apply },
        ],
      );
    else apply();
  }
  return (
    <AppScreen>
      <AppHeader
        title={id === "new" ? "Nouveau produit" : "Modifier le produit"}
        subtitle={
          base?.product.entity.label ??
          "Enregistré sur cet appareil, même hors connexion."
        }
      />
      <SecondaryButton
        label={id === "new" ? "Retour aux produits" : "Retour à la fiche"}
        onPress={() =>
          router.canGoBack()
            ? router.back()
            : router.replace(
                id === "new"
                  ? "/(tabs)/products"
                  : (`/(tabs)/products/${id}` as Href),
              )
        }
      />
      {state.error ? (
        <InlineAlert title="Actualisation interrompue" message={state.error} />
      ) : null}
      {changed ? (
        <>
          <InlineAlert
            title="Une version plus récente existe"
            message="Votre saisie a été conservée. Relisez la fiche actuelle avant d’enregistrer pour préserver les autres modifications."
          />
          <SecondaryButton
            label="Relire la fiche actuelle"
            disabled={form.saving || !state.snapshot}
            onPress={reload}
          />
        </>
      ) : null}
      {state.conflictId ? (
        <>
          <InlineAlert
            title="Conflit de synchronisation"
            message="Votre saisie reste visible. Examinez les deux versions avant tout nouvel enregistrement."
          />
          <SecondaryButton
            label="Examiner le conflit"
            onPress={() =>
              router.push(`/(tabs)/sync-conflict/${state.conflictId}` as Href)
            }
          />
        </>
      ) : null}
      <ProductEditorForm
        key={revision}
        initialValue={initial}
        disabled={changed || Boolean(state.conflictId)}
        onStateChange={formState}
        onSave={async (draft) => {
          const saved = await state.save(draft, base);
          setSavedId(saved);
        }}
      />
    </AppScreen>
  );
}
