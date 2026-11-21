# Neurvia

Neurvia est une plateforme de démonstration pour un cours de Python. Elle permet au professeur de préparer des quiz et de repérer les difficultés de la classe dans MindMirror. L’étudiant peut répondre aux quiz et suivre sa progression.

## Ouvrir la plateforme

Installe **Node.js 24**, puis ouvre un terminal dans le dossier `Neurvia` et lance ces commandes :

```sh
npm ci
npm run dev
```

1. Ouvre [localhost:3000/login](http://localhost:3000/login) dans ton navigateur. Si le terminal affiche un autre port, utilise l’adresse qu’il indique.
2. Choisis **Professeur** ou **Étudiant**, puis clique sur **Se connecter**. Aucun identifiant n’est nécessaire.
3. Pour changer de rôle, clique sur l’avatar puis sur **Se déconnecter**.

Garde le terminal ouvert pendant l’utilisation. Pour arrêter la plateforme, appuie sur **Ctrl+C** dans le terminal.

## Essayer la démo

- **Professeur** — ouvre **MindMirror** pour explorer les difficultés de la classe, ou **Séances & quiz** pour préparer et publier un quiz.
- **Étudiant** — ouvre **Mes tâches** pour répondre à un quiz. Le bouton **Simuler J+7** rend les révisions différées accessibles pendant la démo.

Les données sont fictives et les changements sont enregistrés dans le navigateur. [Captures d’écran](docs/screenshots/)
