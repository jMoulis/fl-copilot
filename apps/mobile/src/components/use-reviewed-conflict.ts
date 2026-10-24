import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
export type ConflictDecisionLifetime = {
  canResolve: () => boolean;
  signal: AbortSignal;
};
/** Native review lifetime only. Domain services own the comparison, authority,
 * immutable data policy, transaction and Outbox; this hook never writes business data. */
export function useReviewedConflict<R>({
  scope,
  read,
  choose,
  canChoose,
  errorText,
  onSuccess,
  readError = "La comparaison ne peut pas être lue. Vos modifications sont conservées ; réessayez la lecture.",
  reloadError = "La comparaison ne peut pas être relue. Vos modifications sont conservées.",
}: {
  scope: object;
  read: () => Promise<R>;
  choose: (
    review: R,
    useLocal: boolean,
    lifetime: ConflictDecisionLifetime,
  ) => Promise<void>;
  canChoose: (review: R, useLocal: boolean) => boolean;
  errorText: (reason: unknown) => string;
  onSuccess: () => void;
  readError?: string;
  reloadError?: string;
}) {
  const activeScope = useRef<object | null>(null);
  useLayoutEffect(() => {
    activeScope.current = scope;
    return () => {
      if (activeScope.current === scope) activeScope.current = null;
    };
  }, [scope]);
  const [loaded, setLoaded] = useState<{ scope: object; value: R }>(),
    [compared, setCompared] = useState(false),
    [busy, setBusy] = useState(false),
    [reading, setReading] = useState(true),
    [error, setError] = useState<string>();
  const review = loaded?.scope === scope ? loaded.value : undefined;
  const setReview = useCallback(
    (value: R | undefined) => {
      setLoaded(value === undefined ? undefined : { scope, value });
    },
    [scope],
  );
  const revision = useRef(0),
    live = useRef(false),
    locked = useRef(false),
    abort = useRef<AbortController | undefined>(undefined);
  useFocusEffect(
    useCallback(() => {
      const v = ++revision.current;
      live.current = true;
      locked.current = false;
      abort.current = undefined;
      setReview(undefined);
      setReading(true);
      setCompared(false);
      setBusy(false);
      setError(undefined);
      const current = () =>
        activeScope.current === scope && live.current && revision.current === v;
      void read()
        .then((next) => {
          if (current()) {
            setReview(next);
            setReading(false);
          }
        })
        .catch(() => {
          if (current()) {
            setReading(false);
            setError(readError);
          }
        });
      return () => {
        live.current = false;
        revision.current++;
        abort.current?.abort();
      };
    }, [read, scope, readError, setReview]),
  );
  const renderedRevision = revision.current;
  async function resolve(useLocal: boolean) {
    if (
      activeScope.current !== scope ||
      renderedRevision !== revision.current ||
      locked.current ||
      !live.current ||
      reading ||
      !!error ||
      review === undefined ||
      !compared ||
      !canChoose(review, useLocal)
    )
      return;
    const v = revision.current,
      cancel = new AbortController(),
      current = () =>
        activeScope.current === scope && live.current && revision.current === v;
    locked.current = true;
    abort.current = cancel;
    setBusy(true);
    setError(undefined);
    try {
      await choose(review, useLocal, {
        canResolve: current,
        signal: cancel.signal,
      });
      if (current()) onSuccess();
    } catch (reason) {
      if (current()) {
        setCompared(false);
        setError(errorText(reason));
        const next = await read().catch(() => undefined);
        if (current()) setReview(next);
      }
    } finally {
      if (abort.current === cancel) {
        abort.current = undefined;
        locked.current = false;
        if (current()) setBusy(false);
      }
    }
  }
  function reload() {
    if (
      locked.current ||
      reading ||
      !live.current ||
      activeScope.current !== scope ||
      renderedRevision !== revision.current
    )
      return;
    const v = ++revision.current,
      current = () =>
        activeScope.current === scope && live.current && revision.current === v;
    setReading(true);
    setCompared(false);
    setError(undefined);
    void read()
      .then((next) => {
        if (current()) {
          setReview(next);
          setReading(false);
        }
      })
      .catch(() => {
        if (current()) {
          setReading(false);
          setError(reloadError);
        }
      });
  }
  return {
    review,
    compared: review !== undefined && compared,
    setCompared: (value: boolean) => {
      if (
        activeScope.current === scope &&
        renderedRevision === revision.current &&
        live.current &&
        !locked.current &&
        !reading &&
        !error &&
        review !== undefined
      )
        setCompared(value);
    },
    busy: loaded?.scope === scope && busy,
    reading: reading || (loaded !== undefined && loaded.scope !== scope),
    error: loaded && loaded.scope !== scope ? undefined : error,
    resolve,
    reload,
    isCurrent: () =>
      activeScope.current === scope &&
      renderedRevision === revision.current &&
      live.current &&
      !locked.current &&
      !reading &&
      !error,
  };
}
