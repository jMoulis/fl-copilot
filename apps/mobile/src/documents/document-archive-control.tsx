import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { randomUUID } from "expo-crypto";
import type { DocumentArchiveKind } from "@fl-copilot/domain";
import { SecondaryButton, InlineAlert } from "../components/ui";
import { DocumentArchiveRepository } from "./document-archive-repository";

export interface DocumentArchiveAccess {
  deviceId: string;
  canWrite(): boolean;
  revision?: string;
  onChanged?(): void | Promise<void>;
}
export function DocumentArchiveControl({
  repository,
  access,
  id,
  targetKind,
  archived,
  name,
  onChanged,
  disabled = false,
}: {
  repository: DocumentArchiveRepository;
  access: DocumentArchiveAccess;
  id: string;
  targetKind: DocumentArchiveKind;
  archived: boolean;
  name: string;
  onChanged(): Promise<void>;
  disabled?: boolean;
}) {
  const live = useRef(true),
    locked = useRef(false);
  const current = useRef({
    repository,
    access,
    id,
    targetKind,
    disabled,
    archived,
  });
  current.current = { repository, access, id, targetKind, disabled, archived };
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  async function change() {
    if (
      locked.current ||
      current.current.repository !== repository ||
      current.current.id !== id ||
      current.current.targetKind !== targetKind ||
      current.current.archived !== archived
    )
      return;
    const scope = current.current;
    const canWrite = () =>
      live.current &&
      current.current.repository === scope.repository &&
      current.current.id === scope.id &&
      current.current.targetKind === scope.targetKind &&
      !current.current.disabled &&
      current.current.access.canWrite();
    if (!canWrite()) return;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    let committed = false;
    try {
      await scope.repository.set(scope.id, scope.targetKind, !scope.archived, {
        commandId: randomUUID(),
        deviceId: scope.access.deviceId,
        canWrite,
      });
      committed = true;
      if (!canWrite()) return;
      await onChanged();
      await current.current.access.onChanged?.();
    } catch {
      if (live.current && current.current.repository === scope.repository)
        setError(
          committed
            ? "Le rangement est enregistré. La liste n’a pas pu être actualisée ; rouvrez-la."
            : "Le rangement n’a pas été enregistré. Réessayez depuis la liste du compte actif.",
        );
    } finally {
      locked.current = false;
      if (live.current) setBusy(false);
    }
  }
  return (
    <View className="gap-2">
      <SecondaryButton
        label={busy ? "Enregistrement…" : archived ? "Restaurer" : "Archiver"}
        accessibilityLabel={(archived ? "Restaurer " : "Archiver ") + name}
        disabled={disabled || busy}
        loading={busy}
        onPress={() => void change()}
      />
      {error ? <InlineAlert title="Rangement" message={error} /> : null}
    </View>
  );
}
export function ArchiveViewFilter({
  archived,
  onChange,
  label,
  disabled = false,
}: {
  archived: boolean;
  onChange(value: boolean): void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {[false, true].map((value) => (
        <Pressable
          key={String(value)}
          accessibilityRole="radio"
          accessibilityLabel={label + " : " + (value ? "Archivés" : "Actifs")}
          accessibilityState={{ checked: archived === value, disabled }}
          disabled={disabled}
          onPress={() => onChange(value)}
          className={
            "min-h-12 justify-center rounded-xl border px-3 py-2 " +
            (archived === value
              ? "border-forest bg-forest"
              : "border-line bg-surface")
          }
        >
          <Text
            className={
              archived === value ? "font-semibold text-on-accent" : "text-ink"
            }
          >
            {value ? "Archivés" : "Actifs"}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
