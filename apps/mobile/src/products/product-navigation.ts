import type { Href } from "expo-router";

type ProductNavigation = Pick<typeof import("expo-router").router, "dismissTo">;
export function returnToProducts(navigation: ProductNavigation) {
  navigation.dismissTo("/(tabs)/products");
}
export function returnToProduct(navigation: ProductNavigation, id: string) {
  navigation.dismissTo(`/(tabs)/products/${id}` as Href);
}
