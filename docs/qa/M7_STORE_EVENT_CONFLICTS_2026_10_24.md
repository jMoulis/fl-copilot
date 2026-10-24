# M7/M8 — conflits des observations terrain, 24 octobre 2026

## Défauts reproduits

Quatre cas sur SQLite jetable permettaient de confirmer une ancienne comparaison : deux choix (garder la fin locale / adopter le distant), chacun face à un autre conflit v3 ou à un pull v3 déjà présent. Le service utilisait encore la capture v2 puis fermait tout le groupe. Les quatre attentes de refus échouaient avant correction. Aucune donnée de production n'a été modifiée.

## Règles conservées et comparaison commune

`StoreProductEventRepository` fournit maintenant la revue canonique aux écrans manuel et conversationnel. Elle porte sur le même magasin/UUID et les dernières versions complètes vérifiées, sans retenir arbitrairement la dernière date de capture d'un conflit. Les vérifications de versions en lecture seule sont réutilisées ; le domaine garde son schéma, ses règles d'identité/capture et le writer existant de clôture.

Toutes les captures distantes d'un groupe et son cache vérifié doivent désigner le même épisode initial. Une contradiction au même numéro, une réaffectation, un payload absent, un envoi actif ou une limite dépassée bloque le choix. Le chat exige encore que son aperçu serveur corresponde exactement à la base retenue. Un autre conflit/pull ou une modification des données/commandes après lecture invalide la confirmation par empreinte.

Garder le local ne confirme que la fin d'une observation USER déjà clôturée et de capture identique. Produit, type, début, gravité, commentaire, capture et provenance ne deviennent pas éditables. Si les fins sont déjà égales, aucune nouvelle clôture n'est envoyée. L'adoption reste explicite et conserve le domaine/source : une tension COMMERCIAL_PDF/TO_REVIEW ne devient pas une rupture physique ni une nouvelle clôture USER. Une capture locale incorrecte ne peut pas être renvoyée ; seule l'adoption de sa base distante vérifiée est proposée.

La transaction recontrôle comparaison, contexte et annulation, conserve snapshots/commandes/historique et résout exactement le groupe examiné. Au plus une nouvelle commande stable `CLOSE_STORE_EVENT`, avec précondition distante exacte, est créée. Une base distante reçue seulement par pull reste dans l'historique avant qu'un ACK ultérieur remplace le cache. Aucun faux ACK, réécriture d'observation commerciale, unité, original ou chiffre officiel.

## Page lisible et durée de vie

Les deux versions indiquent le produit via une lecture locale limitée au magasin ; une référence inconnue reste déclarée indisponible localement. Aucun libellé d'un autre magasin n'est recherché. La comparaison exige un choix et un consentement explicites ; une erreur donne une reprise ciblée sans vider le contenu encore lisible.

La gestion React des lectures/confirmations et des changements de contexte est extraite de la page Réglages déjà testée, puis réutilisée par les deux pages. Elle ne possède aucune règle métier, permission ni writer générique. Double appui, anciennes lectures/callbacks, compte/magasin/cible/appareil/SQLite/focus/démontage restent bornés au contexte courant. Une synchronisation échouant après le commit local ne transforme pas celui-ci en échec d'enregistrement. Aucun polling ni nouvelle dépendance.

## Preuves

- **81 tests ciblés** passent sur les quatre suites concernées : revues métier et anciennes frontières du contrôleur, fichiers SQLite/restart/replay, deux choix dans les deux parcours, groupe de cent conflits, captures immuables, aperçu obsolète, conflits/pulls plus récents, payloads/versions incohérents, provenance PDF, absence de fin, confidentialité des libellés, refus et rollback/annulation.
- La suite de page commune monte les **deux pages réelles dans 22 cas**, avec le vrai writer SQLite et des ports natifs simulés : garde-fous antérieurs des réglages conservés, événement terrain, double appui, erreur ciblée/relecture, contexte tardif, ancien callback après remplacement SQLite et sync échouant après commit. Le déplacement de la suite évite de dupliquer les tests et la gestion d'écran.
- Deux cas ajoutés à la suite Mongo transactionnelle existante couvrent un vrai CONFLICT serveur sur événement → carte privée → décision → sync canonique → seconde SQLite. Cette preuve dépend de l'environnement Mongo de CI ; aucun fournisseur IA réel n'est appelé.
- La suite locale complète passe **3 493 tests / 646 ignorés selon l’environnement**, avec dix projets typés et lint/structure verts. Les deux CI exactes, build API et exports natifs doivent réussir avant fusion. Les ports simulés ne constituent pas une recette sur téléphone.

## Livraison et limites

PR 346 est fusionnée après ses deux CI exactes ; elle et PR 345 restent hors build 14. Ce complément attend la même future livraison native groupée ; API compatible inchangée, pas de déploiement ni de build EAS propre à cette PR. Recette réelle : comparer un vrai signalement conflictuel, relire après changement, confirmer sa fin/adopter explicitement, redémarrer et synchroniser sans dupliquer l'épisode. Ne pas fabriquer un conflit de production pour la recette.

Les autres domaines gardent leurs politiques propres ; aucune résolution universelle ni nouveau tool/prompt modèle. M7 : 1 Actions/conflits en cours ; 2 Contre-promotion code prêt ; 3 Documents, 4 Expertise, 5 Recommandations, 6 Implantation, 7 UX/validation en cours. La parité restante et toutes les portes V1/M8, dont l'acceptation physique iOS/Android, restent ouvertes.
