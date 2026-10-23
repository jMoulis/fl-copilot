import { useLayoutEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useAuth } from "../auth/auth-provider";
import {
  useDatabaseRestore,
  useLocalDatabase,
} from "../providers/database-provider";
import {
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
  SectionCard,
} from "../components/ui";
import {
  createLocalCopy,
  listLocalCopies,
  prepareLocalCopy,
} from "./local-copies-native";
import {
  LocalCopyError,
  type LocalCopyRef,
  type PreparedLocalCopy,
} from "./local-copy-contracts";

export function LocalCopiesPanel() {
  const { session, status } = useAuth(),
    db = useLocalDatabase();
  const storeId = session?.stores[0]?.storeId,
    ownerId = session?.user.id;
  if (status !== "authenticated" || !storeId || !ownerId) return null;
  return (
    <Copies
      key={`${ownerId}/${storeId}/${db.deviceId}`}
      ownerId={ownerId}
      storeId={storeId}
    />
  );
}
function Copies({ ownerId, storeId }: { ownerId: string; storeId: string }) {
  const db = useLocalDatabase(),
    restore = useDatabaseRestore(),
    { logout } = useAuth();
  const [open, setOpen] = useState(false),
    [copies, setCopies] = useState<LocalCopyRef[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState<string>(),
    [prepared, setPrepared] = useState<PreparedLocalCopy>(),
    [page, setPage] = useState(0);
  const alive = useRef(false),
    locked = useRef(false);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const assertCurrent = () => {
    if (!alive.current) throw new LocalCopyError("CHANGED");
  };
  const run = async (action: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      await action();
    } catch (error) {
      if (alive.current)
        setMessage(
          error instanceof LocalCopyError
            ? error.message
            : new LocalCopyError("UNAVAILABLE").message,
        );
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const read = async () => {
    const next = await listLocalCopies(ownerId, storeId);
    assertCurrent();
    setCopies(next);
    setPage(0);
  };
  return (
    <SectionCard title="Copies locales de sécurité">
      <Text className="text-sm leading-5 text-muted">
        Une copie protège la base locale et ses actions en attente sur cet
        appareil. Ce n’est pas une sauvegarde en ligne : supprimer l’application
        supprime aussi ces copies. Les photos et documents restent à leur
        emplacement d’origine et ne sont pas dupliqués.
      </Text>
      <SecondaryButton
        label={open ? "Masquer les copies" : "Gérer les copies locales"}
        disabled={busy}
        onPress={() => {
          if (!open) void run(read);
          setOpen(!open);
        }}
      />
      {open ? (
        <>
          {message ? (
            <InlineAlert title="Copie locale" message={message} />
          ) : null}
          {prepared ? (
            <View className="gap-3">
              <Text className="text-base font-semibold text-ink">
                Copie vérifiée · {prepared.pendingCount} commande(s) non
                acquittée(s) dans ce magasin
              </Text>
              <Text className="text-sm leading-5 text-muted">
                Reprendre cette copie ferme votre session et nécessite de fermer
                puis rouvrir l’application. Votre base courante reste conservée
                séparément, accessible ici après reconnexion avec le même
                compte. Aucune fusion automatique : les brouillons restent dans
                leur copie ; la synchronisation habituelle contrôle les envois
                et les conflits.
              </Text>
              <PrimaryButton
                label="Reprendre cette copie et me déconnecter"
                disabled={busy}
                onPress={() => {
                  void run(async () => {
                    assertCurrent();
                    // Start canonical logout before operational children unmount.
                    const clearing = logout({ localOnly: true });
                    restore(prepared, clearing);
                  });
                }}
              />
              <SecondaryButton
                label="Annuler la reprise"
                disabled={busy}
                onPress={() => setPrepared(undefined)}
              />
            </View>
          ) : (
            <>
              <PrimaryButton
                label="Créer une copie maintenant"
                loading={busy}
                onPress={() => {
                  void run(async () => {
                    await createLocalCopy(
                      db.sqlite,
                      db.deviceId,
                      ownerId,
                      storeId,
                      assertCurrent,
                    );
                    await read();
                    setMessage(
                      "La copie a été créée et vérifiée sur cet appareil.",
                    );
                  });
                }}
              />
              <SecondaryButton
                label="Relire les copies"
                disabled={busy}
                onPress={() => {
                  void run(read);
                }}
              />
              {!copies.length && !busy ? (
                <Text className="text-sm text-muted">
                  Aucune copie connue pour ce compte et ce magasin. Les copies
                  incomplètes ou sans propriétaire vérifiable ne sont pas
                  proposées.
                </Text>
              ) : null}
              {copies.slice(page * 5, page * 5 + 5).map((copy) => (
                <View
                  key={`${copy.kind}/${copy.id}`}
                  className="gap-2 border-t border-line pt-3"
                >
                  <Text className="text-base font-semibold text-ink">
                    {copy.kind === "backup"
                      ? "Copie de sécurité"
                      : copy.kind === "isolated"
                        ? "Copie isolée à vérifier"
                        : "Base précédente conservée"}
                  </Text>
                  <Text className="text-sm text-muted">
                    {new Date(copy.createdAt).toLocaleString("fr-FR")}
                  </Text>
                  <SecondaryButton
                    label="Vérifier cette copie"
                    disabled={busy}
                    onPress={() => {
                      void run(async () => {
                        const value = await prepareLocalCopy(
                          copy,
                          ownerId,
                          storeId,
                          assertCurrent,
                        );
                        assertCurrent();
                        setPrepared(value);
                      });
                    }}
                  />
                </View>
              ))}
              {page > 0 ? (
                <SecondaryButton
                  label="Copies précédentes"
                  disabled={busy}
                  onPress={() => setPage(page - 1)}
                />
              ) : null}
              {(page + 1) * 5 < copies.length ? (
                <SecondaryButton
                  label="Copies suivantes"
                  disabled={busy}
                  onPress={() => setPage(page + 1)}
                />
              ) : null}
            </>
          )}
        </>
      ) : null}
    </SectionCard>
  );
}
