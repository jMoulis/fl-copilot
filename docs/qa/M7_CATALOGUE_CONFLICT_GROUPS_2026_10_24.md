# M7 — conflits successifs du référentiel, 24 octobre 2026

## Problème reproduit

Plusieurs commandes concurrentes sur la même fiche pouvaient produire plusieurs conflits OPEN. Le chat refusait leur comparaison et renvoyait vers Synchronisation ; le service manuel du référentiel refusait lui aussi ce groupe. Sept premiers tests SQLite échouaient avant correction. Ce n'était pas une raison de rejouer les commandes refusées ni de retenir arbitrairement la dernière date de capture.

## Comportement

Produits, codes et alias utilisent le même service de résolution manuel et conversationnel. Le groupe reste limité au magasin, au type et à l'UUID de l'agrégat. La comparaison montre la version locale actuelle et la version distante capturée au numéro de version le plus élevé ; elle explique que le choix concerne les conflits successifs de cette même fiche. Les anciens payloads ne sont pas des éditions à réexécuter.

Chaque version distante du groupe doit avoir une identité cohérente et un numéro vérifié. Deux payloads différents au même numéro, une identité réaffectée, un payload absent ou une limite de revue dépassée restent bloquants. Un snapshot UPSERT courant, complet et de même identité, fournit la base plus récente après un pull ; le choix exige une nouvelle comparaison. Une suppression plus récente sans payload complet reste bloquée. Le chat exige toujours que son aperçu serveur corresponde exactement à la version distante retenue ; un nouvel aperçu est nécessaire si elle a changé. Aucun protocole, outil modèle, prompt, migration ou service distant n'est ajouté.

Après décision et consentements spécifiques, une seule transaction applique le writer canonique : adoption sans nouvel envoi, ou version locale rebasée avec une nouvelle commande stable et sa précondition distante. Les anciennes commandes restent supersédées, sans faux ACK. Tous les conflits examinés reçoivent la décision dans cette transaction ; payloads locaux/distants et historique restent conservés. Toute modification du groupe après ouverture invalide la comparaison. Une annulation, une perte de droits ou un échec de commit annule l'ensemble.

Les confirmations de suppression, réactivation d'alias et activation produit restent distinctes. Les autres produits, codes/alias, originaux et observations publiées ne sont pas fusionnés ni supprimés par cette décision.

## Preuves et limites

- Tests SQLite sur fichiers : trois types × deux choix × parcours manuel/chat ; fermeture/réouverture, replay conversationnel sans second envoi, conservation de chaque snapshot et des données source.
- Refus : contradiction au même numéro, association étrangère, absence, numéro incohérent, limite dépassée, changement d'un ancien payload, arrivée d'un nouveau conflit, aperçu serveur plus ancien, droits révoqués, annulation tardive et rollback.
- Suppressions locale/distante : consentement séparé toujours requis ; pas de commande de restauration implicite.
- Six scénarios ajoutés à l'intégration Mongo transactionnelle existante : vrai résultat CONFLICT du serveur → conservation SQLite → carte privée → décision → synchronisation canonique → seconde base. Ces scénarios nécessitent l'environnement Mongo de CI ; ils ne sont pas présentés comme exécutés localement sans cet environnement.

La suite ciblée passe **97 tests**, dont un groupe de cent conflits traité sans ancienne ligne OPEN ni renvoi des commandes précédentes. Suite locale : **3 421 passés / 642 ignorés selon l’environnement**, lint/structure et dix projets typés verts. Les deux CI exactes sont nécessaires avant fusion. Les portails de besoin, événements, réglages et décisions commerciales gardent leurs propres politiques ; ce lot n'annonce pas une résolution universelle de conflits multiples, de cibles inconnues ou de toute commande refusée.

## Livraison et recette

Modification native, API compatible déjà livrée ; pas de nouveau déploiement API ni build EAS propre à ce lot. Le build 14 disponible ne contient pas cette correction. Réserver la recette native à la prochaine livraison groupée : comparer un vrai groupe, choisir explicitement, redémarrer puis synchroniser ; vérifier une seule nouvelle commande ou aucune selon le choix, et aucune ancienne ligne OPEN abandonnée. Ne pas fabriquer un conflit dans les données de production pour remplir la recette.

M7 : 1 Actions/conflits en cours ; 2 Contre-promotion code prêt ; 3 Documents, 4 Expertise, 5 Recommandations, 6 Implantation, 7 UX/validation en cours. La V1/M8 complète et les validations physiques restent ouvertes.
