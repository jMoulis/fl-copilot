# Journal — conservation météo et navigation, 19 novembre 2026

Statut : implémentation en branche `fix/journal-weather-navigation`, non livrée.
Le lot Mercalys PR 546 reste séparé et attend sa recette native. Pas de nouveau
build ni déploiement API à ce stade ; ne pas rouvrir les autres lots acceptés.

## Diagnostic et correction

Le serveur possède déjà des archives quotidiennes durables, trois collectes
planifiées et un cache fournisseur partagé. Le téléphone possède un cache SQLite
par magasin/réglages/semaine. Aucun nouveau système de collecte n’est nécessaire.

Le fournisseur de prévisions produit sept emplacements de dates, dont des lignes
vides pour les dates sorties de son horizon. La fusion serveur conservait uniquement
les dates absentes ; SQLite conservait l’ancienne semaine seulement si toute la
nouvelle était vide. Une journée passée pouvait donc perdre ses valeurs alors que
le futur était correctement actualisé. La nouvelle fusion partagée conserve chaque
journée renseignée face à une ligne vide, avec ses vraies dates de source. Elle
n’attribue pas la date du nouveau téléchargement à l’ancienne prévision et ne marque
pas les prévisions récentes comme anciennes du seul fait de cette conservation.
Les archives déjà collectées sont relues avec cette règle : récupération possible
si les valeurs y sont présentes, jamais fabrication de journées non sauvegardées.

La carte choisissait aussi la météo observée dès que son enveloppe existait, même
sans mesure pour le jour sélectionné. Elle privilégie désormais les mesures
utilisables et, à défaut, affiche la prévision sauvegardée comme « Prévision
archivée ». Le détail garde les mesures et leurs limites distinctes des prévisions.

La consultation d’une semaine entièrement passée est limitée aux archives ; une
absence ne déclenche pas de collecte rétrospective. La collecte de prévisions saute
les semaines entièrement passées. La collecte existante des observations publiées
avec retard demeure nécessaire et conserve ses caches/horaires ; cette correction
ne transforme pas une ancienne prévision en mesure observée.

Le bouton texte conditionnel Aujourd’hui ajoutait une ligne au changement de jour.
Une icône permanente `today-outline`, avec libellé accessible et cible 44 × 44,
est maintenant placée immédiatement à gauche d’Actualiser. Les flèches de semaine
restent accessibles. Le skeleton des tâches reprend la hauteur précédente pendant
une lecture d’un autre jour, sans montrer les tâches du jour précédent. Les lectures
asynchrones obsolètes sont ignorées ; une actualisation du même jour garde son
contenu, et un échec sort du skeleton avec une explication.

## Vérification

Suite locale : 5 505 tests réussis, 900 ignorés par la configuration locale ;
lint, typecheck et format réussis. CI push/PR à vérifier sur le SHA exact.

Tests ciblés : fusion par date côté serveur, persistance SQLite et nouvelles
instances du dépôt, dates de source conservées, anciens clients sans extension,
carte de prévision archivée en absence de mesures, icône permanente/recentrage,
skeleton à hauteur réservée, réponses tardives et actualisation en arrière-plan.
Test Mongo isolé : semaine historique absente sans aucun appel fournisseur.
La CI complète exécute les cas Mongo ignorés dans la configuration locale.

Le contrôle natif reste à effectuer, le propriétaire ayant reporté le déverrouillage
du Mac. Les tests de rendu ne constituent pas une recette visuelle du simulateur.

## Recette avant livraison

1. Avec une copie isolée du contexte, sélectionner hier et avant-hier : valeur
   conservée, date source originale, libellé Prévision archivée ou mesure observée.
2. Actualiser le jour courant : ses prévisions évoluent, les jours passés restent
   consultables. Fermer et rouvrir hors connexion ; vérifier la même conservation.
3. Passer rapidement entre plusieurs jours et semaines : icône Aujourd’hui toujours
   avant Actualiser, pas de ligne conditionnelle ni de tâches d’une autre date.
   Vérifier le skeleton, la hauteur réservée et le retour exact au jour courant.
4. Vérifier les petites largeurs et gros caractères : pas de chevauchement de la
   date et des quatre boutons ; cibles tactiles et libellés accessibles conservés.
5. Ouvrir et fermer le détail météo, puis refaire la recette Mercalys PR 546 avant
   toute livraison native groupée. Compiler sur le Mac ; aucun EAS cloud payant.

La correction de conservation serveur nécessitera une livraison API explicite
selon RELEASE_PROCESS, distincte du binaire mobile. Aucun secret, jeu de données
magasin ou capture privée n’est ajouté au dépôt.
