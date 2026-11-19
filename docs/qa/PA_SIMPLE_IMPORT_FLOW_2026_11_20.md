# Import PA — parcours simplifié, 20 novembre 2026

## Décision propriétaire

Le dernier build est la base du retour, pas une explication par une ancienne
version. Importer les PA doit retrouver les fiches existantes et ajouter leur
historique daté. Les références absentes ne doivent pas transformer cet ajout
en une session obligatoire de maintenance du catalogue. Le propriétaire approuve
la simplification le 20 novembre, après l'audit du parcours PA.

## Comportement

- Ouverture sur le résumé PA, même avec des références non reconnues. Action
  « Ajouter les PA reconnus » ; références à compléter et prix à départager
  comptés séparément. La date du fichier, les prix à vérifier et les anomalies
  restent visibles. Aucun produit n'est créé par cet ajout.
- Référentiel accessible dans « À compléter », sans obligation de tout traiter.
  Une décision produit met à jour les lignes concernées, sans démarrer une session
  globale PA. Les sessions ventes/casse gardent leur fonctionnement antérieur.
- Le marqueur laissé par une ancienne session PA est retiré après une lecture
  réussie du fichier et de son catalogue ; les décisions déjà écrites restent
  conservées. Aucun marqueur d'un autre utilisateur/magasin/fichier n'est effacé.
- Une revalidation du catalogue a lieu à l'ajout des PA. Les choix de prix restent
  applicables seulement à leur groupe réel ; les publications précédentes restent
  figées. Une nouvelle correction chevauchant l'existant exige sa comparaison
  canonique et l'approbation de sa version courante. Doubles appuis verrouillés.
- Après un ajout partiel, « Compléter les références restantes » ouvre directement
  la suite dans le même écran, sans relecture du binaire ni fermeture/réouverture.
- Plusieurs PA pour un même produit/date : choix des prix en premier. Le sélecteur
  de produit et les actions de changement d'identité sont accessibles séparément
  via « Corriger l'association produit ». Aucun prix arbitraire n'est choisi.
- Le résumé ne déclenche plus les requêtes automatiques de comparaison au dernier
  PA à chaque décision. L'historique produit et la réconciliation des corrections
  restent disponibles. Aucun changement de formule de marge officielle.
- Lire ou ajouter des PA n'attend plus des travaux d'indicateurs de ventes sans
  rapport. Les lots propagent l'identifiant du job réellement créé : une publication
  PA n'en crée pas, un lot contenant des mouvements conserve son traitement.

## Invariants

Réutilisation du parser, matcher par codes, conservation des originaux, writers,
SQLite/Outbox, synchronisation et reprise canoniques. Pas de migration, nouvelle
API, nouveau modèle, agent, prompt ou seuil de prix. Les montants/date/unité/HT,
les statuts TO_VERIFY et les alternatives source restent inchangés. Ne pas
réinitialiser les imports ni modifier le catalogue réel pour fabriquer une recette.

## Vérifications et livraison

Les tests couvrent le chemin résumé → ajout partiel → suite directe, la retraite
d'un ancien marqueur PA, l'absence de session globale après une décision facultative,
la revalidation des codes et des chevauchements, les doubles appuis et l'absence
de recalcul de ventes. La suite ventes/casse conserve sa finalisation manuelle.
Un lot mixte réel SQLite vérifie qu'un PA n'a pas de job analytique et qu'un
mouvement en conserve un. Les suites de publication/reprise/prix et les contrôles
complets sont consignés dans la livraison privée.

Code en validation ; cette note ne vaut ni livraison TestFlight ni validation
physique. Le dernier build précédemment documenté est 87. Le contrôle visuel local
était bloqué par le verrouillage du Mac pendant l'audit ; ne pas le déclarer réussi.
Aucun changement de production ni nouvel import utilisateur pendant les tests.

Recette iPhone à fournir avec le nouveau numéro de build : ouvrir un import PA
partiellement traité, ajouter les PA reconnus sans terminer une session de catalogue,
puis accéder directement aux références restantes. Si nécessaire, choisir le PA
d'un produit à plusieurs références sans réassocier ses codes. Fermer/réouvrir et
vérifier l'historique, sans doublon. Un fichier déjà entièrement publié reste un
doublon normal ; ne pas supprimer des données pour le rendre réimportable.

### Vérifications locales avant PR

151 tests ciblés réussis, un test non exécuté dans cette configuration ; dix
projets TypeScript, lint et format contrôlés. Les tests natifs de composant
sont des tests automatisés, pas une validation physique sur iPhone.

L’accès Device Hub est revenu pendant la vérification. Une nouvelle copie
isolée du fichier et du catalogue a été préparée, réseau/authentification
remplacés par des ports de test. Le bundle se compile mais Expo Go échoue au
démarrage avec `Cannot find native module ExpoAsset`, avant le parcours PA.
Aucune réussite visuelle du nouveau parcours n’est revendiquée. Les anciennes
données de la copie précédente n'ont pas été réinitialisées. Les configurations
Metro/package/TypeScript temporaires sont restaurées ; aucun harnais de test
n'est inclus dans la livraison. Preuves privées :
`maintenance/pa-simple-flow-2026-11-20/`, hors dépôt.
