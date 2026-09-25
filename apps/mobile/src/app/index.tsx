import { Redirect, type Href } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "@/auth/auth-provider";

export default function IndexScreen() {
  const { status } = useAuth();
  if (status === "loading") {
    return (
      <View className="flex-1 items-center justify-center bg-canvas">
        <ActivityIndicator size="large" color="#235C3D" />
      </View>
    );
  }
  const destination = status === "authenticated" ? "/(tabs)" : "/login";
  return <Redirect href={destination as Href} />;
}
