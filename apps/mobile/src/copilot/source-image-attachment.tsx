import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { SourceOriginalButton } from "../documents/source-original-button";
import { useAuth } from "../auth/auth-provider";
import { useLocalDatabase } from "../providers/database-provider";
import { useSync } from "../sync/sync-provider";
import { InlineAlert, SecondaryButton } from "../components/ui";
import { colors } from "../design/tokens";
import { SourceUploadRecoveryRepository } from "../documents/source-upload-recovery";
import { ReceiptAttachmentPanel } from "./receipt-attachment-panel";

type Photo = {
  filename: string;
  status: string;
};
/** Dispatch by the canonical source kind: an image is not automatically a waste ticket. */
export function SourceImageAttachment({
  sourceDocumentId,
}: {
  sourceDocumentId: string;
}) {
  const { session } = useAuth(),
    { sqlite } = useLocalDatabase(),
    sync = useSync();
  const storeId = session?.stores[0]?.storeId,
    ownerId = session?.user.id;
  const [kind, setKind] = useState<string>(),
    [photo, setPhoto] = useState<Photo>(),
    [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const revision = useRef(0),
    locked = useRef(false),
    actor = useRef(session);
  actor.current = session;
  const read = useCallback(async () => {
    if (!storeId || !ownerId) return;
    const v = revision.current;
    const row = await sqlite.getFirstAsync<{
      source_type: string;
      original_filename: string | null;
      remote_upload_status: string;
    }>(
      "SELECT source_type,original_filename,remote_upload_status FROM source_documents WHERE id=? AND store_id=? AND deleted_at IS NULL AND (source_type!='STORE_PHOTO' OR EXISTS (SELECT 1 FROM local_jobs j WHERE j.type='SOURCE_UPLOAD_AND_REGISTER' AND json_extract(j.payload_json,'$.sourceDocumentId')=source_documents.id AND json_extract(j.payload_json,'$.ownerId')=?))",
      sourceDocumentId,
      storeId,
      ownerId,
    );
    if (revision.current !== v) return;
    setKind(row?.source_type);
    setPhoto(
      row?.source_type === "STORE_PHOTO"
        ? {
            filename: row.original_filename ?? "Photo du rayon",
            status: row.remote_upload_status,
          }
        : undefined,
    );
  }, [sqlite, sourceDocumentId, storeId, ownerId]);
  useFocusEffect(
    useCallback(() => {
      revision.current++;
      setKind(undefined);
      setPhoto(undefined);
      setError(undefined);
      const v = revision.current;
      void read().catch(() => {
        if (v === revision.current)
          setError("Le suivi de cette photo ne peut pas être lu.");
      });
      return () => {
        revision.current++;
      };
    }, [read]),
  );
  useEffect(() => {
    if (sync.lastSyncedAt) void read().catch(() => undefined);
  }, [read, sync.lastSyncedAt]);
  const retry = async () => {
    if (locked.current || !storeId) return;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    const v = revision.current;
    const allowed = () =>
      actor.current?.user.id === ownerId &&
      (actor.current?.stores.some(
        (s) => s.storeId === storeId && s.role === "MANAGER",
      ) ??
        false);
    try {
      const repo = new SourceUploadRecoveryRepository(
          sqlite,
          async (text) => text,
        ),
        review = await repo.review(storeId, sourceDocumentId);
      if (review.sourceType !== "STORE_PHOTO" || review.ownerId !== ownerId)
        throw Error("STORE_PHOTO_UNAVAILABLE");
      if (review.canRetry)
        await repo.retry(storeId, sourceDocumentId, review.basisHash, {
          canRetry: allowed,
        });
      else if (
        photo?.status !== "CONFIRMED" &&
        review.reason &&
        v === revision.current
      )
        setError(review.reason);
      await sync.syncNow(storeId);
      if (v === revision.current) await read();
    } catch {
      if (v === revision.current)
        setError(
          "L’envoi n’a pas pu reprendre. La photo reste conservée sur cet appareil.",
        );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  if (kind === "WASTE_RECEIPT")
    return (
      <View style={{ gap: 10 }}>
        <ReceiptAttachmentPanel sourceDocumentId={sourceDocumentId} />
        <SourceOriginalButton
          sourceDocumentId={sourceDocumentId}
          label="Consulter les photos originales"
        />
      </View>
    );
  if (!photo)
    return (
      <View style={{ gap: 10 }}>
        <SourceOriginalButton sourceDocumentId={sourceDocumentId} />
        {error ? <InlineAlert title="Photo" message={error} /> : null}
      </View>
    );
  return (
    <View className="gap-2">
      <Text style={{ color: colors.muted, fontSize: 13 }}>
        {photo.status === "CONFIRMED"
          ? "Photo envoyée · consultable par le copilote"
          : ["FAILED", "INVALID"].includes(photo.status)
            ? "Photo conservée · envoi à reprendre"
            : photo.status === "UPLOADING"
              ? "Photo conservée · envoi en cours"
              : "Photo conservée · envoi en attente"}
      </Text>
      <SourceOriginalButton
        sourceDocumentId={sourceDocumentId}
        label="Voir la photo du rayon"
      />
      {photo.status !== "CONFIRMED" ? (
        <SecondaryButton
          label="Reprendre l’envoi et actualiser"
          disabled={busy}
          onPress={() => void retry()}
        />
      ) : null}
      {error ? <InlineAlert title="Photo du rayon" message={error} /> : null}
    </View>
  );
}
