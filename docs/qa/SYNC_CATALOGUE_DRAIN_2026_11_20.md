# Synchronisation du référentiel — 20 novembre 2026

## Retour propriétaire

Sur le build 89, une synchronisation ne semble envoyer que 100 commandes.
Le propriétaire signale aussi EMAIL_INTAKE_ORIGINAL_CHANGED ; son emplacement
et le fichier concerné restent à identifier. Ne pas supposer que ces deux
symptômes ont une même cause, ni archiver les fiches pendant un envoi incomplet.

## Correction du cycle

Le plafond canonique de 100 commandes par requête reste inchangé. Après le
succès d’un lot complet de produits/codes distincts, pushUnlocked pouvait sortir
alors que d’autres commandes attendaient. Le cycle poursuit les pages déjà en
attente à son démarrage ; les essais réseau gardent leur propre limite. La borne
de séquence évite de poursuivre indéfiniment les modifications faites pendant
l’envoi. Les règles existantes des entités privées et des commandes sérialisées
restent conservées.

Aucune commande supprimée ni acquittée sans réponse serveur, aucune modification
métier directe et aucun contournement de la vérification des originaux email.
Le nettoyage du catalogue reste en attente de synchronisation complète.

## Vérifications

SQLite réelle : 205 produits répartis sur trois requêtes de 100/100/5 ; une
commande refusée reste FAILED avec son code, les 204 autres sont acquittées,
aucune commande ne reste PENDING et un second envoi ne republie rien.
Régression : la modification d’un produit effectuée pendant son acquittement
reste conservée, sans être ajoutée artificiellement au lot initial.

72 tests synchronisation et transmission Mercalys email réussis. Qualification
TypeScript/lint/CI et livraison native à suivre ; aucun nouveau binaire revendiqué.
Le problème EMAIL_INTAKE_ORIGINAL_CHANGED n’est pas déclaré corrigé par ce lot.
