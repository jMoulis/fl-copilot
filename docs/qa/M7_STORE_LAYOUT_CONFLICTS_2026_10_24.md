# M7/M8 — conflits du plan magasin, 24 octobre 2026

## Défauts observés et portée

Quatre refus manquants ont été reproduits avant correction dans le repository SQLite réel : un conflit plus récent non encore reçu par pull et une enveloppe de version différente de son contenu, pour chacun des deux choix. Les quatre appels aboutissaient au lieu d’être refusés. Le refus antérieur après un pull plus récent fonctionnait déjà et reste couvert. Les sources et résultats initiaux sont conservés séparément. Le plan de test est une référence qualifiée, jamais un relevé mesuré du magasin pilote.

## Comparaison et transaction existantes

Le lecteur dédié examine tout le groupe OPEN du même plan, la dernière copie typée reçue, les intentions locales et les commandes concernées. Il vérifie les identités magasin/révision/acteur, les enveloppes, les racines et liens entre révisions canoniques connues, ainsi que l’histoire immuable déjà conservée. Une contradiction, un envoi actif ou une limite dépassée interdit le choix. L’empreinte englobe ces lectures ; une évolution après affichage impose une nouvelle comparaison.

`remote_version` reste la base acquittée, qui peut être plus ancienne que le cache reçu pendant qu’un brouillon reste en attente. Les tests positifs vérifient ce cas sans changer le mécanisme de pull ni inventer une corruption.

La résolution réutilise le writer de plan et les tables existantes. Conserver le local crée un **nouveau SAVE_DRAFT** fondé sur la dernière révision distante, avec une seule commande et sa précondition exacte. Le contenu local conserve ses identités et ses qualifications de mesure ; la création et la référence canoniques ne sont pas réécrites. Adopter le synchronisé n’ajoute pas de commande. Les deux racines créées hors ligne peuvent avoir des dates de création distinctes : cela ne justifie pas la perte d’une intention locale.

Toutes les versions examinées restent dans l’historique immuable, et les anciens paquets gardent leur corps et leur identité sans faux acquittement. Seuls les conflits et commandes effectivement comparés sont clos ou remplacés. Le journal d’opérations existant conserve le choix, l’acteur, l’heure, l’empreinte et les identifiants du groupe ; le rejeu après redémarrage reste sans doublon. Contexte, appareil, autorité et annulation sont revérifiés jusqu’avant commit. Un refus tardif ou une erreur annule toute l’écriture. Une modification ordinaire ne peut pas remplacer le brouillon non envoyé d’un autre acteur.

Ni adoption implicite de référence, ni mesure, capacité, mobile ou image inventés. Aucun schéma de stockage, contrat réseau, modèle, permission IA ou fournisseur ajouté.

## Parcours natif

Le plan magasin et Synchronisation ouvrent la même comparaison fraîche. La feuille conserve la carte et les formulaires existants ; elle montre les versions et le groupe, réutilise les différences détaillées et requiert une confirmation de lecture. La relecture efface le consentement. Compte, magasin, rôle, appareil, connexion SQLite, cible, focus et fermeture bornent les actions tardives, via le hook de revue déjà commun aux autres familles.

L’écran parent rafraîchit après commit et après envoi, même lorsque la feuille a disparu. Une lecture ou un envoi échoué ne transforme pas le choix enregistré en échec d’écriture. Les modifications ordinaires utilisent également le contrôle de durée de vie du contexte natif.

## Preuves et limites

- **47 cas de service** : groupes, deux choix, cache plus récent/base acquittée, obsolescence, enveloppes, identités, historique, envoi actif, limite, droits/appareil/annulation, rollback, référence et mesures conservées, racines concurrentes, rejeu et réouverture de fichier SQLite.
- **13 cas montés** de la nouvelle comparaison dans la suite commune : double appui, relecture/erreur, refus des callbacks périmés et huit changements de contexte, envoi échoué. La suite commune complète compte 192 cas sur quatorze pages.
- **6 cas du vrai écran parent** avec son panneau rendu comme port : écriture locale immédiate, rafraîchissement après fermeture/envoi, lecture après commit échouée, sauvegarde interrompue par rôle/focus, ancienne lecture après remplacement de base. Ces tests ne prétendent pas rejouer les gestes physiques de la carte.
- **16 cas antérieurs** du repository conservés.
- **11 cas Mongo transactionnels réussis localement**, dont deux parcours renforcés de groupe : deux vrais résultats CONFLICT, nouvelle version reçue, chacun des deux choix, synchronisation sur une troisième SQLite, rejeu distant sans doublon et réouverture du fichier. Aucun accès ni écriture métier de production.

**`pnpm check` passe : 4 058 tests / 675 ignorés selon l’environnement**, lint/structure et dix projets TypeScript. Format et diff vérifiés ; les deux CI du commit final, build API et exports mobiles restent requis avant fusion. Ce lot et les autres correctifs de conflits depuis PR 345 restent **hors build 14** ; aucun EAS payant ni déploiement API propre. Mesures du magasin, recette physique iOS/Android, illustrations autorisées et toutes les autres portes V1/M8 restent ouvertes.

M7 : 1 Actions/conflits en cours ; 2 Contre-promotion code prêt ; 3 Documents, 4 Expertise, 5 Recommandations, 6 Implantation et 7 UX/validation en cours. Les chantiers 1, 6 et 7 avancent ; aucune parité globale ni validation sur appareil n’est déduite de ces tests.
