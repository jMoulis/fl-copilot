import { useVisualLibrary } from "@/products/use-visual-library";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { router, useFocusEffect, type Href } from "expo-router";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { useProductList } from "@/products/use-product-editor";
import { CatalogueList } from "@/products/catalogue-list";
import {
  CatalogueViewRepository,
  initialCatalogueView,
  type CatalogueView,
} from "@/products/catalogue-view";
import { AppScreen, AppHeader, InlineAlert } from "@/components/ui";

export default function ProductListScreen() {
  const { session } = useAuth();
  const storeId = session?.stores[0]?.storeId,
    ownerId = session?.user.id;
  return storeId && ownerId ? (
    <StoreCatalogue
      key={`${storeId}:${ownerId}`}
      storeId={storeId}
      ownerId={ownerId}
    />
  ) : (
    <AppScreen>
      <AppHeader title="Produits" />
      <InlineAlert
        title="Aucun magasin actif"
        message="Reconnectez-vous pour retrouver votre magasin."
      />
    </AppScreen>
  );
}
function StoreCatalogue({
  storeId,
  ownerId,
}: {
  storeId: string;
  ownerId: string;
}) {
  const state = useProductList();
  const gallery = useVisualLibrary();
  const visuals = useMemo(
    () => ({ state: gallery.state, readUri: gallery.readUri }),
    [gallery.state, gallery.readUri],
  );
  const { sqlite } = useLocalDatabase();
  const cache = useMemo(
    () => new CatalogueViewRepository(sqlite, { storeId, ownerId }),
    [sqlite, storeId, ownerId],
  );
  const [view, setView] = useState<CatalogueView>();
  const [notice, setNotice] = useState<string>();
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    let active = true;
    void cache
      .read()
      .then((saved) => {
        if (active) setView(saved ?? initialCatalogueView);
      })
      .catch(() => {
        if (active) {
          setView(initialCatalogueView);
          setNotice(
            "La recherche précédente n’a pas pu être restaurée. Les produits sont conservés.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [cache]);
  const latest = useRef<CatalogueView | undefined>(undefined);
  const persist = useCallback(
    (value: CatalogueView) => {
      writes.current = writes.current
        .catch(() => {})
        .then(() => cache.save(value))
        .catch(() =>
          setNotice(
            "La position reste conservée durant cette visite, mais n’a pas pu être mémorisée pour le prochain démarrage.",
          ),
        );
    },
    [cache],
  );
  useEffect(() => {
    if (!view) return;
    const timer = setTimeout(() => persist(view), 300);
    return () => clearTimeout(timer);
  }, [view, persist]);
  useEffect(
    () => () => {
      if (latest.current) persist(latest.current);
    },
    [persist],
  );
  useFocusEffect(
    useCallback(
      () => () => {
        if (latest.current) persist(latest.current);
      },
      [persist],
    ),
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" && latest.current) persist(latest.current);
    });
    return () => subscription.remove();
  }, [persist]);
  const update = useCallback((next: CatalogueView) => {
    latest.current = next;
    setView(next);
  }, []);
  const open = useCallback(
    (id: string) => router.push(`/(tabs)/products/${id}` as Href),
    [],
  );
  if (!view)
    return (
      <AppScreen>
        <AppHeader title="Produits" />
      </AppScreen>
    );
  return (
    <CatalogueList
      visuals={visuals}
      items={state.products}
      view={view}
      onChange={update}
      onOpen={open}
      onAdd={() => router.push("/(tabs)/products/new" as Href)}
      loading={state.loading}
      error={state.error}
      notice={notice}
      storeMissing={state.storeMissing}
      onRefresh={() => void state.refresh()}
    />
  );
}
