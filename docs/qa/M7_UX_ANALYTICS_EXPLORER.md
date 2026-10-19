# M7 — premier Explorer analytique et navigation native (PR 274)

## Parcours et périmètre

Depuis Analyses, le responsable consulte les agrégats monétaires canoniques de son magasin dans SQLite, choisit Jour/Semaine/Mois/Année, une métrique et une période, ouvre un jour (ou un mois depuis l’année), puis revient au contexte parent. Aucun appel distant ne conditionne cette lecture. CA net, marge en euros et casse au prix de vente restent trois mesures distinctes ; ni quantité mélangée, ni taux de marge moyen, ni coût d’achat inventé.

Le thème sombre est centralisé dans les tokens et composants communs ; la préférence native est alignée dans la configuration Expo pour le prochain binaire. Les cinq domaines Aujourd’hui / Analyses / Produits / Copilote / Actions disposent chacun d’une pile. L’ouverture générale mène au chat. Les anciennes routes semaine/casse/imports/gestion/synchronisation et leurs données sont conservées. Actions reprend les tâches réelles du plan hebdomadaire existant ; absence de plan reste un état vide honnête. Aucun changement de schéma métier, dépendance native, contrat de sync ou serveur n’est nécessaire.

## Politique des périodes

- Semaine ISO et jour : même numéro de semaine ISO N−1, même jour de semaine. La semaine 43 de 2026 va du 19 au 25 octobre. Une semaine 53 sans équivalent n’est pas remplacée silencieusement.
- Mois/année : calendrier civil N−1 et mêmes dates écoulées ; aucune normalisation des jours de semaine. Une période civile complète de longueur différente reste non comparable. Les appariements autour du 29 février utilisent les dates, pas les rangs ordinaux.
- Le cumul renseigné de toute la période reste distinct des valeurs comparées. Seules les journées strictement antérieures à aujourd’hui (Europe/Paris) peuvent produire un delta, après vérification de toutes les paires attendues. Un masque de jours manquants différent ne devient pas une comparaison valide.
- Zéro, montant négatif, montant partiel et absence restent distincts. Le dénominateur nul ne produit aucun pourcentage. La casse reste valorisée au prix de vente.
- Les graphiques utilisent les mêmes points : jours pour semaine/mois, douze agrégats mensuels pour année. Aucun graphique horaire n’est fabriqué à partir d’un total quotidien.

Les politiques J−7 déjà utilisées ailleurs restent explicites et inchangées. Ce module partagé ajoute la politique Explorer ; le branchement des nouveaux liens contextuels du chat/Aujourd’hui et l’explication de toutes les fermetures commerciales font encore partie des lots suivants. Les fermetures inconnues ne sont pas supposées à zéro.

## Vérification des frontières

| Frontière                 | Preuve actuelle                                                                                                             | Limite                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Source → moteur partagé   | Cas de calendrier, ISO/53, jours clos, masques incomplets, zéro/négatif, année bissextile et agrégats graphiques            | Pas de calendrier de fermeture inventé                                                                   |
| SQLite → moteur           | Vraie base migrée, lecture des montants officiels, isolation magasin et refus d’un payload de mauvais magasin               | Tests Node SQLite, pas mesure sur l’historique du téléphone                                              |
| Contexte → redémarrage    | Base sur disque fermée/réouverte : métrique, période, ancre, historique et scroll restaurés ; isolation utilisateur/magasin | Restauration native des gestes/clavier à recetter                                                        |
| Lecture → écriture métier | Aucune commande Outbox créée ; seul l’état de présentation est écrit dans `app_metadata`                                    | Le filtre produit/catégorie n’est pas encore présent                                                     |
| Moteur → composants       | Composants de production compilés localement sur web, largeur 390, données explicitement de test                            | Aperçu temporaire sans authentification/SQLite natives ; ne prouve pas la navigation complète sur iPhone |
| Navigation → retours      | Historique déterministe et retour visible ; gestion Android du clavier puis historique ; piles et routes compilées          | Recette native iOS/Android et liens profonds complète encore ouverte                                     |

Les lectures sont bornées aux deux périodes (au maximum 732 dates), contrôlent la version de formule et restent dans une transaction locale cohérente. Les réponses obsolètes d’un ancien magasin, d’une ancienne sélection ou d’une génération de rafraîchissement sont écartées. Un rafraîchissement identique conserve les valeurs déjà visibles en cas d’erreur. L’état de présentation est enregistré dans l’ordre et au départ de l’écran ; un échec est signalé sans effacement des données métier.

## Résultats locaux

- 14 nouveaux cas réussis : dix cas de moteur/calendrier/graphiques et quatre cas SQLite/état, dont un redémarrage sur disque.
- `pnpm check` : 2 167 cas réussis et 496 cas conditionnés par l’environnement local ignorés ; lint et types réussis. Formatage, build/import API et exports Hermes iOS/Android réussis. Les tests Mongo transactionnels supplémentaires sont exercés par les deux CI exactes, dont le résultat est consigné dans la PR. Aucun appel IA payant.
- Aperçu de test : 8 810 € pour sept journées, comparaison à 7 790 € sur les jours ISO équivalents (+1 020 €, +13,1 %). Le mois reste marqué 7/31 journées complètes et n’affiche pas de delta artificiel.
- Captures locales : dossier `artifacts/analytics-explorer` du workspace partagé (week, day, month, year, picker). Aucun écran de preuve/donnée de test n’est inclus dans les routes livrées.

## Acceptation native groupée encore requise

1. Sur la prochaine livraison utile, ouvrir Analyses avec les données réelles hors connexion et vérifier les trois mesures face à une source publiée.
2. Semaine → jour → retour, année → mois → jour → retours ; changer d’onglet, reprendre le scroll ; fermer/réouvrir l’application.
3. Vérifier les contrôles natifs iOS/Android : zones sûres, grand texte/VoiceOver/TalkBack, clavier puis retour, feuille de période et gestes de fermeture. Les alternatives visibles restent utilisables.
4. Vérifier le chat principal, les fiches produit et les anciennes entrées semaine/casse/import/synchronisation, y compris les formulaires en cours.
5. Importer/synchroniser pendant la lecture et vérifier les rafraîchissements sans disparition du contexte. Mesurer la requête sur l’historique réel.

## Reste explicite

Ce lot couvre une première partie de L1–L4 de `docs/ux/V1_REMAINING_ROADMAP.md`, sans clôturer le chantier 7. Filtres catégorie/produit, contributions, liens profonds, navigation mois→semaine, finition des écrans métier, bibliothèque visuelle, illustrations et toutes les autres portes M7/M8 restent ouvertes. Pas de déploiement Vercel, de build EAS payant ni de validation iPhone annoncée par cette PR.
