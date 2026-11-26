# Journal des modifications

Toutes les modifications notables de ce projet sont documentées dans ce fichier.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
et ce projet adhère au [Versionnement sémantique](https://semver.org/lang/fr/).

> **Consigne de contribution** : toute modification visible par l'utilisateur
> doit ajouter une ligne sous `[Unreleased]` avant d'ouvrir une PR — en
> français, en langage courant, sans jargon technique ni identifiant de commit.

---

## [Unreleased]

_(Aucune modification en attente.)_

---

## [1.1.0] - 2026-11-26
 
### Ajouté

- **Visualisation des conflits dans les emplois du temps maîtres** : l'éditeur
  signale maintenant les chevauchements de salles ou d'enseignants sur un même
  créneau, et propose d'y remédier.
- **Export des emplois du temps maîtres en Word et PDF** : il est désormais
  possible de télécharger directement les emplois du temps maîtres dans ces
  deux formats.
- **Import des emplois du temps maîtres depuis Word et PDF** : vous pouvez
  charger des fichiers issus de Word (.docx) ou de PDF pour créer ou mettre à
  jour un emploi du temps maître.
- **Journalisation structurée au démarrage** : les incidents de démarrage sont
  maintenant consignés avec plus de détails pour faciliter le diagnostic.

### Modifié

- Le message d'erreur affiché en cas d'échec au démarrage est plus clair et
  suggère des actions concrètes (réessayer, ouvrir les journaux, restaurer une
  sauvegarde).
- Lorsque le démarrage échoue pour une raison temporaire, l'application tente
  automatiquement de relancer le serveur jusqu'à trois fois avant d'afficher
  l'erreur.

### Corrigé

- Correction d'un problème rare où la base de données embarquée pouvait rester
  partiellement démarrée après un arrêt Windows.
- Correction d'une erreur silencieuse lors du nettoyage de PDF.js après
  l'analyse d'un emploi du temps maître.

---

## [1.0.0] - 2026-11-09

### Ajouté

- **Import des emplois du temps FET** : importez les fichiers HTML générés par
  FET (vues salles, enseignants et groupes) pour créer votre emploi du temps.
- **Import CSV** : importez également les fichiers CSV exportés depuis FET.
- **Aperçu jour par jour** : visualisez chaque journée de l'emploi du temps
  sous forme de grille avant de générer les documents.
- **Export Word** : génération automatique des fichiers `.docx` journaliers
  avec la mise en page de référence (blocs A, B, R et Amphi, créneaux et
  enseignants).
- **Profils d'export** : créez et gérez plusieurs profils de mise en page pour
  adapter les documents à différents besoins (orientation, taille de police,
  groupement par page, etc.).
- **Modèle de cellule personnalisable** : choisissez quelles informations
  apparaissent dans chaque cellule (enseignant, groupe, matière, fréquence).
- **Correction des noms** : modifiez les noms d'enseignants et les étiquettes
  de salles affichés dans les documents sans toucher aux données source.
- **Comparaison de versions** : comparez deux emplois du temps importés pour
  voir les séances ajoutées, modifiées ou supprimées.
- **Emplois du temps maîtres** : créez et modifiez des emplois du temps
  maîtres à partir des fichiers Word ou PDF, avec détection de conflits.
- **Sauvegardes automatiques** : une sauvegarde de la base de données est
  créée automatiquement avant chaque mise à jour.
- **Guide d'utilisation intégré** : consultez la documentation directement
  depuis le menu Aide, ou exportez-la en PDF.
- **Mises à jour automatiques** : l'application vérifie et installe les mises
  à jour en arrière-plan (Windows et Linux AppImage).
