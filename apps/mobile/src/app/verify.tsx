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
  SecondaryButton,
} from "@/components/ui";

const formSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Saisissez le code à six chiffres."),
});
type FormValues = z.infer<typeof formSchema>;

export default function VerifyScreen() {
  const router = useRouter();
  const { status, pendingChallenge, verifyCode, resendCode, changeEmail } =
    useAuth();
  const [error, setError] = useState<string>();
  const [resending, setResending] = useState(false);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { code: "" },
  });

  if (status === "authenticated") return <Redirect href="/(tabs)" />;
  if (!pendingChallenge) return <Redirect href={"/login" as Href} />;

  const errorMessage = (reason: unknown, fallback: string) =>
    reason instanceof ApiClientError ? reason.response.messageFr : fallback;

  const submit = handleSubmit(async ({ code }) => {
    setError(undefined);
    try {
      await verifyCode(code);
      router.replace("/(tabs)");
    } catch (reason) {
      setError(errorMessage(reason, "Le code n’a pas pu être vérifié."));
    }
  });

  const resend = async () => {
    setError(undefined);
    setResending(true);
    try {
      await resendCode();
    } catch (reason) {
      setError(errorMessage(reason, "Le code n’a pas pu être renvoyé."));
    } finally {
      setResending(false);
    }
  };

  return (
    <AppScreen>
      <AppHeader
        title="Code de vérification"
        subtitle={`Saisissez le code envoyé à ${pendingChallenge.email}.`}
      />
      {error ? (
        <InlineAlert title="Vérification impossible" message={error} />
      ) : null}
      <View className="gap-2">
        <Text className="text-base font-semibold text-ink">
          Code à six chiffres
        </Text>
        <Controller
          control={control}
          name="code"
          render={({ field: { onBlur, onChange, value } }) => (
            <TextInput
              value={value}
              onBlur={onBlur}
              onChangeText={(next) =>
                onChange(next.replace(/\D/g, "").slice(0, 6))
              }
              autoComplete="one-time-code"
              keyboardType="number-pad"
              maxLength={6}
              returnKeyType="done"
              onSubmitEditing={() => void submit()}
              accessibilityLabel="Code de vérification à six chiffres"
              className="min-h-12 rounded-2xl border border-line bg-white px-4 py-3 text-center text-2xl tracking-widest text-ink"
            />
          )}
        />
        {errors.code ? (
          <Text accessibilityRole="alert" className="text-sm text-red-700">
            {errors.code.message}
          </Text>
        ) : null}
      </View>
      <PrimaryButton
        label="Se connecter"
        loading={isSubmitting}
        onPress={() => void submit()}
      />
      <SecondaryButton
        label="Renvoyer le code"
        loading={resending}
        onPress={() => void resend()}
      />
      <SecondaryButton
        label="Changer d’adresse e-mail"
        onPress={() => {
          changeEmail();
          router.replace("/login" as Href);
        }}
      />
    </AppScreen>
  );
}
