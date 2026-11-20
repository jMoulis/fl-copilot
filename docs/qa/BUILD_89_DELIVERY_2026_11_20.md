# Livraison iPhone 0.1.0 (89) — 20 novembre 2026

Le build 89 est disponible dans le groupe TestFlight privé habituel.
La recette physique du propriétaire reste ouverte.

## Périmètre et preuves

Référentiel officiel Mercalys avec aperçu et confirmation uniques : identités ITM/EAN,
PA HT/PV TTC/TVA datés, séparation des anciennes références regroupées sans redistribuer
leurs historiques, prix sentinelles hors calculs et attributs absents UNKNOWN.
Nomenclature source conservée sans imposer nos catégories. Original, écritures locales,
Outbox et synchronisation canoniques réutilisés. Les collisions EAN source restent
bloquées ; les références prêtes peuvent être ajoutées puis la même source complétée.

Scan gencode depuis la recherche Produits : caméra déjà installée, lecture exacte
locale, fiche canonique et retour au catalogue. Aucun article créé ni code réaffecté
par le scan, aucun appel IA ou envoi de photo. Les codes inconnus restent inconnus.

- PR 554 et 555 fusionnées. Source exacte API/archive :
  `a2ecb2adb27f091b34e8fd3f7826272b35487aad`.
- PR 555 : tête finale `68a292b3adb6b48a1760fe4de567ea7d9b9654f8` ; arbres
  testés/fusionnés identiques ; branche supprimée.
- CI push/PR/master réussies : 44739982354 / 44739989245 / 44741869808.
  646 suites et 6 452 tests réussis, une suite et six tests ignorés.
- Dix projets TypeScript, lint, format et structure réussis. Tests ciblés et
  source réelle documentés dans le suivi référentiel ; aucun test automatique
  n'est présenté comme une mesure de latence ou une recette optique iPhone.
- Fichier réel vérifié sur SQLite isolé : 1 226 références/prix, 172 hors base,
  zéro restante ; payload de 2 555 322 octets. Aucune donnée propriétaire modifiée.

## API et archive

API production préparée sans bascule, READY et santé JSON/base connectée vérifiées,
puis même déploiement promu et alias public vérifié :
`dpl_7z2vm8eyxnVKBJnks3Je4Au2SRfa`.
Précédent conservé : `dpl_CpiUcGQ8epN92hxMKfBnVb9fomm4`.

Migration SQLite 67 et capacité `articleReferences` ; API livrée avant l'app.
Anciennes apps exclues des nouvelles publications, adoption compatible via bootstrap.
Un retour du binaire 88 sur la base migrée n'est pas qualifié ; ne pas désinstaller
ou réinitialiser pour tester. La disponibilité d'un ancien déploiement ne qualifie
pas son retour après de nouvelles publications de référentiel.

Compilation sur le Mac, profil production, signature existante figée ; aucun build
EAS cloud ni modification de l'outillage système. Version 0.1.0, build 89 ; signature
STORE/APNs production et environnement vérifiés. SHA-256 de l'IPA :
`5d855eeab522ad59c909bcee30d7eb01f70ffa7d90ced99c127d9b0ed1c4fa37`.
Marqueurs référentiel, scan, capacité et statut hors base présents dans le bundle ;
aucune entrée ni marqueur du harnais de test.

## Apple et distribution privée

Envoi accepté, build Apple `e765a77c-fd39-4107-93e1-a638c3ee9e3a`,
`VALID` / `IN_BETA_TESTING`, non expiré. Groupe interne habituel
`8fb4605b-8734-4b25-aa77-dedff5126eb3`, un testeur et propriétaire seul vérifié ;
aucun lien public ni invitation ajouté. App `6833595029`, équipe `54QQCYMGXT`,
bundle `com.flcopilot.mobile`. Un premier lancement de l'uploader s'est arrêté
avant authentification/envoi à cause d'un chemin relatif de provenance ; reprise
avec chemin absolu, même archive vérifiée, un seul envoi Apple accepté.

## Recette propriétaire — en attente

Installer la mise à jour sans désinstaller l'app.

1. Importer le référentiel depuis Imports, lire créations/séparations et confirmer.
   Contrôler les deux bananes bio, leur code/prix ; unité absente à préciser,
   référence hors base sans prix 999 exploitable.
2. Fermer/réouvrir et synchroniser ; vérifier l'historique sur le second appareil
   et la réimportation sans doublon. Ne pas réinitialiser une source déjà publiée.
3. Vérifier la reconnaissance des codes lors d'un import ventes/casse ultérieur,
   sans nouvelle association pour les références validées ni fusion d'ITM distincts.
4. Scanner un EAN connu puis inconnu, revenir au catalogue avec ses filtres ;
   essayer hors connexion et vérifier fermeture/réouverture et permission caméra.

[Référentiel](ARTICLE_REFERENCE_2026_11_20.md) ·
[Scan](PRODUCT_BARCODE_SEARCH_2026_11_20.md).
Preuves privées : `maintenance/article-reference-2026-11-20/`, hors dépôt.
Cette documentation ne déclenche aucun autre build ni déploiement.
