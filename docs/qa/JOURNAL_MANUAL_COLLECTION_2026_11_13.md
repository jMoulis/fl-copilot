# Collecte du Journal à la demande — 13 novembre 2026

Le propriétaire demande de pouvoir enregistrer le contexte sans attendre les horaires automatiques. Les réglages transport restent sauvegardés par le parcours canonique existant ; le nouveau bouton ne remplace pas cette synchronisation.

## Comportement

- « Actualiser maintenant » est visible dans le Journal et le volet transports. Les autres boutons explicites et le geste d’actualisation du Journal lancent la même collecte.
- POST `/api/v1/store/context?weekStart=…` exige l’authentification et l’autorisation du magasin avant la collecte. Les capacités optionnelles conservent leurs significations. GET reste une lecture et n’appelle jamais cette collecte.
- Le service réutilise `collectDailyJournal`, les lecteurs publics, les caches et leurs baux, les révisions immuables et l’entrée quotidienne existante. Les horaires Inngest restent inchangés. Aucune IA, collection, migration ou commande métier supplémentaire.
- La collecte concerne le jour parisien réel et les projections de la semaine précédente, courante et suivante. La réponse relit l’archive pour la semaine affichée ; une date passée sans archive ne déclenche pas de reconstruction à partir de sources actuelles.
- Les TTL fournisseur restent respectés : actualiser ne promet pas une nouvelle publication ou des perturbations inexistantes. Les bonnes valeurs anciennes restent qualifiées en cas de panne.
- Le client conserve son contenu local pendant le traitement et en cas d’échec ; dédoublonnage des pressions et contrôle magasin/semaine/réglages avant écriture SQLite. Les tentatives automatiques à l’ouverture restent des lectures GET ; pas de POST silencieux ou de relance en boucle. Délai réseau borné à deux minutes pour la collecte explicite.

## Livraison et recette

API compatible avant la prochaine livraison native. Aucun retour utilisateur du build 56 ne valide ce nouveau bouton, absent de cette version. Vérifier sur la version livrée : après synchronisation d’une sélection de transports, appuyer une fois ; retrouver les dates réelles du relevé et le contexte côté Copilote sans recherche web. Si le fournisseur est indisponible, conserver les sources précédentes et signaler leur état. Aucune donnée fictive de magasin ou facturation IA n’est nécessaire pour ces tests.

## Vérifications effectuées

27 tests ciblés réussis, dont les intégrations Mongo isolées avec le vrai service
de collecte et le lecteur quotidien, les droits de la route, la négociation
GET/POST, la conservation du cache local et le dédoublonnage. TypeScript et lint
réussis. Les fournisseurs sont simulés dans cette vérification ; aucun appel
réel PRIM ni acceptation iPhone n’en est déduit.
