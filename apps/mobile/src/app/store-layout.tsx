import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { randomUUID } from "expo-crypto";
import { createPilotStoreLayout } from "@fl-copilot/commercial-core";
import { useAuth } from "../auth/auth-provider";
import { useLocalDatabase } from "../providers/database-provider";
import { useSync } from "../sync/sync-provider";
import { ConflictRepository } from "../sync/conflict-repository";
import { AppScreen, InlineAlert } from "../components/ui";
import { StoreLayoutRepository } from "../store/layout-repository";
import {
  StoreLayoutPanel,
  type LayoutAction,
  type LayoutSnapshot,
} from "../store/layout-panel";
import { layoutError } from "../store/layout-view-model";
export default function StoreLayoutScreen() {
  const { session } = useAuth(),
    store = session?.stores[0];
  if (!store || !session)
    return (
      <AppScreen>
        <InlineAlert
          title="Magasin indisponible"
          message="Reconnectez-vous au magasin pour consulter son plan."
        />
      </AppScreen>
    );
  return (
    <StorePlan
      key={`${store.storeId}:${session.user.id}`}
      storeId={store.storeId}
      actorId={session.user.id}
      allowed={store.role === "MANAGER"}
    />
  );
}
function StorePlan({
  storeId,
  actorId,
  allowed,
}: {
  storeId: string;
  actorId: string;
  allowed: boolean;
}) {
  const { sqlite, deviceId } = useLocalDatabase(),
    { syncNow, lastSyncedAt, status } = useSync();
  const repo = useMemo(
    () => new StoreLayoutRepository(sqlite, randomUUID),
    [sqlite],
  );
  const [snapshot, setSnapshot] = useState<LayoutSnapshot>({
      head: null,
      reference: null,
      conflicts: [],
    }),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [notice, setNotice] = useState<string>();
  const authority = useRef(allowed);
  authority.current = allowed;
  const active = useRef(false),
    reading = useRef(0),
    locked = useRef(false);
  const refresh = useCallback(async () => {
    const request = ++reading.current;
    const head = await repo.get(storeId),
      [reference, conflicts] = await Promise.all([
        head?.entity.referenceRevisionId
          ? repo.getRevision(storeId, head.entity.referenceRevisionId)
          : Promise.resolve(null),
        new ConflictRepository(sqlite).listOpen(storeId),
      ]);
    if (active.current && reading.current === request) {
      setSnapshot({
        head,
        reference,
        conflicts: conflicts.filter((c) => c.entityType === "store_layout"),
      });
      setLoaded(true);
    }
  }, [repo, sqlite, storeId]);
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      void refresh().catch(() => {
        if (active.current)
          setError(
            "Le plan local n’a pas pu être relu. Les informations déjà affichées restent conservées.",
          );
      });
      return () => {
        active.current = false;
        reading.current++;
      };
    }, [refresh]),
  );
  const syncVersion = useRef(`${lastSyncedAt}:${status}`);
  useEffect(() => {
    const next = `${lastSyncedAt}:${status}`;
    if (syncVersion.current === next) return;
    syncVersion.current = next;
    if (active.current)
      void refresh().catch(() => {
        if (active.current)
          setError("Le plan n’a pas pu être relu après la synchronisation.");
      });
  }, [refresh, lastSyncedAt, status]);
  function context() {
    if (!authority.current || !active.current)
      throw Error("STORE_LAYOUT_AUTHORITY_CHANGED");
    return {
      commandId: randomUUID(),
      deviceId,
      actorId,
      canWrite: true as const,
    };
  }
  async function save(a: LayoutAction) {
    if (locked.current) throw Error("STORE_LAYOUT_SYNCING");
    locked.current = true;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const saved = await repo.save({ storeId, ...a }, context());
      if (active.current) {
        setSnapshot((prev) => ({
          ...prev,
          head: {
            entity: saved,
            remote: prev.head?.remote ?? null,
            remoteVersion: prev.head?.remoteVersion ?? null,
            syncState: "PENDING",
          },
          reference:
            saved.action === "ADOPT_REFERENCE" ? saved : prev.reference,
        }));
        setLoaded(true);
        setNotice(
          saved.action === "ADOPT_REFERENCE"
            ? "Plan choisi comme référence. Les mesures non confirmées restent à préciser."
            : saved.action === "DISCARD_DRAFT"
              ? "Brouillon abandonné. Sa version reste dans l’historique."
              : "Brouillon enregistré sur cet appareil, disponible hors connexion.",
        );
      }
      await refresh().catch(() => {
        if (active.current)
          setError(
            "Le plan est enregistré. La relecture locale a échoué ; rouvrez le plan avant une nouvelle modification.",
          );
      });
      void syncNow(storeId).catch(() => undefined);
    } catch (e) {
      if (active.current) setError(layoutError(e));
      throw e;
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function resolve(
    id: string,
    localRevisionId: string,
    remoteRevisionId: string,
    useLocal: boolean,
  ) {
    if (locked.current) throw Error("STORE_LAYOUT_SYNCING");
    locked.current = true;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await repo.resolve(
        id,
        { storeId, localRevisionId, remoteRevisionId, useLocal },
        context(),
      );
      await refresh();
      if (active.current)
        setNotice(
          useLocal
            ? "Votre version est reprise dans un nouveau brouillon. Examinez-le avant de le choisir comme référence."
            : "La version synchronisée est utilisée. Votre version locale reste dans l’historique.",
        );
      void syncNow(storeId).catch(() => undefined);
    } catch (e) {
      if (active.current) setError(layoutError(e));
      throw e;
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <AppScreen>
      <StoreLayoutPanel
        snapshot={snapshot}
        loaded={loaded}
        busy={busy}
        allowed={allowed}
        error={error}
        notice={notice}
        onBack={() => router.back()}
        onSync={() => router.push("/sync-center")}
        onInitialize={() => {
          if (snapshot.head)
            return Promise.reject(new Error("STORE_LAYOUT_SOURCE_CHANGED"));
          return save({
            action: "SAVE_DRAFT",
            expectedRevisionId: null,
            content: createPilotStoreLayout(randomUUID),
          });
        }}
        onAction={save}
        onResolve={resolve}
        onHistory={(before) => repo.history(storeId, 20, before)}
      />
    </AppScreen>
  );
}
