# M8 — attendre la conservation native des fichiers

Chantiers 3 (documents), 6 (copies d’illustration) et 7 (fiabilité), tous en cours. Le SDK Expo installé expose `File.move` comme une promesse ; quatre parcours continuaient sans attendre sa résolution. Les nettoyages pouvaient supprimer la copie temporaire pendant le déplacement, ou le parcours rendre une URI finale avant sa disponibilité.

## Correction

- Les membres XLSX extraits d’un ZIP et les bundles de tickets multiphotos attendent le déplacement avant toute lecture finale, restitution ou nettoyage du fichier temporaire.
- Le téléchargement privé partagé par les originaux de sources et les pièces jointes email attend le déplacement puis recontrôle l’autorité et l’annulation. Si le déplacement a fini mais que l’autorité a changé, les octets vérifiés restent dans leur répertoire privé ; aucun résultat n’est remis au parcours révoqué.
- Les copies privées d’illustrations attendent aussi le déplacement et revérifient l’autorité. La réutilisation d’une copie existante vérifiée possède le même contrôle après inspection ; une révocation ne doit pas être confondue avec un fichier invalide à effacer.
- Un déplacement accompli dont l’accusé natif est perdu ne permet pas au nettoyage d’effacer le fichier final. Le réessai vérifie et réutilise ses octets sous la même identité, sans téléchargement supplémentaire pour un original déjà reçu.
- Les captures originales, une comparaison déjà conservée et les fichiers finaux contradictoires restent intacts. Un échec de déplacement est propagé ; les seuls nettoyages concernent les copies temporaires appartenant à l’opération.

Aucun changement de protocole, migration, Outbox, prompt, traitement IA ou décision de publication. La politique métier d’import et les permissions ne changent pas.

## Preuves

Les quatre scénarios de déplacement différé échouent sur le runtime précédent (`33927cc`) : membre ZIP, original téléchargé, bundle de ticket et illustration. Le test de reproduction rétablit ensuite les fichiers de travail corrigés. Les 76 scénarios ciblés passent sur le code corrigé, dont quatorze nouveaux cas. Les promesses de déplacement sont réellement différées dans les ports simulés, avec barrières explicites de début/fin ; les ports de ZIP/bundle/illustration opèrent sur de vrais fichiers Node, et les originaux téléchargés utilisent le port Expo simulé et un flux HTTP local simulé. Aucun appel fournisseur réel.

Sont couverts : pas de résultat avant installation, refus asynchrone, retry, conservation des sources/précédents résultats, changement de propriétaire et annulation pendant l’installation. Les tests SQLite existants du ticket multiphotos vérifient le maintien des captures et l’absence d’enregistrement/Outbox partiels quand l’écriture du bundle échoue. La compilation, le lint, le format et les exports natifs restent les portes du commit final.

La CI de `master` après PR 314 a dépassé les 5 s par défaut sur le scénario d’intégration de corruption/reconstruction de deux bases complètes (les deux CI exactes de la PR précédente avaient passé ce cas). Son délai seul passe à 30 s, sans assertion supprimée ni délai runtime modifié ; les autres tests conservent leur limite. Le run historique en échec reste consigné, sans relance aveugle.

Preuves locales : `artifacts/native-file-relocation-2026-10-20` dans le dossier partagé (reproduction avant correction et contrôles corrigés).

## Livraison et limites

Le lot reste non livré tant qu’un binaire groupé ne l’inclut pas. Les tests ne simulent pas toutes les interruptions du système de fichiers iOS/Android : la recette native, le réseau réel, les arrêts de processus, le stockage plein et la récupération des actions d’une base corrompue restent ouverts dans M8. Aucun build EAS payant, déploiement API, accès `.env`, envoi email ou appel IA n’est déclenché. L’API `ace4c3e` et le binaire disponible iOS 5 `1e7684d` restent inchangés.
