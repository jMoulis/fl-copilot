# M7/M8 — comparaison de la mémoire privée, 24 octobre 2026

## Défauts reproduits

Cinq attentes de refus échouaient sur SQLite jetable avant correction : conserver/adopter une pratique sur une comparaison ancienne après un autre conflit ou un pull plus récent, puis conserver le local sans version distante vérifiée. Le service pouvait ignorer un conflit plus récent, consommer une nouvelle copie sans nouvelle comparaison ou repartir en version 1. Les sources exactes et résultats de cette contre-preuve sont conservés séparément ; aucune donnée de production n’a été modifiée.

## Politique de mémoire

`CopilotKnowledgeRepository` expose une revue privée et son writer existant la recontrôle dans la transaction : compte/magasin/UUID, identité et provenance immuables, copie locale actuelle, groupe OPEN complet, dernière copie synchronisée vérifiée disponible, commandes et empreinte exacte. Un changement de comparaison, une identité étrangère, une commande incohérente, un envoi actif ou une limite dépassée bloque les choix. L’annulation et le contexte sont vérifiés avant/après la lecture et avant commit.

Une copie complète déjà vérifiée reste comparable lorsqu’un ancien état CONFLICT/ERROR n’a plus de ligne OPEN. Il ne s’agit pas d’une preuve de fraîcheur réseau : la précondition distante reste appliquée à l’envoi. Une absence non vérifiée ne donne jamais le droit de recréer, de réinitialiser la version ou de renvoyer aveuglément une création rejetée. L’ancien contenu et les commandes restent conservés pour reprise.

La mémoire conserve le contrat **USER_STORE**, privé au compte et au magasin et partagé entre les conversations de ce compte. Aucun droit d’un autre employé ni nouvelle capacité modèle. Les pratiques sont des indications confirmées par l’utilisateur ; elles ne deviennent ni chiffres officiels ni instructions système. La provenance d’une pratique déjà confirmée reste immuable et la disparition de son message source ne bloque pas son édition, comme dans le contrat existant. Créer une nouvelle pratique liée à un message exige toujours la provenance autorisée.

Les états ACTIVE/FORGOTTEN restent explicites ; le texte canonique d’une pratique oubliée devient `Oublié`. Réutiliser une pratique oubliée demande un consentement séparé sur la version choisie. Une relecture/erreur/nouvelle comparaison invalide ce consentement. Le message d’origine et les actions historiques ne sont pas réécrits.

## Conservation et synchronisation

Le choix résout exactement les conflits examinés, retire les anciennes commandes sans faux ACK et crée au plus un nouvel envoi stable, avec la précondition distante exacte. L’adoption d’une version vérifiée ne crée aucun envoi de connaissance.

La paire effectivement comparée est conservée localement dans `sync_conflicts`, avec le type distinct `COPILOT_KNOWLEDGE_REVIEW_CAPTURE`, immédiatement résolu et sans commande source. C’est une trace du choix local réel, **pas un conflit serveur fabriqué** ni une nouvelle entité synchronisée. Son identifiant est distinct de celui de l’éventuelle commande de résolution : un conflit ultérieur de cette commande reste enregistrable et visible. Cette trace privée conserve aussi une base reçue par pull avant qu’un ACK remplace le cache. Elle n’est pas envoyée au modèle ni à la collection distante de connaissances ; le contrat distant et son historique de métadonnées restent inchangés. Aucune migration requise.

## Écran et durée de vie

Le composant de comparaison réutilise le hook natif déjà testé, sans writer ni permission génériques. Il montre les deux pratiques/états/versions, la provenance déclarée, les refus et une relecture. Aucun choix ou consentement n’est précoché. Compte, magasin, rôle, cible, appareil, SQLite et focus bornent les opérations tardives ; double appui et callbacks anciens ne créent pas de seconde action.

L’écran de mémoire actualise la liste depuis SQLite après commit, puis après synchronisation. La durée de vie de cette lecture appartient à l’écran parent : elle reste possible quand la ligne de comparaison a disparu, mais pas après changement de compte/base ou sortie de l’écran. Un nouveau conflit reçu pendant l’envoi réapparaît donc dans la liste. Ni un échec de rafraîchissement ni un échec d’envoi ne transforme un commit local réussi en échec d’enregistrement. Aucun polling ni attente réseau pour afficher le résultat local.

## Preuves et limites

- Les quatre suites concernées comprennent **189 cas**, tous verts dans la suite complète : **30** cas métier de revue, **149** montages communs de onze pages, **5** tests de l’écran complet de mémoire et **5** frontières antérieures du repository.
- SQLite réel, cache/groupe plus récent, cent conflits, absence non vérifiée, provenance/compte incohérents, consentement d’oubli, ancien reset récupérable après comparaison vérifiée, annulation/rollback, fermeture, rôle/cible/base/appareil, double appui, redémarrage et refus de répétition. Le cas d’un conflit ultérieur sur la commande de résolution vérifie l’indépendance de la trace.
- L’écran complet est monté avec les vrais services SQLite et des ports natifs simulés : enregistrement local immédiat, nouveau conflit après disparition de la première comparaison, lectures tardives après changement de base/compte/focus et lecture échouant après commit. Ces preuves ne sont pas une recette sur téléphone.
- Deux scénarios supplémentaires utilisent le Mongo transactionnel de CI : vraie divergence et deux conflits serveur → choix local → synchronisation canonique → restauration sur une autre SQLite, sans doublon d’historique au rejeu. Les permissions privées et l’exclusion des pratiques oubliées gardent aussi leur scénario antérieur. Aucun fournisseur IA réel ni écriture métier de production.
- **`pnpm check` passe : 3 809 tests / 664 ignorés selon l’environnement**, lint/structure et dix projets strictement typés. Format/diff, contrôles push et PR du commit final, build API et exports natifs restent requis avant fusion.

La PR 349 est fusionnée après ses deux CI exactes vertes (**4 403 tests / 6 ignorés**, build API et exports iOS/Android). PR 345–349 et ce complément restent hors build 14, en attente d’une prochaine livraison native groupée. API compatible inchangée ; aucun déploiement ni build EAS payant pour ce lot. L’installation/recette physique iOS/Android et le périmètre V1/M8 complet restent ouverts.

M7 : 1 Actions/conflits en cours ; 2 Contre-promotion code prêt ; 3 Documents, 4 Expertise, 5 Recommandations, 6 Implantation et 7 UX/validation en cours. Cette fermeture du parcours mémoire ne prouve pas une parité CRUD globale ni la clôture des autres portes.
