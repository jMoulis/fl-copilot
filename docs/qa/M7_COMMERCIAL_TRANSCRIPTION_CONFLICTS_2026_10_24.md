# M7/M8 — reprise des transcriptions commerciales, 24 octobre 2026

## Diagnostic confirmé

Deux défauts sont reproduits dans le service SQLite réel : adopter le choix synchronisé marquait la commande locale refusée comme ACKNOWLEDGED ; un groupe de plusieurs conflits de cette même transcription restait bloqué. Les essais utilisent les contrats immuables, les transitions Outbox réelles et des bases jetables. Les sources/résultats avant correction sont conservés séparément ; un premier échec de préparation du test a été écarté du diagnostic.

## Politique de transcription conservée

Une transcription acceptée est immuable pour une occurrence précise du PDF. Le parcours propose d’adopter ce choix, après comparaison de l’extrait, des deux intentions et des corrections. Il ne transforme pas une transcription en offre publiée, en applicabilité magasin, en décision commerciale ou en réalisation.

Le lecteur canonique vérifie le groupe OPEN complet, ses enveloppes, la copie synchronisée, l’extrait et les commandes encore actives. Les UUID, magasin, document, page, index source, checksum, champs corrigés et version immuable 1 doivent concorder. Une copie étrangère n’est pas affichée comme choix distant. Une absence inconnue, une contradiction, un envoi actif ou une limite dépassée bloque l’adoption sans recréer ni réécrire le choix accepté.

Le choix reste lié à l’empreinte réellement comparée et au contexte vivant. La transaction marque seulement les commandes examinées comme FAILED / COMMERCIAL_REVIEW_SUPERSEDED, conserve leurs corps, clôt seulement les conflits examinés et rend le choix local SUPERSEDED. Ces paquets ne sont plus comptés comme des erreurs à réparer ; ils n’ont pas reçu de faux acquittement. Une trace locale de comparaison, indépendante de l’identifiant d’envoi, conserve acteur, heure, empreinte et références de la paire/groupe. Elle rend le rejeu exact sans doublon après redémarrage. Les tableaux existants suffisent ; aucune migration ni permission modèle ajoutée.

## Parcours natif et lectures

Synchronisation et le document ouvrent la même revue, avec lien vers l’original et confirmation explicite de comparaison. La page du document évite de répéter les deux choix sous cette revue. La relecture efface le consentement ; fermeture, compte, magasin, rôle, appareil, cible et SQLite invalident les callbacks anciens. Le hook commun de durée de vie est réutilisé, avec les règles propres à cette transcription immuable.

Le parent relit après le choix et après synchronisation, même lorsque la revue enfant disparaît. Les confirmations ordinaires et groupées sont également gardées jusqu’à la dernière insertion Outbox. Une erreur de relecture après commit ne devient pas une prétendue sauvegarde ratée. Les corrections, l’extrait sélectionné et la page restent en place pendant la synchronisation.

La lecture des décisions est limitée au document lorsqu’il est ouvert et regroupe les états de commandes en une seule requête, sans dupliquer un choix à chaque tentative. Les quatre lectures indépendantes du document sont lancées ensemble ; le timer de relecture a été retiré. Ces vérifications SQL ne sont pas des mesures de performance ou de gestes sur téléphone.

## Preuves et livraison

- **28 cas de service**, dont les deux défauts initiaux, groupe, empreinte périmée, source/enveloppe/copie étrangère, limites, contexte et rollback, commandes gardées, diagnostic sans faux échec, trace/rejeu et réouverture de SQLite. Les écritures ordinaires et groupées restent atomiques si l’autorité change après l’insertion Outbox.
- **13 cas de la comparaison montée** : origine et intentions lisibles, double appui, nouvelle comparaison, huit changements de contexte, erreur de lecture et échecs après commit.
- **8 cas de l’écran réel** : sélection et corrections conservées pendant la synchronisation, écriture hors connexion, revue enfant retirée, confirmations anciennes, relecture après commit échouée et confirmation groupée.
- **14 cas antérieurs** du repository conservés : **63 cas ciblés** au total.
- **6 cas Mongo transactionnels réussis localement**, dont un nouveau parcours avec deux vrais conflits, premier choix accepté conservé, restauration sur une troisième SQLite, rejeu distant sans doublon et réouverture du fichier. Aucune offre ni observation métier créée par l’adoption ; aucun transfert de PDF physique sur appareil n’est déduit de cette preuve.

**`pnpm check` passe : 4 107 tests / 676 ignorés selon l’environnement**, lint/structure et dix projets TypeScript. Format/diff vérifiés ; les deux CI du commit final, build API et exports mobiles restent requis avant fusion. La PR 354 est fusionnée après ses deux CI exactes (**4 727 tests / 6 ignorés**), build API et exports mobiles réussis. Les correctifs natifs depuis PR 345 et ce lot restent **hors build 14**, sans EAS payant ni déploiement API propre.

M7 : 1 Actions/conflits en cours ; 2 Contre-promotion code prêt ; 3 Documents, 4 Expertise, 5 Recommandations, 6 Implantation et 7 UX/validation en cours. Les chantiers 1, 3 et 7 avancent ; les autres exceptions de parité, la réception réelle, les originaux sur second appareil et toutes les portes V1/M8 restent ouvertes.
