# Casse — choisir et créer un produit depuis le ticket

Lot L5 / chantiers M7 1 et 7. La recherche manuelle réutilise le catalogue local, son moteur de recherche et le service d’association déjà disponible au copilote. Aucun changement de schéma, fournisseur IA, moteur de publication ou règle de synchronisation.

## Parcours

Depuis une ligne du ticket : « Chercher dans tout le catalogue » ouvre un écran modal au-dessus du ticket conservé. Le libellé du ticket reste visible ; recherche par libellé, alias ou code validé (EAN/ITM8/PLU, zéros conservés), liste virtualisée et aperçu explicite avant association. Produits inactifs, retirés, en erreur ou en conflit exclus des choix. Une fiche incomplète reste sélectionnable : la casse n’impose pas de renseigner catégorie/nature/unité du référentiel. Aucune fausse confiance ou proposition d’extraction n’est créée.

Une ligne dont les valeurs ont été modifiées doit d’abord être enregistrée ou abandonnée. Les saisies des autres lignes et métadonnées restent dans l’écran du ticket monté. Fermer la sélection sans confirmer n’écrit rien. L’association enregistrée revient au ticket, relu via le dépôt existant ; elle ne publie pas le ticket et n’apprend pas un alias implicitement.

« Créer un produit » utilise le formulaire canonique et sa transaction produit/identités/Outbox/recalcul. Seul le libellé source est proposé ; classifications inconnues et absence de code restent possibles. Le formulaire est protégé contre les retours destructifs ; son brouillon n’est pas réinitialisé par les relectures du ticket. Après enregistrement, retour à la sélection conservée avec aperçu de la nouvelle fiche ; une confirmation distincte l’associe à la ligne. Annuler la création conserve la recherche précédente. La création et l’association restent deux actions explicites. La fiche créée reste disponible même si le ticket devient entre-temps non modifiable.

Les routes acceptent des UUID d’origine et, au retour de création, un UUID de produit servant uniquement à ouvrir l’aperçu. Aucune URL de retour, magasin ou libellé n’est fourni par le lien. Le contexte est relu dans le magasin authentifié ; les écrans sont isolés par utilisateur/magasin/UUID. L’éditeur produit existant est également remonté lors d’un changement de ce contexte, y compris pour une nouvelle fiche.

## Écriture et concurrence

La confirmation fige la révision de ligne et l’identité canonique de l’agrégat produit (fiche, codes, alias), avec le helper de comparaison existant. Le service recontrôle ces éléments dans la transaction SQLite d’édition du ticket, ainsi que les conflits ouverts des identités. Une modification du code sans incrément de la version parent est refusée. Un ACK sans modification métier n’invalide pas le choix. Une cible modifiée, supprimée, inactive, en conflit, étrangère ou un ticket publié ne peuvent pas être associés silencieusement ; le choix reste visible et une nouvelle sélection est demandée.

La correction de brouillon reste locale et durable jusqu’à la publication canonique, qui garde son Outbox existante. Aucune migration, collection, commande ou formule supplémentaire. Les appels révisés du chat gardent leur signature compatible.

## Preuves et limites

Suite complète locale : **2 246 tests réussis / 498 dépendants d’environnement ignorés**, types stricts/lint passés. Build et import API passés. Exports Hermes locaux passés. PR 283 fusionnée après CI push `39336067334` et PR `39336074077` réussies sur `fc1e2dea003f92cdaf71b807ddf943178df68307`, merge `ab5e2bfde03b4558ab2ac295be9b0ae660493ce5` ; branches supprimées.

- SQLite réel : création par le service canonique avec ITM8 `00001234`, association hors candidats d’une fiche incomplète, absence de publication/alias/commande supplémentaire, fichier source conservé et choix restauré après fermeture/réouverture.
- Refus sans mutation pour révision de ligne, libellé/code/alias modifié, produit inactif/supprimé/en erreur/étranger, ligne supprimée ou publication arrivée avant confirmation. Conflit d’identité enfant relu dans la transaction, puis ACK seul accepté. Origine non valide/étrangère refusée.
- Présentation des composants réels en navigateur 390 × 844 avec fixture synthétique : code avec zéros, exclusion du produit inactif, choix/confirmation, état vide et absence d’erreur console. Captures dans `artifacts/receipt-catalogue-ux/` de l’espace de travail. Le callback de confirmation du harnais est synthétique ; les transactions sont vérifiées séparément par SQLite.
- Le StackRouter réellement installé a été exercé séparément : annulation conservant les paramètres/clé de la sélection, puis POP_TO après création conservant les clés du ticket et de la sélection avec le seul UUID de produit à prévisualiser. Cela ne remplace pas la recette des gestes natifs.
- Le harnais et le serveur sont retirés après contrôle. Aucun fichier pilote, appel fournisseur, déploiement ou build EAS payant.
- La recette native groupée reste ouverte : retour par geste/clavier, formulaire avec annulation, retour exact après création, conservation des autres saisies/position, publication/synchronisation puis lecture sur un autre appareil. La preuve web ne constitue pas cette acceptation.

Les sept chantiers restent : 1 actions/conflits en cours ; 2 contre-promo code prêt ; 3 documents en cours ; 4 expertise en cours ; 5 recommandations en cours ; 6 implantation en cours ; 7 UX/validation en cours. Les médias L6, réception Resend, illustration/contraintes du plan et toutes les autres portes V1/M8 restent suivis. Code fusionné ne signifie ni livré ni validé sur appareil.
