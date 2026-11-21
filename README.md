# FAHM / Neurvia

Neurvia accompagne les séances d’algorithmique et de Python. Le professeur prépare le quiz, interprète les réponses avec MindMirror, propose une remédiation et observe les résultats des exercices de vérification. [Spécification pédagogique](FAHM_Specification_Finale_Pour_Codex.md)

## Installation sous Windows

Prérequis **Python 3.11+**, **Node.js 24**, et **Ollama** si vous souhaitez générer du contenu avec Qwen. Depuis la racine du dépôt dans PowerShell.

```powershell
python -m venv apps/api/.venv
.\apps\api\.venv\Scripts\python.exe -m pip install -r apps/api/requirements-dev.txt
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Renseignez une valeur stable et aléatoire d’au moins 32 octets pour `JWT_SECRET` dans `.env` si vous souhaitez conserver les sessions lors des redémarrages. Les données SQLite sont conservées indépendamment du jeton. En développement, sans secret configuré, l’API génère une clé par processus. En production, elle exige une clé explicite et refuse le mode démo.

Dans un premier terminal.

```powershell
Set-Location apps/api
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Au démarrage, SQLite crée les tables et importe la banque Python au statut brouillon. La mise à niveau de la base de Phase 0 ajoute les nouvelles colonnes sans effacer les enregistrements. La base par défaut est `apps/api/fahm.db`. Utilisez un seul worker Uvicorn pour la démo. [Swagger](http://127.0.0.1:8000/docs)

Dans un second terminal, à la racine.

```powershell
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Ouvrez [Neurvia](http://127.0.0.1:3000/login). L’interface passe par la route Next.js `/backend`, qui appelle `BACKEND_URL` côté serveur. Le navigateur reçoit un cookie de session `HttpOnly` et le serveur envoie le JWT à FastAPI. Pour les requêtes directes à FastAPI, le préfixe est `/api/v1` et `CORS_ORIGINS` liste les origines autorisées. Pour ouvrir l’interface sur des téléphones, configurez une adresse LAN accessible pour Next.js et ouvrez la page de la classe depuis cette adresse avant de partager le QR. Gardez Ollama sur la boucle locale.

## Ollama

Démarrez l’application Ollama installée ou exécutez `ollama serve` si aucun service n’écoute déjà. Vérifiez le modèle dans PowerShell.

```powershell
(Invoke-RestMethod http://127.0.0.1:11434/api/tags).models | Select-Object name
```

Pour vérifier les deux générations sur le matériel local, exécutez `.\.venv\Scripts\python.exe -m tools.probe_ollama` depuis `apps/api`.

La configuration d’exemple utilise `LLM_ENABLED=true`, `LLM_MODEL=qwen3.5:9b` et `LLM_THINK=false`. N’activez `LLM_FALLBACK_MODEL` que pour un modèle installé. Le backend priorise la banque approuvée. Si des questions manquent et que Qwen échoue, l’éditeur présente le brouillon partiel et permet de le compléter à la main. Le professeur peut demander explicitement des items brouillons de la banque fournie. Pour les remédiations, la passerelle utilise un modèle de plan déterministe si Ollama est indisponible. Une relecture reste obligatoire.

Les champs de cours et de consigne sont des entrées pédagogiques. Utilisez des extraits anonymisés. La passerelle ne lit pas les noms, courriels, réponses ou profils étudiants.

## Vérifier un parcours réel

1. Créez un compte professeur et un compte étudiant, de préférence dans deux fenêtres séparées. Le professeur crée une classe et l’étudiant rejoint la classe avec le code ou son lien QR.
2. Dans **Banque pédagogique**, relisez les items initiaux et préparez des variantes distinctes pour les difficultés à vérifier. Choisissez l’étape de chaque variante et associez un distracteur au code ciblé avant l’approbation.
3. Créez une séance de Python, sélectionnez les concepts et préparez le quiz. Relisez et publiez avec l’approbation explicite.
4. Soumettez des choix et leur confiance comme étudiant. Une erreur seule reste une hypothèse. Pour une vérification ciblée, le profil doit avoir au moins quatre réponses et une variante indépendante approuvée.
5. Dans **MindMirror**, lisez les réponses et les priorités. Dans **Groupes**, calculez les propositions, prenez une décision, générez un plan, modifiez-le si besoin, validez et affectez-le puis lancez le retest. Le regroupement par défaut demande trois profils comparables.
6. Comme étudiant affecté, ouvrez le plan et faites le retest. Le suivi J+7 est prévu sept jours après sa soumission. La vue **Avant / après** affiche les dénominateurs à chaque étape. En présence d’une variante manquante, ajoutez-la à la banque, approuvez-la, puis relancez la programmation.

## Démonstration

Exécutez `./start-demo.ps1` ou définissez `DEMO_MODE=true` avant de démarrer FastAPI. La démo utilise `apps/api/fahm-demo.db` par défaut. Utilisez un autre nom de base avec `./start-demo.ps1 -Fresh` pour rejouer le parcours avec des données vierges. Le démarrage insère 20 apprenants fictifs, une séance publiée, des réponses de départ et des variantes distinctes. Les mêmes services calculent les diagnostics, groupes et retests.

- Professeur fictif `prof.fahm@example.com`.
- Étudiants à essayer `eleve1.fahm@example.com` et `eleve2.fahm@example.com`.
- Mot de passe des comptes fictifs `FAHM-demo-2026`.
- Comme professeur fictif, utilisez **Simuler J+7** après une soumission de retest. La date simulée est signalée dans l’interface. Pour un scénario sans Ollama, définissez `LLM_ENABLED=false` ou utilisez `./start-demo.ps1 -Offline`.

## Documents de cours

L’import de PDF, l’OCR avec relecture, l’assistant de cours et les quiz fondés sur les sources demandent PostgreSQL, un stockage S3 privé et un worker. `docker compose -f compose.documents.yml up -d --build` démarre ces services en local. Le déploiement, la sécurité, les sauvegardes et l’évaluation sont décrits dans [docs/DOCUMENTS.md](docs/DOCUMENTS.md).

## Tests

```powershell
Set-Location apps/api
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m tools.export_contract
Set-Location ../..
npx --yes openapi-typescript@7.10.1 docs/openapi.json --output docs/api-types.d.ts
npm run lint
npm run typecheck
npm run build
```

La suite Python utilise SQLite par défaut. Pour l’exécuter sur PostgreSQL, définissez `NEURVIA_TEST_POSTGRES` avec une URL dont l’utilisateur peut créer des bases, par exemple `postgresql+psycopg://neurvia:neurvia-local-db@127.0.0.1:55432/neurvia` avec la pile Compose. Chaque test reçoit alors une base neuve, clonée depuis un modèle migré par Alembic.

Les scripts Playwright `scripts/verify-workflows.mjs` et `scripts/verify-navigation.mjs` s’exécutent contre l’interface active. Définissez `NEURVIA_URL` pour son URL. Pour le scénario complet, sélectionnez `NEURVIA_MODE=demo` et une base de démo fraîche. Pour le parcours normal, utilisez une base normale et laissez cette variable vide. Le script de navigation mobile utilise les comptes fictifs. Installez Chromium avec `npx playwright install chromium` au besoin.

[Contrat et correspondance des parcours](docs/API.md) · [OpenAPI](docs/openapi.json)
