# M7/M8 — réception et contexte des conflits du référentiel, 24 octobre 2026

## Défauts reproduits

Neuf scénarios montés écrivaient encore après un changement de compte, de magasin actif ou d’appareil : trois familles, produit/code/alias, pour chacun de ces changements. La lecture était volontairement suspendue avant décision dans le service réel ; les snapshots SQLite changeaient au lieu de rester intacts. Les schémas et fixtures étaient valides.

Trois autres tests traversent `MobileSyncService.push` sans préparer artificiellement l’état de la fiche. Le refus était bien enregistré dans l’Outbox et les conflits, mais la fiche produit/code/alias restait PENDING. La revue canonique exigeant CONFLICT, ce parcours réel restait bloqué. Les anciennes preuves de controller/repository, qui préparaient cet état, ne vérifiaient pas cette transition du service mobile.

## Correction et réutilisation

La réception du refus marque maintenant la fiche concernée CONFLICT dans la même transaction que le résultat et son conflit, avec les trois tables explicitement autorisées. Aucun champ métier, version, quantité ou dirty flag n’est remplacé. Un résultat qui ne correspond pas à sa commande annule aussi cette projection d’état.

L’écran conserve la comparaison et les politiques existantes du référentiel, en réutilisant le hook de durée de vie déjà commun aux autres domaines. Compte, magasin actif, rôle responsable, appareil, connexion SQLite, cible, focus et fermeture bornent la décision et l’annulation jusqu’au commit. La sélection et les consentements sont liés à l’empreinte lue. Choisir un autre côté ou relire efface les consentements. Une erreur de relecture conserve le contenu mais interdit de confirmer l’ancienne vue.

Suppression locale à maintenir ou annuler, suppression distante, activation produit et réactivation d’alias restent des décisions séparées. Adopter une suppression conserve sa trace logique ; cela n’impose pas la disparition physique immédiate de la ligne SQLite. Confiance synchronisée, identité de produit/code/alias, historique et sources restent conservés.

Le writer et le bouton anciens `retryWasteAliasDeletion` sont retirés. Une annulation de libellé issu d’un ticket de casse passe désormais par **la même revue canonique**, avec son consentement de suppression, une commande stable si nécessaire et l’historique existant. Aucun writer parallèle, nouvelle couche métier, protocole, migration, permission modèle ou règle d’activation automatique n’est ajouté. Un échec d’envoi après commit ne devient pas un faux échec local.

## Preuves

- **37 tests montés de l’écran réel** : les neuf refus manquants, les autres changements de contexte, les deux choix pour chaque famille, double appui, nouvelle copie reçue, consentements séparés/effacés, erreur de relecture, ancien callback et réseau indisponible après commit. Les suppressions d’alias WASTE_RECEIPT utilisent le même parcours.
- **4 tests du service de push réel sur SQLite**, dont les trois projections manquantes et leur rollback sur une enveloppe non rattachable à la commande. Seul le transport est contrôlé dans ces quatre tests.
- **27 cas antérieurs** du repository de casse conservés. L’ancien test de reprise utilise maintenant le service canonique : identité étrangère refusée, consentement obligatoire, échec d’insertion et rollback, nouvelle commande et histoire gardée. **68 cas ciblés** au total.
- **8 parcours Mongo transactionnels réussis localement** : trois familles × deux choix, plus maintien/annulation d’une suppression de libellé de casse. La commande initiale passe par le vrai push mobile, son conflit devient consultable sans forcer l’état, puis le choix est envoyé et restauré dans une troisième SQLite, refermée/réouverte. Les dates comparées sont celles réellement retournées par le serveur, qui possède leur normalisation. Les sources, lignes de ticket et observations du premier appareil restent identiques.

**`pnpm check` passe : 4 148 tests / 684 ignorés selon l’environnement**, lint/structure et dix projets TypeScript ; types revérifiés après ajustement des assertions de dates canoniques. Format/diff et les deux CI du commit final, build API et exports mobiles restent requis avant fusion. Ces preuves ne sont pas une recette sur téléphone, un transfert de fichier original ou une nouvelle évaluation IA.

La PR 355 est fusionnée après ses deux CI exactes (**4 777 tests / 6 ignorés**), build API et exports mobiles réussis. Ce complément et les correctifs depuis PR 345 restent **hors build 14**, sans EAS payant ni déploiement API propre.

M7 : 1 Actions/conflits en cours ; 2 Contre-promotion code prêt ; 3 Documents, 4 Expertise, 5 Recommandations, 6 Implantation et 7 UX/validation en cours. Les chantiers 1 et 7 avancent ; les exceptions restantes et toutes les portes V1/M8 restent ouvertes.
