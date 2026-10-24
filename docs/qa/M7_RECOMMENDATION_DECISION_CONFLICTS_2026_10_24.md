# M7/M8 — conflits de décisions privées, 24 octobre 2026

## Contre-preuve initiale

Six cas échouaient sur SQLite jetable avec les vrais contrats/services : un groupe complet de deux conflits restait impossible à résoudre ; une copie de conflit absente, une copie étrangère, une version d’enveloppe incohérente ou un numéro de cache incohérent pouvaient être ignorés lors du choix ; un retrait du droit après la première écriture n’empêchait pas le commit. Les sources et résultats avant correction sont conservés séparément. Aucun fournisseur ni donnée de production.

## Comparaison canonique

Le service existant `CopilotDecisionRepository.open/save/resolve` conserve l’identité de la piste, son magasin/propriétaire, la conversation source et la provenance de la carte immuable. La revue couvre maintenant le groupe OPEN complet, la copie synchronisée vérifiée, les commandes actives, leur identité et l’empreinte de la source/conversation réellement examinée. Les historiques distants doivent former un préfixe cohérent du dernier historique. Une contradiction, un envoi en cours ou une limite dépassée interdit de décider ; aucune version absente non vérifiée n’autorise une création.

Une copie complète déjà vérifiée permet de reprendre un ancien ERROR même sans ligne OPEN. Le titre du conseil ou la dernière carte ne crée pas un nouveau workflow : l’identité stable de la piste reste inchangée. Les contraintes existantes restent applicables : source inactive, date de report passée et cinquante révisions empêchent un nouveau choix local ; l’adoption de l’historique synchronisé reste possible quand elle est vérifiée.

Conserver le local reprend l’historique canonique courant et lui ajoute exactement une nouvelle décision explicite. Adopter le synchronisé ne crée aucun envoi. Le service ferme exactement le groupe examiné et conserve les anciens paquets avec un état de supersession sans faux ACK. Une capture privée locale distincte retient les deux historiques effectivement comparés, y compris une base plus récente reçue par pull. Son UUID est indépendant du nouvel envoi : un conflit ultérieur reste enregistrable. Aucun historique canonique distant n’est réécrit.

Les contrôles de permission, contexte courant et annulation sont répétés après la revue et avant commit. L’état retourné au formulaire est lu dans la transaction : un échec de cette lecture provoque un rollback complet, plutôt qu’un message d’échec après une écriture déjà réussie. Aucune réalisation en rayon, tâche commerciale ni donnée chiffrée n’est créée par le choix.

## Carte et parcours natifs

Le chat et Synchronisation utilisent le même service et la même comparaison. Le composant réutilise le hook de revue natif, sans nouveau writer ou outil modèle. Aucun choix précoché ; comparaison explicite, message ciblé, relecture et fermeture des callbacks périmés par propriétaire/magasin/rôle/cible/base/appareil/focus.

La carte complète actualise le résultat local après commit puis après l’envoi, même si sa ligne de comparaison a disparu. Les lectures tardives restent bornées au contexte parent. Un échec de lecture après commit ou un réseau indisponible ne devient pas un faux échec de décision. Un formulaire saisi reste présent lors d’un aller-retour sur l’écran et un rafraîchissement de fond préserve son texte. Les résumés de choix/date réutilisent la présentation existante extraite ; source, décision, réalisation et bilan restent distincts.

## Preuves et limites

Les tests de revue couvrent les six défauts initiaux, les deux choix sur un groupe/pull plus récent, les contradictions de préfixe/version, les identités privées, la limite, les reprises ERROR, les sources archivées, les reports et l’historique complet, les refus/annulations après écriture et le rollback du résultat. Un scénario avec fichier conserve une base comparée après ACK, crée un conflit sur une nouvelle commande puis rouvre la même SQLite hors ligne avec les mêmes identités.

La suite commune monte treize pages de comparaison. Cinq tests supplémentaires montent la vraie carte : formulaire conservé à la reprise, nouvelle divergence après envoi, lecture échouant après commit, lecture parent tardive après changement de repository privé et retrait du droit pendant une sauvegarde. Les ports natifs sont simulés ; ce n’est pas une recette physique.

Les deux scénarios Mongo transactionnels existants sont renforcés : deux vrais résultats CONFLICT, nouvelle révision sur l’autre appareil, dernier pull, choix explicite, historique canonique, restauration sur une troisième SQLite et réouverture hors ligne. Le rejeu conserve une seule décision et aucune tâche d’exécution. Ils restent exécutés par la CI ; aucun accès métier de production.

**`pnpm check` passe : 3 900 tests / 668 ignorés selon l’environnement**, lint/structure et dix projets strictement typés. Les quatre suites concernées comprennent **219 cas** : 25 revues métier, 179 montages communs de treize pages, 10 tests antérieurs du repository et 5 cartes complètes. Format/diff passent. Les deux CI du commit final, build API et exports iOS/Android restent nécessaires avant fusion. PR 351 fusionnée après deux contrôles exacts verts (**4 520 tests / 6 ignorés**, build API et exports iOS/Android). PR 345–351 et ce complément restent hors build 14 et attendent une livraison native groupée. API compatible inchangée ; aucun build EAS payant ni déploiement pour ce lot.

M7 : 1 Actions/conflits en cours ; 2 Contre-promotion code prêt ; 3 Documents, 4 Expertise, 5 Recommandations, 6 Implantation et 7 UX/validation en cours. La parité globale, les boucles métier réelles, la recette physique et les autres portes V1/M8 restent ouvertes.
