import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { Platform } from "react-native";
import { useAuth } from "../auth/auth-provider";
import { useSync } from "../sync/sync-provider";
import { subscribeOutboxChanges } from "../sync/outbox-repository";
import type {
  SourceOriginalProof,
  SourceOriginalState,
} from "./source-original-transfer";
import {
  SourceOriginalActions,
  sourceOriginalMessage,
} from "./source-original-actions";
export function SourceOriginalButton({
  sourceDocumentId,
  label,
}: {
  sourceDocumentId: string;
  label?: string;
}) {
  const { session } = useAuth(),
    sync = useSync(),
    originals = sync.originals;
  const scope = `${session?.stores[0]?.storeId ?? ""}/${session?.user.id ?? ""}/${sourceDocumentId}`;
  const current = useRef(scope);
  current.current = scope;
  const revision = useRef(0),
    operation = useRef<string | null>(null),
    sequence = useRef(0);
  const [display, setDisplay] = useState<{
    scope: string;
    state: SourceOriginalState | null;
    proof: SourceOriginalProof | null;
    open: boolean;
    error?: string;
  }>({ scope, state: null, proof: null, open: false });
  const [busyFor, setBusyFor] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!originals) return;
    const v = revision.current,
      state = await originals.state(sourceDocumentId);
    if (current.current === scope && revision.current === v)
      setDisplay((old) =>
        old.scope === scope
          ? { ...old, state }
          : { scope, state, proof: null, open: false },
      );
  }, [originals, sourceDocumentId, scope]);
  useFocusEffect(
    useCallback(() => {
      revision.current++;
      setDisplay({ scope, state: null, proof: null, open: false });
      const v = revision.current;
      const refresh = () => {
        void load().catch(() => {
          if (current.current === scope && revision.current === v)
            setDisplay({
              scope,
              state: null,
              proof: null,
              open: false,
              error:
                "L’original ne peut pas être consulté pour ce magasin ou ce compte.",
            });
        });
      };
      refresh();
      const unsubscribe = subscribeOutboxChanges(refresh);
      return () => {
        revision.current++;
        setDisplay((old) =>
          old.scope === scope ? { ...old, open: false, proof: null } : old,
        );
        unsubscribe();
      };
    }, [load, scope]),
  );
  const run = async (
    action: "OPEN" | "CANCEL" | "SHARE",
    viewIndex?: number,
  ) => {
    if (!originals || operation.current?.startsWith(`${scope}:`)) return;
    const token = `${scope}:${++sequence.current}`,
      v = revision.current;
    const check = () => {
      if (current.current !== scope || revision.current !== v)
        throw Error("SOURCE_ORIGINAL_SCOPE_CHANGED");
    };
    operation.current = token;
    setBusyFor(scope);
    setDisplay((old) =>
      old.scope === scope
        ? { ...old, error: undefined }
        : { scope, state: null, proof: null, open: false },
    );
    try {
      if (action === "CANCEL") {
        await originals.cancel(sourceDocumentId);
        check();
        await load();
        return;
      }
      const state = await originals.state(sourceDocumentId),
        proof = await originals.local(sourceDocumentId);
      check();
      if (!proof) {
        setDisplay({ scope, state, proof: null, open: false });
        await originals.request(
          sourceDocumentId,
          state.job?.status === "FAILED",
        );
        check();
        await load();
        return;
      }
      setDisplay({ scope, state, proof, open: true });
      if (action === "SHARE") {
        if (Platform.OS === "web")
          throw Error("SOURCE_ORIGINAL_SHARE_UNAVAILABLE");
        const { requireOptionalNativeModule } =
          await import("expo-modules-core");
        check();
        if (!requireOptionalNativeModule("ExpoSharing"))
          throw Error("SOURCE_ORIGINAL_SHARE_UNAVAILABLE");
        const sharing = await import("expo-sharing");
        if (!(await sharing.isAvailableAsync()))
          throw Error("SOURCE_ORIGINAL_SHARE_UNAVAILABLE");
        check();
        const view =
          viewIndex === undefined ? undefined : proof.views?.[viewIndex];
        if (viewIndex !== undefined && !view)
          throw Error("SOURCE_ORIGINAL_BINDING_INVALID");
        await sharing.shareAsync(view?.localUri ?? proof.localUri, {
          dialogTitle: state.filename ?? "Fichier original",
          ...((view?.mimeType ?? state.mimeType)
            ? { mimeType: view?.mimeType ?? state.mimeType! }
            : {}),
        });
      }
    } catch (error) {
      if (current.current === scope && revision.current === v)
        setDisplay((old) => ({
          ...(old.scope === scope
            ? old
            : { scope, state: null, proof: null, open: false }),
          error: sourceOriginalMessage(
            error instanceof Error ? error.message : null,
          ),
        }));
    } finally {
      if (operation.current === token) {
        operation.current = null;
        setBusyFor(null);
      }
    }
  };
  const visible =
    display.scope === scope
      ? display
      : { state: null, proof: null, open: false, error: undefined };
  return (
    <SourceOriginalActions
      {...visible}
      disabled={!originals}
      busy={busyFor === scope}
      offline={sync.status === "offline"}
      label={label}
      onOpen={() => void run("OPEN")}
      onCancel={() => void run("CANCEL")}
      onShare={(viewIndex) => void run("SHARE", viewIndex)}
      onClose={() =>
        setDisplay((old) =>
          old.scope === scope ? { ...old, open: false, proof: null } : old,
        )
      }
    />
  );
}
