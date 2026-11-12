# Lot navigation du 12 novembre 2026

## Arbitrage propriétaire

Un seul lot reprend les maquettes approuvées : quatre onglets Journal, Analyses, Copilote, Imports ; raccourcis Produits/Réglages ; Ma semaine séparée de la réception et de la configuration. Le journal contextualisé automatique, les graphiques de liste et la génération d’images restent des sujets distincts.

## Implémentation

Les produits et leurs formulaires sont des pages poussées dans la pile racine, au-dessus de l’écran d’origine. Sauvegarder ou annuler retrouve le détail précédent ; revenir retrouve les analyses ou le catalogue. La sélection analytique et les états locaux de recherche/position sont conservés. Les filtres et informations transitoires gardent les panneaux existants.

Imports utilise les parcours Mercalys, casse, documents commerciaux, email et synchronisation existants. Ma semaine réutilise le suivi commercial et sa semaine mémorisée/explicitement demandée. Réception email et configuration des expéditeurs partagent le même service avec deux vues. Aucun changement des contrats, des sources, des calculs, des écritures métier, des modèles IA ou de leurs instructions.

Les anciens chemins sont conservés pour compatibilité. Les liens actuels, notifications de documents et accès aux conflits utilisent les pages racines. Une notification de document introuvable revient dans Imports. Les notifications de chat conservent leur destination Copilote.

## Vérifications réalisées

- 106 tests ciblés passent dans 12 suites, sans ignorés : navigation, état analytique, notifications, réception/configuration email, documents, préparation et retours produit.
- Le stress existant conserve ses modifications hors ligne et exerce aussi 500 parcours avec le StackRouter de la version Expo installée : analyses, imports, copilote et catalogue → détail → édition → détail → origine. Les clés et paramètres des écrans précédents sont conservés.
- Vérification complète locale : structure, lint, TypeScript, 496 suites réussies / 5132 tests réussis. Les 87 suites / 860 tests d’intégration conditionnels sans MongoDB de test restent ignorés ; aucune validation cloud n’est déduite de cette exécution.
- Export Metro iOS et Android réussi ; aucun changement Android spécifique.
- Expo Go, iPhone 17 Pro iOS 26.3, serveur local explicitement relié à l’API de production : rendu Journal, Imports et Réglages observé par captures natives. Aucun import, envoi IA ou changement métier n’est réalisé pour cette vérification.
- Les captures prouvent le rendu, pas une recette tactile iPhone ni le comportement des notifications en binaire TestFlight.

## Recette iPhone après livraison

1. Vérifier les quatre onglets et les raccourcis Produits/Réglages ; quitter Réglages et retrouver l’onglet initial.
2. Dans Analyses, choisir une période et un filtre, descendre dans la liste, ouvrir un produit, modifier puis enregistrer. Revenir : même analyse et même position. Refaire avec annulation d’une saisie non enregistrée.
3. Depuis Produits, rechercher une référence, ouvrir/revenir : recherche et position conservées.
4. Dans Imports, retrouver un ancien Mercalys, un ticket, un PDF et un email. Ouvrir la configuration email et revenir ; les validations existantes restent explicites.
5. Depuis Journal, retrouver Ma semaine, le plan/TG et l’historique ; revenir au Journal. Vérifier une notification de chat lorsque l’app est en arrière-plan.

Fusion, contrôles GitHub exacts, livraison et recette propriétaire sont des états distincts. Le pilote M8 précédemment accepté n’est pas rouvert par ce lot.
