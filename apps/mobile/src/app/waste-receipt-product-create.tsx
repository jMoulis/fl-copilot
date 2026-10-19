import { useCallback, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { useAuth } from "@/auth/auth-provider";
import {
  AppHeader,
  AppScreen,
  InlineAlert,
  SecondaryButton,
} from "@/components/ui";
import { ProductEditScreen } from "@/products/product-edit-screen";
import { emptyProductDraft } from "@/products/product-editor-service";
import {
  receiptProductOriginSchema,
  type ReceiptProductOrigin,
} from "@/documents/receipt-product-selection";
import { useReceiptProductTarget } from "@/documents/use-receipt-product-target";

export default function ReceiptProductCreateRoute() {
  const params = useLocalSearchParams();
  const origin = receiptProductOriginSchema.safeParse({
    receiptId: params.receiptId,
    lineId: params.lineId,
  });
  const { session } = useAuth(),
    storeId = session?.stores[0]?.storeId;
  return origin.success && storeId && session ? (
    <ReceiptProductCreate
      key={`${storeId}:${session.user.id}:${origin.data.receiptId}:${origin.data.lineId}`}
      storeId={storeId}
      origin={origin.data}
    />
  ) : (
    <AppScreen>
      <AppHeader title="Nouveau produit" />
      <InlineAlert
        title="Ligne indisponible"
        message="Ouvrez la création depuis un ticket du magasin actif."
      />
      <SecondaryButton label="Retour" onPress={() => router.back()} />
    </AppScreen>
  );
}
function ReceiptProductCreate({
  origin,
  storeId,
}: {
  origin: ReceiptProductOrigin;
  storeId: string;
}) {
  const context = useReceiptProductTarget(origin, storeId);
  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: "/waste-receipt-product", params: origin });
  }, [origin]);
  const saved = useCallback(
    (createdProductId: string) => {
      router.dismissTo({
        pathname: "/waste-receipt-product",
        params: { ...origin, createdProductId },
      });
    },
    [origin],
  );
  if (!context.target)
    return (
      <AppScreen>
        <AppHeader
          title="Nouveau produit"
          subtitle={context.loading ? "Lecture de la ligne…" : undefined}
        />
        {context.error ? (
          <>
            <InlineAlert title="Ligne indisponible" message={context.error} />
            <SecondaryButton
              label="Réessayer"
              onPress={() => void context.refresh()}
            />
          </>
        ) : null}
        <SecondaryButton label="Retour au choix du produit" onPress={back} />
      </AppScreen>
    );
  return (
    <ReceiptProductCreateForm
      label={context.target.draft.line.rawLabel}
      onSaved={saved}
      onBack={back}
    />
  );
}
function ReceiptProductCreateForm({
  label,
  onSaved,
  onBack,
}: {
  label: string;
  onSaved(id: string): void;
  onBack(): void;
}) {
  // Freeze only the initial suggestion; later receipt reads must not reset the user's form.
  const [draft] = useState(() => ({
    ...emptyProductDraft,
    label: label.trim().slice(0, 240),
  }));
  return (
    <ProductEditScreen
      id="new"
      newDraft={draft}
      onSaved={onSaved}
      onBack={onBack}
      backLabel="Retour au choix du produit"
    />
  );
}
