# Échantillons Météo-France

Source : Météo-France, données climatologiques de base quotidiennes, licence
ouverte 2.0. Fichiers publics récupérés le 12 novembre 2026 dans le dossier de
recherche du Journal. Les CSV de test sont des **extraits**, pas les archives
producteur complètes : entête originale et lignes des 01/10/2025, 01/10/2026 et
02/10/2026 pour la station indiquée. Les valeurs, codes qualité et positions sont
conservés sans modification. La compression gzip créée par un test est un
emballage de test, jamais présenté comme l'archive officielle.

- `meteofrance-75-sample.csv` : Lariboisière, `75110001`.
  Original : https://meteofrance.s3.sbg.io.cloud.ovh.net/data/synchro_ftp/BASE/QUOT/Q_75_latest-2025-2026_RR-T-Vent.csv.gz
  SHA-256 de l'archive source conservée :
  `1f2d5cb6adf45eaf31fe48c2316a0a057c1f72f3443c15c5da23ed2ef31bccb2`.
- `meteofrance-92-sample.csv` : Suresnes, `92073001`.
  Original : https://meteofrance.s3.sbg.io.cloud.ovh.net/data/synchro_ftp/BASE/QUOT/Q_92_latest-2025-2026_RR-T-Vent.csv.gz
  SHA-256 de l'archive source conservée :
  `3149aa5609e30531dbcc44aecebf5e176f71ae9a771fb4ca64c92581da0ba881`.

Catalogue et attribution :
https://www.data.gouv.fr/datasets/donnees-climatologiques-de-base-quotidiennes.
Le lecteur n'affecte aucune station à un magasin et n'importe aucune mesure en
production. Les autres lignes synthétiques des tests servent uniquement à
vérifier les erreurs, absences et codes qualité.
