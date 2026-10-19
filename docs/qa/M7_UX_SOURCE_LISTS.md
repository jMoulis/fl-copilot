# M7 UX — retrouver les sources sans perdre leur traitement

## Parcours couverts

### Casse

La liste native virtualisée propose recherche locale par date/caissier/note et filtres Tous / À revoir / En attente / Publiés. Les dates confirmées de casse, propositions de l’IA et captures sont distinctes. Les zéros initiaux du caissier sont conservés ; une valeur détectée n’est pas présentée comme confirmée, et une confirmation explicitement vidée ne reprend pas la proposition d’origine. Les lignes en attente d’analyse ne sont pas présentées comme une extraction de zéro ligne.

La publication locale et la synchronisation restent deux états différents. Un ticket publié peut encore être en attente de synchronisation ou en conflit ; les filtres ne constituent donc pas une partition exclusive. Les doublons confirmés ne repartent pas en examen sauf autre erreur/conflit. Les conflits/refus de synchronisation ne sont plus présentés comme un simple envoi en attente ; ils ouvrent l’espace existant de synchronisation. Les corrections et originaux restent inchangés.

Lecture initiale, liste effectivement vide et échec de lecture sont distingués. Les données affichées restent conservées lors d’une erreur. La liste est isolée par magasin/utilisateur ; recherche/filtre et position restent dans l’écran monté au retour du détail. Leur restauration après arrêt complet n’est pas ajoutée ici. Capture et import photo utilisent leurs routes existantes ; l’import manuel reste une photo, les lots de photos du chat restent distincts.

### Mercalys

Recherche par nom de fichier et filtres Tous / À examiner / Avec lignes publiées / À lire dans les fichiers chargés du lot. Une publication partielle apparaît comme telle : « avec lignes publiées » ne signifie pas que tout le fichier est terminé. Les compteurs issus des sources réellement enregistrées prennent le pas sur un ancien résultat de validation lors d’un fichier terminé. Une erreur de lecture actuelle reste à examiner, même si des lignes sont déjà publiées. Un checksum ambigu ne fabrique pas une publication.

Le nombre annoncé porte sur les fichiers chargés ; le bouton de pagination reste disponible et annonce que d’autres fichiers restent à lire. Les filtres/recherche restent en place à l’examen d’un fichier dans la feuille native existante. Un changement explicite de lot réinitialise les filtres. Les archives/lots précédents sont repliables, sans supprimer les résultats ni remonter des validations au-dessus des actions d’import courantes. Le rapprochement, la publication automatique autorisée, l’interruption/reprise, les doublons, les limites et les originaux gardent les mêmes services.

### Documents commerciaux

Le PDF et ses analyses passent avant les modules de contexte/préparation. Ces derniers restent accessibles dans une section repliable et restent montés afin de conserver leurs saisies. Les mêmes liens et contrôles de versions, TG et associations sont conservés. Le bouton de PDF original existant est disponible depuis la liste, avant même l’arrivée de l’analyse : copie locale iOS ou accès distant authentifié selon le comportement existant, sans nouveau mécanisme de stockage ni requête automatique. Android hors connexion n’est pas déclaré validé.

Le message inconditionnel « Aucune opération publiée » a été retiré : cet écran ne lit pas l’inventaire des opérations publiées. Un état réellement vide concerne uniquement les documents/extraits après une lecture réussie. Les erreurs de lecture ne sont pas assimilées à l’absence de documents.

### Accessibilité

Les boutons communs exposent les états désactivé/occupé/déplié à la fois aux API natives et à la prévisualisation web. Les filtres des nouvelles vues et des incréments Produits/Actions précédents annoncent leur choix ; le contrôle web a identifié que `accessibilityState.checked` seul n’est pas traduit par la version web installée. Ajout du même `aria-checked` sans changement de choix métier. Les actions courtes conservent un libellé accessible explicite. Cela ne vaut pas validation globale VoiceOver/TalkBack.

## Preuves

- `pnpm check` : **2 205 tests passés, 496 cas dépendant d’environnements externes ignorés localement**. Typecheck/lint passés après les derniers ajustements de liste ; CI exacte requise avant fusion.
- 32 tests ciblés source/presentation/repository : dates/caissier, effacement confirmé, publication et attente distinctes, conflit, doublon, filtre d’après publication réellement enregistrée, partiel, checksum ambigu et erreur restant visible. Les moteurs de publication ne sont pas réécrits.
- Build/import API et exports Hermes iOS/Android passés localement ; CI finale doit couvrir la tête exacte.
- Composant réel `ReceiptList` contrôlé dans son rendu web 390 × 844, quatre tickets de test explicitement annoncés : Tous 4/4, À revoir 2/4 (date proposée + conflit), recherche `000317` avec filtre conservé 1/4. Radios correctement annoncées cochées. Aucune erreur console. Captures : espace de travail `artifacts/source-lists-ux/`. Harnais et serveur temporaires retirés ; aucune donnée pilote utilisée.

## Portes restantes

Recette native groupée requise : recherche et retour au même emplacement, feuille de fichier et fermeture par geste, conservation des saisies PDF en repliant le contexte, original local/distant, réception d’une nouvelle extraction, synchronisation/conflit et texte agrandi/lecteurs d’écran. Mesurer les listes réelles ; ces contrôles ne prouvent ni les gestes UIKit/Android, ni un envoi distant, ni un traitement IA ou une publication sur le pilote. Aucun déploiement, modification de compte, appel IA ou build EAS payant.

L5 n’est pas clôturé : formulaires détaillés, réglages et chat doivent encore être examinés ; médias produit, transport compact des longues citations et autres critères M7/M8 restent ouverts. Une fusion ne constitue pas une livraison sur téléphone.
