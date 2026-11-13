import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { ApiClient } from "@fl-copilot/api-client";
import {
  storeContextFingerprint,
  parisDate,
  type WeeklyContext,
} from "@fl-copilot/domain";
import { useAuth } from "../auth/auth-provider";
import { useLocalDatabase } from "../providers/database-provider";
import { useSync } from "../sync/sync-provider";
import { getApiBaseUrl } from "../config/environment";
import {
  StoreContextRepository,
  type LocalStoreContext,
} from "./context-repository";
import {
  WeeklyContextRepository,
  contextIsStale,
} from "./weekly-context-repository";

/** Local reads render first. Refreshes are explicit or once on a stale journal focus. */
export function useWeeklyContext(
  storeId: string,
  weekStart: string,
  autoRefresh = false,
) {
  const { sqlite } = useLocalDatabase();
  const { withAccessToken, session } = useAuth();
  const { lastSyncedAt } = useSync();
  const settingsRepo = useMemo(
    () => new StoreContextRepository(sqlite),
    [sqlite],
  );
  const cache = useMemo(() => new WeeklyContextRepository(sqlite), [sqlite]);
  const api = useMemo(() => new ApiClient(getApiBaseUrl()), []);
  const scope = `${session?.user.id}:${storeId}:${weekStart}`;
  const current = useRef(scope);
  current.current = scope;
  const alive = useRef(true);
  const requests = useRef(new Set<string>());
  const focused = useRef(false);
  const attempts = useRef(new Map<string, number>());
  const [busyScopes, setBusyScopes] = useState<string[]>([]);
  const busy = busyScopes.includes(scope);
  const [data, setData] = useState<{
    scope: string;
    settings: LocalStoreContext | null;
    context: WeeklyContext | null;
  }>();
  const [failure, setFailure] = useState<{ scope: string; message: string }>();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (requests.current.has(scope)) return;
    requests.current.add(scope);
    attempts.current.set(scope, Date.now());
    setBusyScopes((previous) => [...previous, scope]);
    setFailure(undefined);
    const valid = () => alive.current && current.current === scope;
    try {
      const initial = await settingsRepo.get(storeId);
      if (!valid()) return;
      if (!initial || initial.syncState !== "SYNCED")
        throw Error(
          "Enregistre puis synchronise les réglages de ton magasin avant d’actualiser le contexte.",
        );
      const result = await withAccessToken((token) =>
        api.weeklyContext(
          token,
          storeId,
          weekStart,
          true,
          autoRefresh,
          autoRefresh,
          autoRefresh,
        ),
      );
      if (!valid()) return;
      if (result.storeId !== storeId || result.weekStart !== weekStart)
        throw Error(
          "Le contexte reçu ne correspond pas à la semaine de ce magasin.",
        );
      const latest = await settingsRepo.get(storeId);
      if (!valid()) return;
      if (
        !latest ||
        storeContextFingerprint(latest.entity) !== result.settingsFingerprint
      )
        throw Error(
          "Les réglages du magasin ont changé. Synchronise-les puis actualise le contexte.",
        );
      const saved = await cache.save(result, latest.entity);
      if (valid()) setData({ scope, settings: latest, context: saved });
      if (
        valid() &&
        [saved.weather, saved.publicHolidays, saved.schoolHolidays].some(
          (p) => p.status === "UNAVAILABLE" || p.status === "STALE",
        )
      ) {
        setFailure({
          scope,
          message:
            "Une source est indisponible. Les dernières données enregistrées restent consultables.",
        });
      }
    } catch (e) {
      if (valid())
        setFailure({
          scope,
          message:
            e instanceof Error
              ? e.message
              : "Actualisation impossible. Les données enregistrées restent disponibles.",
        });
    } finally {
      requests.current.delete(scope);
      if (alive.current)
        setBusyScopes((previous) => previous.filter((s) => s !== scope));
    }
  }, [
    api,
    autoRefresh,
    cache,
    scope,
    settingsRepo,
    storeId,
    weekStart,
    withAccessToken,
  ]);

  const readLocal = useCallback(() => {
    let active = true;
    void (async () => {
      try {
        const settings = await settingsRepo.get(storeId);
        const context = settings
          ? await cache.get(settings.entity, weekStart)
          : null;
        if (!active || !alive.current || current.current !== scope) return;
        setData((previous) => {
          if (
            previous?.scope === scope &&
            settings &&
            previous.settings &&
            storeContextFingerprint(previous.settings.entity) ===
              storeContextFingerprint(settings.entity) &&
            previous.context &&
            (!context || previous.context.retrievedAt > context.retrievedAt)
          )
            return previous;
          return { scope, settings, context };
        });
        if (
          autoRefresh &&
          focused.current &&
          settings?.syncState === "SYNCED" &&
          (!context ||
            !context.economy ||
            !context.journal ||
            context.journal.sources.some(
              (p) =>
                p.status !== "NOT_CONFIGURED" &&
                (!p.validUntil || p.validUntil <= new Date().toISOString()),
            ) ||
            (weekStart < parisDate(new Date().toISOString()) &&
              (!context.observedWeather ||
                context.observedWeather.issue === "PROVIDER_UNAVAILABLE" ||
                contextIsStale(context.observedWeather, new Date()))) ||
            [
              context.weather,
              context.publicHolidays,
              context.schoolHolidays,
              ...(context.economy ? [context.economy] : []),
            ].some(
              (p) =>
                p.status === "UNAVAILABLE" || contextIsStale(p, new Date()),
            )) &&
          Date.now() - (attempts.current.get(scope) ?? 0) > 15 * 60_000
        ) {
          attempts.current.set(scope, Date.now());
          void refresh();
        }
      } catch {
        if (active && alive.current && current.current === scope)
          setFailure({
            scope,
            message:
              "Le contexte local ne peut pas être lu. Tes observations et ta préparation restent disponibles.",
          });
      }
    })();
    return () => {
      active = false;
    };
  }, [autoRefresh, cache, refresh, scope, settingsRepo, storeId, weekStart]);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      const stop = readLocal();
      return () => {
        focused.current = false;
        stop();
      };
    }, [readLocal]),
  );
  useEffect(() => {
    if (lastSyncedAt) return readLocal();
  }, [lastSyncedAt, readLocal]);
  const visible = data?.scope === scope ? data : undefined;
  const settings = visible?.settings ?? null;
  const context = visible?.context;
  const validContext =
    settings &&
    context?.storeId === storeId &&
    context.weekStart === weekStart &&
    context.settingsFingerprint === storeContextFingerprint(settings.entity)
      ? context
      : null;
  return {
    settings,
    context: validContext,
    busy,
    loading: !visible,
    error: failure?.scope === scope ? failure.message : undefined,
    refresh,
  };
}
