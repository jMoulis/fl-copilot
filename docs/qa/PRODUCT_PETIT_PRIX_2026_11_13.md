# Repère produit — Gamme Petit Prix

Ajouter un interrupteur « Gamme Petit Prix » à l'éditeur produit et un repère
sur la fiche. C'est un marquage de gamme actuel, distinct d'une promotion, d'un
seuil de prix et d'une disponibilité. Ne pas classer automatiquement le catalogue
à partir des libellés et ne pas modifier les produits de production pendant
l'implémentation.

Le booléen `isPetitPrix` réutilise Product, SQLite, les commandes produit et la
synchronisation canoniques. Une migration additive ajoute la colonne locale.
Les anciennes fiches sont non marquées ; l'omission par un ancien écrivain ou
un import conserve un marquage déjà enregistré. Un faux explicite retire le
marquage. Aucun modèle supplémentaire, calcul financier ou appel IA ajouté.

Le copilote reçoit ce repère dans ses lectures produit et dans les preuves de
lecture des signalements. Le marquage est celui de la fiche au moment de la
lecture, pas un historique de gamme à la date d'une ancienne rupture. Il peut
aider à interpréter la disponibilité de la gamme d'entrée de prix ; il ne
démontre pas à lui seul un report, une perte de ventes ou un effet causal.
L'enveloppe existante de lecture des signalements reste compatible avec les
clients installés : le repère est inclus dans les faits lisibles, sans nouveau
champ obligatoire dans les anciens résultats.

## Dates des signalements — comportement vérifié

`startedAt` est le début déclaré ; `clientCapturedAt` est la date/heure réelle
de saisie. `endedAt` est la fin déclarée lors de la clôture. La création reprend
la capture ; la synchronisation ne la remplace pas. Le copilote lit les deux
instants et filtre les événements chevauchant la période demandée, y compris
une rupture commencée auparavant. Sans début réel connu, l'instant saisi ne
prouve pas l'instant exact de début de la rupture. L'absence de signalement ne
prouve pas l'absence de rupture.

## Qualification attendue

Vérifier migration/conservation, sauvegarde sans réseau, reprise et Outbox,
activation puis retrait du marquage, conservation par les écrivains anciens,
lectures produit/signalements/Mongo autorisées et empreintes des preuves quand
le marquage change. Les dates et périodes des signalements restent inchangées.
Code, fusion, API, binaire et recette propriétaire sont des jalons distincts.
