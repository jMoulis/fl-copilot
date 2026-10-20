# M7 — cohérence du chat avec l’UX arbitrée

Lot L5 / chantier 7, 20 octobre 2026. Le chat reste conversationnel : pas de mur de recommandations, pas de modification de ses outils ou instructions modèle.

## Changements

- Les 27 cartes/adaptateurs à styles explicites réutilisent un texte natif à contraste et interligne cohérents. Les couleurs de statut et de bouton restent prioritaires. Les composants déjà stylés avec les classes communes gardent leur implémentation ; aucune modification globale du composant React Native Text.
- Les boutons d’action utilisent le texte sombre de la palette sur l’accent clair. Les champs de modification d’un conseil et de note, le choix de produit et les formulaires ont une saisie/sélection/indication de clavier sombre cohérente. Les radios de décision exposent leur état et montrent une coche, pas uniquement une bordure colorée.
- Un raccourci dans l’en-tête crée une conversation via le contrôleur local existant. Verrou de création, brouillons par conversation, Outbox, suppression et mémoire conservent leurs règles. Une erreur de création ouvre la liste pour rendre son message visible.
- Un bouton permet de revenir aux derniers messages quand le lecteur remonte le fil. Le suivi distingue un déplacement vers les anciens messages de la croissance du contenu : recevoir un nouveau bloc ne suffit pas à désactiver le suivi. Le redimensionnement par le clavier préserve l’intention de lecture. Le chargement d’un historique ancien suspend explicitement le suivi.

## Vérification locale

Contrôle des composants de production React Native Web à **390 × 844**, dans une racine isolée avec messages/chiffres synthétiques et contrôleurs de cartes simulés. Aucun appel IA, fichier personnel, API ou écriture métier. Les mutations simulées sont refusées ; les raccourcis du fil utilisent des callbacks en mémoire. La coque et la page de preuve ont été retirées avant vérification des exports.

Parcours exercés :

1. Réponse avec gras/tableau, source ouvrable dans une feuille, copie toujours visible, compositeur et états désactivés pendant la réponse en cours.
2. Carte de constat terrain : corps, intitulés, explication et bouton lisibles ; aucune confirmation métier exécutée.
3. Choix « Modifier » d’un conseil : état coché vérifié dans le DOM accessible, saisie de l’action et de la note, bouton activé ; pas de sauvegarde via le double de contrôleur.
4. Étapes d’outils repliées/dépliées et réponse en cours simulées ; nouveau bloc suivi lorsqu’on est en bas, retour explicite lorsqu’on lit plus haut. La position de lecture observée reste **1 208,5 px** avant/après le retrait et l’ajout d’un bloc, pour une hauteur de contenu de **2 652 px** et un viewport de fil de **600 px**.
5. Raccourci « Nouvelle conversation » : état d’accueil obtenu par le callback de test. Cette observation ne prétend pas prouver la persistance réelle ; les tests existants des contrôleurs/repositories SQLite restent la preuve automatisée de cette couche.

Deux tests de régression couvrent la séquence premier affichage → arrivée de texte → déplacement programmatique → lecture ancienne → nouveau bloc → retour en bas, ainsi que clavier et ajout d’historique. Les règles métier des contrôleurs et les parsers de réponses/sources ne sont pas réimplémentés.

Avant CI, `pnpm check` passe : **2 361 tests réussis / 506 ignorés** sans leur environnement Mongo. Lint, TypeScript et exports Hermes iOS/Android réussis ; aucun marqueur de fixture QA dans les bundles. Ces preuves locales ne se substituent pas aux deux contrôles exacts push/PR avant fusion.

Captures et sources temporaires : artefact local `artifacts/copilot-dark/`, notamment `operations-card.png`, `decision-input.png`, `streaming.png`, `paused-stream.png`, `source.png` et `scroll-proof.json`. Les seuls avertissements du navigateur pendant ce contrôle sont les déconnexions Metro des redémarrages volontaires nécessaires pour reconstruire l’aperçu en mode CI.

## Recette native restante

Sur le prochain binaire groupé : clavier réel et grandes polices, historique long et streaming réseau, VoiceOver/TalkBack, création/changement de conversation avec brouillon réel, menus d’appui long et suppression par glissement, pièces jointes et retour depuis une source/Analyses avec contexte conservé. Vérifier les contrôleurs réels, erreurs et reprises hors connexion. Le contrôle web ne prouve ni ces gestes ni la fiabilité d’une réponse d’un modèle réel.

Aucun build EAS, fournisseur, déploiement ou réglage système n’est ajouté. Les sept chantiers et les autres critères V1/M8 restent ouverts selon leur suivi.
