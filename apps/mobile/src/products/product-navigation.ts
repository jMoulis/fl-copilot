import type { Href } from "expo-router";

type ProductNavigation = Pick<
  typeof import("expo-router").router,
  "dismissTo"
> &
  Partial<Pick<typeof import("expo-router").router, "canGoBack" | "back">>;
export function returnToProducts(navigation: ProductNavigation) {
  if (navigation.canGoBack?.() && navigation.back) navigation.back();
  else navigation.dismissTo("/catalogue");
}
export function returnToProduct(
  navigation: ProductNavigation,
  id: string,
  previousDetail = false,
) {
  if (previousDetail && navigation.canGoBack?.() && navigation.back) {
    navigation.back();
    return;
  }
  navigation.dismissTo(`/product/${id}` as Href);
}
