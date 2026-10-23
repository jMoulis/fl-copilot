# M8 — durée de vie des rappels locaux

## Défauts reproduits

Le fournisseur React des rappels pouvait finir la lecture d’une notification de démarrage après fermeture ou changement de magasin, puis installer un listener que son nettoyage avait déjà manqué. Un changement de propriétaire dans le même magasin n’invalidait pas ce travail. Une ancienne erreur de lecture pouvait aussi apparaître dans le contexte suivant avec un message accusant à tort le build. Le gestionnaire d’affichage au premier plan acceptait les notifications sans vérifier leur magasin ni la validité de leur contenu.

Neuf scénarios du vrai fournisseur monté échouent **sept fois sur la version précédente**, les deux autres passant. Un scénario complémentaire a ensuite reproduit une ancienne bannière encore autorisée entre le commit du nouveau compte et le nettoyage passif : l’invalidation au commit ferme aussi cette fenêtre. Les lectures SQLite, le module OS et les événements sont des ports contrôlés : aucune notification réelle ni requête distante n’est envoyée.

## Correction

Le contexte de travail identifie magasin, propriétaire, état de session et base locale. Sa fermeture ou son remplacement l’invalide dès le commit React, avant le nettoyage passif des listeners ; les anciens travaux en attente n’entrent plus dans l’adaptateur natif et ne mettent plus à jour les statuts du nouveau contexte. Les erreurs sont traitées dans le travail concerné de la file coalescée existante, sans attribuer l’erreur d’un ancien travail au suivant.

Après la lecture de la notification initiale, le fournisseur recontrôle son contexte avant d’installer le listener. Une erreur de lecture courante reste réessayable et n’empêche pas d’écouter les notifications suivantes. Les anciens callbacks ne naviguent plus ; l’affichage et le son au premier plan nécessitent un rappel connu et le magasin authentifié courant. Une déconnexion rend l’ancien gestionnaire silencieux.

L’ouverture garde sa lecture locale et la destination d’opération existantes. La synchronisation se fait ensuite en arrière-plan ; un rejet inattendu est contenu et qualifié sans annuler la navigation locale. Aucune demande de permission, nouvelle notification, modification d’une opération, commande Outbox, migration, dépendance ou instruction IA n’est ajoutée.

## Preuves et limites

- **12 tests du fournisseur réel monté** : fermeture pendant la lecture initiale, changement de magasin/propriétaire, erreurs tardives, payload étranger/incomplet/nul, déconnexion, navigation locale, erreur de synchronisation et arrivée tardive de l’adaptateur natif.
- **200 remplacements de contexte** : un listener de réponse, un abonnement AppState, un abonnement rappels et un abonnement Outbox à chaque étape ; zéro après démontage. Ce compte ne mesure ni les FPS ni le pont natif.
- **6 tests existants** de réconciliation et dépôt, dont SQLite réel : permission refusée, ancien binaire, absence de doublon au redémarrage, changement de plan et reprise d’un enregistrement OS.
- Contrôles locaux complets : **3 367 tests passés / 636 cas dépendants d’environnement ignorés**, structure, lint et dix projets TypeScript verts. Formatage et deux CI du commit final requis avant fusion ; résultats exacts dans la PR et les preuves privées de livraison.

Le module OS, les permissions, les bannières et le déclenchement en arrière-plan/hors connexion sur iPhone et Android restent à accepter sur matériel. Ce lot sécurise les rappels locaux existants ; il n’active pas de push serveur ni de nouveau fournisseur. Il ne clôt aucun chantier M7 ni M8/V1. Livraison native groupée après le build 13 ; aucun nouveau build EAS payant ni déploiement API propre à ce lot.
