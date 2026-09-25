import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Redirect, useRouter, type Href } from "expo-router";
import { Text, TextInput, View } from "react-native";
import { z } from "zod";
import { ApiClientError } from "@fl-copilot/api-client";
import { useAuth } from "@/auth/auth-provider";
import {
  AppHeader,
  AppScreen,
  InlineAlert,
  PrimaryButton,
} from "@/components/ui";

const formSchema = z.object({
  email: z.string().trim().email("Saisissez une adresse e-mail valide."),
});
type FormValues = z.infer<typeof formSchema>;

export default function LoginScreen() {
  const router = useRouter();
  const { status, requestCode } = useAuth();
  const [error, setError] = useState<string>();
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "" },
  });

  if (status === "authenticated") return <Redirect href="/(tabs)" />;

  const submit = handleSubmit(async ({ email }) => {
    setError(undefined);
    try {
      await requestCode(email);
      router.push("/verify" as Href);
    } catch (reason) {
      setError(
        reason instanceof ApiClientError
          ? reason.response.messageFr
          : "Le code n’a pas pu être envoyé.",
      );
    }
  });

  return (
    <AppScreen>
      <AppHeader
        title="Connexion"
        subtitle="Un code de connexion vous sera envoyé par e-mail."
      />
      {error ? (
        <InlineAlert title="Connexion impossible" message={error} />
      ) : null}
      <View className="gap-2">
        <Text className="text-base font-semibold text-ink">Adresse e-mail</Text>
        <Controller
          control={control}
          name="email"
          render={({ field: { onBlur, onChange, value } }) => (
            <TextInput
              value={value}
              onBlur={onBlur}
              onChangeText={onChange}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              returnKeyType="send"
              onSubmitEditing={() => void submit()}
              accessibilityLabel="Adresse e-mail"
              className="min-h-12 rounded-2xl border border-line bg-white px-4 py-3 text-base text-ink"
            />
          )}
        />
        {errors.email ? (
          <Text accessibilityRole="alert" className="text-sm text-red-700">
            {errors.email.message}
          </Text>
        ) : null}
      </View>
      <PrimaryButton
        label="Recevoir un code"
        loading={isSubmitting}
        onPress={() => void submit()}
      />
    </AppScreen>
  );
}
