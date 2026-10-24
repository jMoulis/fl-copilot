# M7/M8 — métadonnées et suppressions des conversations, 24 octobre 2026

## Défauts reproduits

Huit contre-exemples avant correction sur SQLite jetable : quatre décisions prises sur une comparaison dépassée par un autre conflit ou un pull ; deux suppressions distantes invisibles dans le parent local tant qu’une modification restait en attente ; deux suppressions locales annulées par l’adoption des métadonnées distantes. Les sources et résultats initiaux sont conservés séparément. Aucun message ni chiffre de production n’a été modifié.

## Politique et service canonique

Le titre et l’archivage sont des métadonnées comparables. Les suppressions logiques connues sont monotones : le choix d’un titre ne réaffiche ni la conversation supprimée, ni un message supprimé, ni ses réponses/cartes privées. La date de suppression déjà canonique reste exacte, conformément au serveur. Les identifiants supprimés sont réunis sans tronquer la liste ; une union dépassant le contrat existant de 500 est refusée, avec conservation des copies. Aucune suppression physique ni suppression globale de remplacement.

La projection d’un pull conserve les métadonnées locales en attente tout en rendant immédiatement les suppressions connues effectives dans `payload_json`. Les lecteurs du chat et des actions utilisent donc le même parent privé. Le cache distant reste la copie exacte reçue ; les messages immuables, références aux originaux, brouillons et commandes en attente ne sont pas réécrits par cette projection. Les questions supprimées ne sont plus proposées à la livraison IA ; leurs identités locales restent conservées. Une incohérence dans un ACK conserve la suppression et rend la copie examinable en ERROR au lieu de la considérer synchronisée.

`CopilotConversationRepository.review/resolve` vérifie le compte/magasin, l’identité immuable, le groupe OPEN complet, le cache distant vérifié, les commandes et l’empreinte effectivement comparée. Les contrôles de contexte et d’annulation sont répétés dans la transaction et avant commit. Un envoi actif, une copie étrangère/incomplète, une empreinte changée ou une limite dépassée bloque les deux choix. Une copie distante complète déjà vérifiée permet aussi de reprendre un ancien ERROR sans ligne OPEN ; l’absence inconnue ne donne jamais le droit de recréer une conversation.

Le choix retire les anciens envois sans faux ACK, résout exactement les conflits examinés et conserve la paire comparée sous un type de capture locale distinct. Cette capture n’est pas un conflit serveur fabriqué et son identifiant est indépendant de celui du nouvel envoi. Le prochain conflit de cet envoi reste enregistrable. Un seul UPSERT est produit si les métadonnées choisies et les suppressions réunies diffèrent de la copie canonique, avec sa version exacte en précondition. **Adopter les métadonnées synchronisées peut donc laisser des suppressions locales à envoyer** ; l’écran le précise. Aucun envoi si les contenus sont déjà équivalents.

Les fichiers originaux, la mémoire explicitement confirmée, les décisions et les déclarations de réalisation restent indépendants de la suppression d’un fil. Aucun nouvel outil, permission modèle, contrat de transport ou migration. La politique distante de suppression reste inchangée.

## Parcours natif

La comparaison est accessible dans Synchronisation pour un conflit privé et dans le menu du chat pour les états CONFLICT/ERROR, y compris une conversation logiquement supprimée. Elle montre titre, état, version et nombre de suppressions sans afficher le contenu supprimé. Aucun choix précoché. Relecture, contexte propriétaire/magasin/rôle/appareil/base/cible, focus, fermeture, callbacks anciens et double appui réutilisent le hook natif existant. Le choix est local et la synchronisation reste indépendante ; un réseau indisponible ne transforme pas le commit en échec.

## Vérification et livraison

Les tests couvrent la comparaison dépassée, les deux choix de métadonnées et les deux types de suppression, la conservation des messages/pièces jointes/commandes, le cache ERROR, les propriétaires étrangers, les limites, l’annulation après écriture, le rollback et le redémarrage hors ligne. Le montage commun inclut désormais douze pages ; quatre cas spécifiques vérifient les suppressions sur l’écran réel. Les ports natifs restent simulés : ces tests ne prouvent pas une recette sur iPhone.

Quatre scénarios Mongo transactionnels de CI exercent une divergence réelle, une nouvelle suppression sur l’autre appareil, la revue de la dernière base, les deux décisions, la synchronisation, l’idempotence et la restauration sur une troisième SQLite, puis sa réouverture hors ligne. Ils vérifient aussi l’isolation d’un autre compte. Aucun fournisseur IA ni écriture métier de production.

Les quatre suites ciblées comprennent **222 cas** : 30 cas de revue et livraison, 166 montages communs des douze pages, 20 tests antérieurs du repository et 6 contrats partagés. **`pnpm check` passe : 3 858 tests / 668 ignorés selon l’environnement**, lint/structure et dix projets TypeScript. Format/diff passent. Les deux CI du commit final, build API et exports iOS/Android restent requis avant fusion. La PR 350 est fusionnée avec deux CI exactes vertes : **4 467 tests / 6 ignorés**, build API et exports iOS/Android. Ce complément et les PR 345–350 restent hors build 14, à regrouper dans une prochaine livraison native. Aucun build EAS payant ni déploiement API pour ce lot.

M7 : 1 Actions/conflits en cours ; 2 Contre-promotion code prêt ; 3 Documents, 4 Expertise, 5 Recommandations, 6 Implantation et 7 UX/validation en cours. Ni la parité CRUD globale, ni la recette physique, ni les autres portes V1/M8 ne sont déclarées achevées.
