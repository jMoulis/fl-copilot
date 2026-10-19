import { Pressable, Text, TextInput, View } from "react-native";
import type {
  CopilotForm,
  CopilotFormAnswers,
  CopilotFormIssue,
} from "@fl-copilot/domain";
import { DateSelector } from "@/components/date-selector";
import { InlineAlert, PrimaryButton, SecondaryButton } from "@/components/ui";
export type CopilotFormCardAction = "SUBMIT" | "POSTPONE" | "CANCEL" | "RESUME";
const units = {
  EUR: "€",
  KG: "kg",
  PIECE: "pièces",
  CM: "cm",
  PERCENT: "%",
  NONE: "",
};
/** Controlled inline view. The host saves drafts and catches asynchronous action errors. */
export function CopilotInlineFormCard({
  form,
  values,
  issues = [],
  busy = false,
  error,
  notice,
  onAnswer,
  onAction,
  onChooseFile,
}: {
  form: CopilotForm;
  values: CopilotFormAnswers;
  issues?: CopilotFormIssue[];
  busy?: boolean;
  error?: string;
  notice?: string;
  onAnswer(key: string, value: CopilotFormAnswers[string]): void;
  onAction(action: CopilotFormCardAction): void;
  onChooseFile?(key: string): void;
}) {
  const ended = ["ANSWERED", "CANCELLED", "STALE"].includes(form.status);
  const summary = {
    ANSWERED: "Réponse enregistrée",
    CANCELLED: "Question annulée",
    STALE: "Le contexte a changé. Une nouvelle question est nécessaire.",
    POSTPONED: "Question mise de côté",
    OPEN: "",
    READY: "",
  }[form.status];
  return (
    <View className="w-full max-w-xl gap-4 rounded-2xl border border-line bg-surface p-4">
      <Text
        accessibilityRole="header"
        className="text-lg font-semibold text-ink"
      >
        {form.definition.title}
      </Text>
      {error ? (
        <InlineAlert title="Réponse non envoyée" message={error} />
      ) : null}
      {ended || form.status === "POSTPONED" ? (
        <>
          <Text
            accessibilityLiveRegion="polite"
            className="text-sm leading-5 text-muted"
          >
            {summary}
          </Text>
          {notice ? (
            <Text
              accessibilityLiveRegion="polite"
              className="text-sm text-muted"
            >
              {notice}
            </Text>
          ) : null}
          {form.status === "POSTPONED" ? (
            <SecondaryButton
              label="Répondre"
              disabled={busy}
              onPress={() => onAction("RESUME")}
            />
          ) : null}
        </>
      ) : (
        <>
          <Text className="text-sm leading-5 text-muted">
            {form.definition.reason}
          </Text>
          {form.definition.fields.map((field) => {
            const value = values[field.key],
              text = typeof value === "string" ? value : "",
              issue = issues.find((i) => i.key === field.key)?.message;
            return (
              <View key={field.key} className="gap-2">
                <Text className="text-sm font-semibold text-ink">
                  {field.label}
                  {field.required ? " · nécessaire" : " · facultatif"}
                </Text>
                {field.type === "DATE" ? (
                  <DateSelector
                    value={text}
                    label={field.label}
                    description="Choisissez la date pour cette réponse."
                    issue={issue}
                    disabled={busy}
                    onConfirm={(v) => {
                      if (!busy) onAnswer(field.key, v);
                    }}
                  />
                ) : null}
                {field.type === "TEXT" || field.type === "NUMBER" ? (
                  <View
                    className={`flex-row items-center rounded-xl border px-3 ${issue ? "border-critical bg-critical-soft" : "border-line bg-canvas"}`}
                  >
                    <TextInput
                      value={text}
                      editable={!busy}
                      onChangeText={(v) => onAnswer(field.key, v)}
                      accessibilityLabel={field.label}
                      accessibilityHint={
                        issue ??
                        (field.type === "NUMBER"
                          ? `${units[field.unit]} · Vous pouvez utiliser une virgule pour les décimales.`
                          : undefined)
                      }
                      keyboardType={
                        field.type === "NUMBER" ? "decimal-pad" : "default"
                      }
                      multiline={field.type === "TEXT"}
                      maxLength={field.type === "NUMBER" ? 40 : field.maxLength}
                      className="min-h-12 flex-1 py-3 text-base text-ink"
                    />
                    {field.type === "NUMBER" && units[field.unit] ? (
                      <Text className="pl-2 text-sm text-muted">
                        {units[field.unit]}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
                {field.type === "CHOICE" ? (
                  <View className="gap-2">
                    {field.options.map((option) => {
                      const selected = text === option.id;
                      return (
                        <Pressable
                          key={option.id}
                          accessibilityRole="radio"
                          accessibilityLabel={option.label}
                          accessibilityState={{
                            checked: selected,
                            disabled: busy,
                          }}
                          disabled={busy}
                          onPress={() => onAnswer(field.key, option.id)}
                          className={`min-h-12 flex-row items-center gap-3 rounded-xl border px-3 py-3 ${issue ? "border-critical" : selected ? "border-forest" : "border-line"} ${selected ? "bg-forest-soft" : "bg-canvas"}`}
                        >
                          <Text
                            accessible={false}
                            className="text-base text-forest"
                          >
                            {selected ? "●" : "○"}
                          </Text>
                          <Text className="flex-1 text-base text-ink">
                            {option.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
                {field.type === "FILE" ? (
                  <View className="gap-2">
                    {value && typeof value !== "string" ? (
                      <>
                        <Text className="text-sm text-ink">
                          {value.filename}
                        </Text>
                        <SecondaryButton
                          label="Retirer ce fichier"
                          disabled={busy}
                          onPress={() => onAnswer(field.key, null)}
                        />
                      </>
                    ) : null}
                    <SecondaryButton
                      label={
                        value ? "Changer de fichier" : "Ajouter un fichier"
                      }
                      disabled={busy || !onChooseFile}
                      onPress={() => onChooseFile?.(field.key)}
                    />
                    {!onChooseFile ? (
                      <Text className="text-sm text-muted">
                        Ajout de fichier indisponible pour le moment.
                      </Text>
                    ) : null}
                  </View>
                ) : null}
                {issue ? (
                  <Text
                    accessibilityRole="alert"
                    accessibilityLiveRegion="polite"
                    className="text-sm leading-5 text-critical"
                  >
                    {issue}
                  </Text>
                ) : null}
              </View>
            );
          })}
          {notice ? (
            <Text
              accessibilityLiveRegion="polite"
              className="text-sm text-muted"
            >
              {notice}
            </Text>
          ) : null}
          <PrimaryButton
            label="Envoyer la réponse"
            loading={busy}
            onPress={() => onAction("SUBMIT")}
          />
          <SecondaryButton
            label="Plus tard"
            disabled={busy}
            onPress={() => onAction("POSTPONE")}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Annuler cette question"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() => onAction("CANCEL")}
            className="min-h-12 items-center justify-center px-2"
          >
            <Text className="text-sm text-muted">Annuler cette question</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}
