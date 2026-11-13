# Journal — qualification de la météo observée

Après le contexte INSEE livré dans le build 54, préparer la lecture des mesures
quotidiennes Météo-France. Cet incrément qualifie la source et son lecteur ; il
n'active ni station pour un magasin, ni collecte récurrente, ni nouvelle donnée
dans le Journal ou les outils du copilote. La validation propriétaire du build 54
reste distincte et en attente.

## Contrat de lecture

Réutiliser les fichiers départementaux officiels RR-T-Vent, compressés en gzip.
La sélection explicite d'une station restitue les coordonnées et l'altitude
publiées, le nom, la date producteur et les valeurs TN/TX/RR avec leurs codes
qualité. Conserver l'empreinte SHA-256 du fichier comprimé, son URL, sa date de
récupération et le numéro de ligne d'origine. Ne jamais décrire cette mesure
comme effectuée au magasin ni attribuer une date de publication inconnue.

Les codes 0 et 1 autorisent la valeur analytique ; 2 (douteuse), 9 (filtrée
seulement), codes inconnus et absence de code restent distincts et non retenus
pour l'analyse. Le zéro validé reste zéro, une valeur absente reste inconnue.
La pluie est le cumul de 06 h UTC le jour J à 06 h UTC le lendemain pour la
métropole, affecté à J par le producteur. Les extrema ne deviennent pas des
températures pendant les horaires d'ouverture. Les coordonnées et fenêtres sont
conservées par ligne pour ne pas masquer un déplacement de station.

Le lecteur est borné avant et après décompression et refuse les fichiers
corrompus, colonnes dupliquées/manquantes, dates invalides, doublons station/date
et valeurs incohérentes. Une station absente renvoie une liste vide, pas des
mesures nulles inventées pour chaque jour. Le format accepte les champs CSV
entre guillemets, y compris un point-virgule dans un nom.

## Intégration suivante

Définir le choix de station dans les réglages canoniques, la fraîcheur/cache
partagé et la compatibilité avec les versions installées avant d'exposer ces
mesures. Ne pas mélanger une prévision archivée et une mesure observée. Aucun
nouveau modèle de base, endpoint, migration ou agent n'est nécessaire à ce
lecteur seul. Pas de corrélation ou d'estimation causale calculée ici.

Source : Météo-France, données climatologiques de base quotidiennes,
https://www.data.gouv.fr/datasets/donnees-climatologiques-de-base-quotidiennes,
licence ouverte 2.0. Descriptif producteur du 3 juin 2026 :
https://static.data.gouv.fr/resources/donnees-climatologiques-de-base-quotidiennes/20260603-085232/climatologie-donnees-quotidiennes-descriptif-20260603.pdf.

## Vérification

Recouper les lignes réelles des deux candidates étudiées (Lariboisière et
Suresnes) avec le dossier de recherche conservé, puis couvrir les codes qualité,
absences, zéro, dates, doublons, entêtes et limites de décompression. Ces essais
de source ne constituent ni une livraison native ni une recette iPhone.

Vérifications locales : 28 tests de source passent. Le recoupement indépendant
avec le dossier de recherche retrouve exactement les valeurs, codes qualité et
numéros de ligne des 679 dates de chacune des deux stations, soit 1 358 lignes
réelles. Aucun fichier ni compteur de production n'est modifié. Les contrôles
complets et la fusion doivent être consignés séparément.
