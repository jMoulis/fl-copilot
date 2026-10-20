# M8-T04 — isolation d’une base locale endommagée

Chantier 7 en cours, périmètre V1 inchangé. Ce lot rend utilisable une reprise de démarrage après corruption SQLite avérée. Il ne déclare pas toutes les données locales récupérées.

## Parcours

- Le démarrage différencie corruption SQLite (`CORRUPT` / `NOTADB`) et indisponibilité : verrouillage, disque plein, erreur IO, migration ou schéma incompatible n’autorisent pas de nouvelle base.
- Un en-tête invalide est détecté avant ouverture. Pour une corruption signalée après ouverture, une copie privée du DB/WAL/SHM existant, avec tailles et SHA-256 vérifiés, précède la fermeture SQLite : celle-ci peut supprimer les journaux. Si la conservation échoue, le handle reste retenu et la reprise est bloquée ; le réessai termine cette conservation/fermeture avant toute nouvelle ouverture.
- « Préparer une reprise sécurisée » expose les conséquences, puis demande une confirmation séparée. Annuler ne change pas la base active. La copie de diagnostic reste conservée ; aucune action ni aucun fichier source n’est supprimé.
- Avant effacement des identifiants de connexion, SecureStore conserve uniquement le propriétaire et les magasins précédents, associés à la nouvelle génération ; aucun jeton, email ou nom n’est copié. Une autorité absente ou illisible reste inconnue. Ce contexte permet une future vérification propriétaire, sans accorder une permission de replay.
- Une nouvelle génération dans un répertoire privé distinct est migrée et fermée avant activation. La session locale est effacée pour exiger une reconnexion associée à la nouvelle identité d’appareil ; aucun appel de révocation, email, upload ou IA n’est lancé par cette opération.
- Un pointeur versionné dans SecureStore sélectionne la génération active ; son marqueur d’installation évite de réutiliser une ancienne route Keychain après désinstallation. Un pointeur/manifeste invalide, une génération manquante ou une conservation incomplète échoue sans revenir silencieusement à une ancienne copie.
- Après reconnexion, la synchronisation canonique retrouve les données distantes. Les captures et commandes non envoyées restent dans l’ancienne copie et ne sont pas rejouées arbitrairement. Un rappel persistant dans Synchronisation précise qu’elles ne figurent pas dans les compteurs de la nouvelle base.

Aucun contrat métier/Outbox, migration, outil IA ou protocole distant ne change. La mise à l’écart est une isolation par sélection de répertoire : l’ancienne base et ses fichiers ne sont pas renommés ou effacés. Les snapshots bruts vérifiés restent distincts et ne sont jamais ouverts directement comme base opérationnelle. Aucune archive privée n’est exposée par partage/export utilisateur.

## Vérifications

- Tests des codes SQLite/chaînes de causes, double confirmation, réessai concurrent, étapes interrompues, fermeture/authentification/pointeur et réouverture.
- Vrai moteur SQLite : fichier effectivement illisible, migration d’une nouvelle base, nouvelle identité stable, fermeture/redémarrage puis application du bootstrap canonique ; ancien fichier et photo inchangés, aucun nouvel Outbox implicite.
- Adaptateur natif réel exercé avec système de fichiers Node et ports Expo/SecureStore simulés : triplet et empreintes, snapshot incomplet, conservation avant fermeture, perte d’accusé de pointeur, cible/manifeste modifiés, traversée de chemins, Keychain conservé avec nouveau conteneur et démarrage client complet.
- Composant réel `DatabaseStartupScreen` revu dans un harnais web temporaire à 390 × 844 et 320 × 568 : consentement, annulation sans confirmation, boutons désactivés pendant la reprise, explication finale et absence de remplacement pour un verrouillage. Les callbacks de reprise/authentification y sont simulés. Le harnais, le serveur et l’onglet sont supprimés/fermés après recette ; preuves dans `artifacts/local-database-recovery-2026-10-20` du dossier de travail partagé.

## Portes encore ouvertes

L’extraction sûre des métadonnées encore lisibles de l’ancienne copie, la restitution des modifications non envoyées et le ré-enregistrement des fichiers récupérables pour le même propriétaire restent à implémenter/valider. Ne pas ouvrir une ancienne copie opérationnelle pour un autre compte, réimporter un original par son seul nom ou envoyer des commandes dont l’accusé est inconnu. Les snapshots conservés ne constituent pas une réparation automatique SQLite ni une sauvegarde distante.

La fermeture réellement interrompue par iOS/Android, la disponibilité/protection native SecureStore et des fichiers, le coût sur une grosse base et la restauration Mongo/Blob restent à exercer. Un disque sans espace ne permet pas de certifier une copie : conserver l’état et réessayer, sans réinitialisation forcée. La recette native, le build groupé et la clôture M8-T04/V1 restent ouverts. Aucun build EAS, déploiement API, accès `.env` ou appel fournisseur n’est déclenché par cette QA.
