# Bibliothèque visuelle produit — construction en cours

Périmètre L6 de la V1, sous le chantier M7 7, avec exposition au copilote à conserver dans le chantier 1. Référence : `../ux/FL_Copilot_Implementation_Specs_v1_1/specs/09_VISUAL_ASSET_LIBRARY.md` et arbitrages `../ux/AUDIT.md`. Ce document ne déclare ni le module code prêt, ni une livraison. Aucun import produit ne dépend de cette bibliothèque.

## Socle en construction

Trois métadonnées séparées du catalogue commercial : asset binaire/provenance/revue, identité visuelle, lien produit avec remplacement manuel. Un même asset et une identité peuvent servir à plusieurs SKU, sans fusionner les produits, prix ou observations. La résolution utilise uniquement un lien explicite approuvé ; le nom ressemblant ne crée aucun rapprochement. Image absente/rejetée/révoquée, liens contradictoires et cible étrangère donnent un placeholder. Une image de synthèse reste illustrative et ne représente pas un conditionné exact. Recherche externe et génération automatiques sont désactivées ; aucun fournisseur n’est appelé.

Les schémas conservent hash SHA-256, dimensions/volume bornés, origine, justificatif et attribution de droits, décisions attribuées/datées, créateur et auteur de modification. Les chemins locaux et URL publiques ne sont pas synchronisés. La clé de binaire est privée et factorisée par magasin/hash/type. Le contenu binaire d’un asset est immuable ; la revue et les liens sont versionnés. Une correction de provenance ne doit pas servir à présenter une synthèse comme un emballage réel.

SQLite 50 ajoute les métadonnées et le registre de fichiers local. Les mutations et l’Outbox sont atomiques, avec comparaison de révision et attribution à l’utilisateur. Les modifications d’un autre compte encore en attente ne sont pas envoyées ni prolongées implicitement. Les lectures distantes ne remplacent pas un choix local plus récent. Une révocation connue masque l’image, même en présence d’une décision locale encore non synchronisée.

La capacité de bootstrap/pull `visualLibrary` négocie les trois nouvelles entités ; les anciens clients ne reçoivent pas de type inconnu et leur curseur continue. Les écritures serveur recontrôlent le rôle MANAGER actif et l’auteur dans la transaction, les parents, l’unicité hash/produit, les versions et l’audit. Mongo 44 ajoute les index. La compatibilité API précède la livraison native. Le marqueur d’adoption local n’est écrit que sur une réponse compatible.

Une collision entre une création locale et un autre ID canonique de même hash ou de lien vers le même produit est conservée dans les conflits existants avec le payload reçu. Elle ne bloque pas le pull sur un index SQLite et n’écrase ni ne renomme l’ID local. Les commandes locales correspondantes restent conservées en conflit. La résolution utilisateur de ces collisions fait encore partie du travail restant.

## Vérifications intermédiaires

- Schémas et résolution : partage entre SKU, choix manuels et remplacement conservé, placeholder sans rapprochement implicite, droits/attributions inconnus refusés, synthèse jamais présentée comme emballage exact, génération/recherche désactivées.
- SQLite sur fichier : création atomique et rollback Outbox, unicité, relecture après redémarrage, réimport produit sans effacement du lien manuel, snapshot périmé/étranger/non autorisé refusé.
- ACK plus ancien conservant la décision locale, nouvelle révocation masquant la résolution, refus de deux corps pour une même révision, collision entrante conservée comme conflit et attribution du compte protégé.
- Scénarios Mongo ajoutés pour idempotence/audit, capacité bootstrap/pull, rôle/attribution, références étrangères, immutabilité, unicité et conflit de versions. Ils nécessitent le replica set de CI ; leur présence ne prouve pas leur exécution locale.
- Les compteurs d’une passe intermédiaire et les logs sont conservés dans l’espace de travail. Les contrôles finaux et exports de la tête à livrer restent requis après l’intégration complète.

## Reste à terminer avant PR du module et recette

1. Chaîne privée des fichiers indépendante des tickets de casse : capture/copie dans le stockage de l’application, origine conservée, upload authentifié et reprise durable, SHA/dimensions/MIME vérifiés sur les octets, dérivé d’affichage sûr et accès contrôlé après révocation. Aucune photo produit envoyée au pipeline casse.
2. Cache local borné et vérifié, épinglage hors connexion, préservation des originaux non envoyés, reprise de téléchargement et nettoyage uniquement récupérable. Ne pas annoncer une image disponible à partir des seules métadonnées.
3. Lecture et gestion depuis Produits, aperçu des droits/source, image générique/illustrative clairement qualifiée, choix dans la bibliothèque, envoi et remplacement manuel, révocation et conflits. Réutilisation du visuel dans Analyses/Actions/chat avec états de lecture progressifs.
4. Résolution explicite des conflits, notamment collision d’ID, sans last-write-wins universel ni réactivation automatique d’un lien révoqué. Conserver la version locale et les originaux jusqu’au choix.
5. Exercices SQLite→Mongo→autre appareil, téléchargement/restauration de fichier et maintien de la correction après réimport/sync. Mesure d’une bibliothèque représentative, stockage faible, fichiers invalides et téléchargements partiels.
6. Tests de permissions/routes, négociation SDK/anciens clients et migration de la base existante. Pas de retour vers un ancien binaire incapable de lire SQLite 50 : préserver la base, utiliser un correctif compatible/une restauration prévue, jamais supprimer les données pour forcer un downgrade.
7. Contrôles finaux locaux/CI et recette native groupée ; droits, configuration et budget requis avant toute activation ultérieure d’enrichissement automatique. Le module et les autres portes V1/M8 restent ouverts.

Les sept états restent : 1 actions/conflits en cours ; 2 contre-promo code prêt ; 3 documents en cours ; 4 expertise en cours ; 5 recommandations en cours ; 6 implantation en cours ; 7 UX/validation en cours. Aucun déploiement, binaire payant ou appel fournisseur réalisé pour ce socle.
