# M8-T03 — conservation des données lors des migrations SQLite

## Périmètre

La suite `apps/mobile/src/db/migration-preservation.test.ts` vérifie les 60 versions du schéma déclarées, avec des bases réellement enregistrées sur disque, fermées puis rouvertes. Elle appelle le moteur `runLocalMigrations` et les dépôts Outbox/produit existants ; aucun moteur, schéma, migration, protocole ou écran de récupération supplémentaire n’est ajouté.

126 scénarios :

- 60 mises à niveau/reprises depuis v1 à v60, dont le démarrage idempotent de la version courante ;
- 59 interruptions avant le premier COMMIT après chaque version historique, vérification du retour à l’ancien schéma et reprise après fermeture ;
- 7 arrêts réels SIGKILL d’un sous-processus Node juste avant COMMIT, après exécution du SQL et mise à jour non validée de la version/métadonnée. Les frontières v1→2, v3→4, v4→5, v12→13, v38→39, v58→59 et v59→60 couvrent renames/copies/suppressions de tables, ALTER multiples, références et nouveaux objets. La réouverture exerce la récupération WAL puis les migrations normales.

## Données et invariants contrôlés

Commandes PENDING, SYNCING, CONFLICT, FAILED et ACKNOWLEDGED : UUID, magasin, appareil, payload JSON, précondition distante, ordre, tentatives, dates et refus restent conservés. La normalisation historique v1 est vérifiée explicitement. Un compteur de séquence déjà supérieur aux lignes existantes n’est pas remis à zéro ; la prochaine commande obtient le numéro suivant sans collision.

L’identité d’appareil ne se régénère pas. Les conflits conservent leurs deux payloads, dont les codes à zéros initiaux, et leur statut ouvert ; les curseurs/révisions existants restent inchangés, hormis la conversion historique v4 prévue vers un curseur absent nécessitant la reprise canonique. Une fiche produit locale en attente est insérée par le dépôt canonique depuis les versions qui la prennent en charge.

Les fichiers capturés avant analyse gardent leur URI, taille, empreinte, état d’envoi/rétention et leurs octets réels sur disque. Les tâches d’envoi gardent leurs UUID, payloads, tentatives et backoff. La reprise explicite d’un envoi interrompu réutilise sa commande avec le marqueur existant SYNC_INTERRUPTED ; les autres magasins, refus et commandes déjà acquittées restent intacts. Un second passage de migration ne change plus ces données. Contrôles SQLite `integrity_check` et `foreign_key_check` inclus.

## Résultats et limites

Premier contrôle ciblé local : 126 tests réussis sous Node 24/SQLite sur macOS, sans modification du moteur de migration. Les résultats globaux et des deux CI exactes sont consignés dans `artifacts/sqlite-upgrade-preservation-2026-10-20/` dans l’espace de travail propriétaire. Les mêmes SIGKILL sont exécutés dans les CI Linux.

Ces fixtures testent les fondations persistées et une fiche produit utile, pas l’ensemble de chaque payload de chaque module. Les suites dédiées aux migrations de tickets, sources, référentiel, plan et illustrations restent complémentaires. Les payloads de diagnostic non exécutés et un original opaque non analysé sont volontairement conservés : leur présence n’autorise aucune publication ni aucun appel distant.

Il ne s’agit pas d’une réparation de fichier corrompu, d’une restauration Mongo/Blob, d’une preuve de livraison exactement une fois au serveur ou d’un arrêt réel d’iOS/Android. Corruption/récupération complète, sauvegarde/restauration de production, autres matrices réseau, recette native, performances, accessibilité et pilote V1 restent ouverts. L’acceptation d’une mise à jour sur appareil avec les données réelles reste nécessaire ; installer sans désinstaller.

## Suivi et livraison

Chantier 7 / L11 progresse sur la preuve automatisée M8-T03. Les sept états M7 restent 1/3/4/5/6/7 en cours, 2 code prêt. Aucun changement du runtime, aucun déploiement API ni EAS payant, aucun fournisseur/appel IA/accès `.env` ou changement système. API courante `ace4c3e` ; iOS build 5 en `1e7684d`. PR 312 fusionnée mais complément natif encore en attente de livraison.
