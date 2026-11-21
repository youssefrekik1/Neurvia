# Neurvia (FAHM)

Neurvia aide les professeurs d’algorithmique et de Python à comprendre **pourquoi** leurs étudiants se trompent, puis à y remédier. Après une séance, le professeur publie un quiz diagnostique. Neurvia relie chaque mauvaise réponse à une erreur de raisonnement connue, regroupe les étudiants qui partagent la même difficulté, propose une remédiation et vérifie ses effets par un retest puis un suivi à sept jours.

Le professeur peut aussi importer ses supports de cours en PDF, y compris manuscrits, interroger un assistant qui cite les pages sources, et générer des questions fondées sur ces documents. Chaque quiz exige l’approbation explicite du professeur avant publication.

Les modèles (Qwen3.5-9B et `qwen3-embedding:0.6b`) tournent en local par défaut via Ollama.

![Assistant de cours avec citation de la page source](docs/screenshots/course-assistant.png)

## Fonctionnalités

| Parcours | Ce que fait Neurvia |
| --- | --- |
| **Préparation de séance** | Notions de la séance, quiz préparé depuis la banque approuvée ou par Qwen, relecture et publication explicite |
| **Diagnostic** | Réponses avec niveau de confiance. Une erreur seule reste une hypothèse, que vient confirmer une variante indépendante |
| **MindMirror** | Constellation des profils d’erreurs et priorités de la classe, avec pseudonymes |
| **Groupes et remédiation** | Groupes proposés par similarité, plan de remédiation éditable, affectation et retest ciblé |
| **Suivi J+7** | Vérification différée et vue avant / après avec effectifs |
| **Documents de cours** | Import de PDF, extraction, OCR et vision, relecture obligatoire des passages incertains, indexation |
| **Assistant de cours** | Conversation sur les PDF sélectionnés, recherche hybride, citations vérifiées mot pour mot |
| **Quiz fondés sur les sources** | Questions générées à partir des passages, distracteurs liés à des erreurs approuvées, sources visibles à la relecture |
| **Établissements** | Isolation par établissement, classe et séance, notions et erreurs validées par les professeurs |

| Relecture d’un scan manuscrit | Quiz fondé sur les sources |
| --- | --- |
| ![Transcription à relire à côté de la page](docs/screenshots/documents-review.png) | ![Question avec page source et objectif](docs/screenshots/grounded-quiz-review.png) |

## Architecture

```text
Navigateur ── Next.js (src/, proxy /backend, cookie HttpOnly)
                 │
                 ▼
            FastAPI (apps/api) ──── Ollama ou serveur compatible OpenAI (vLLM)
             │        │
             │        └── Worker de documents (extraction, OCR, vision, embeddings)
             ▼                     │
      PostgreSQL + pgvector ◄──────┤
      (ou SQLite pour la démo)     ▼
                           Stockage S3 privé (SeaweedFS en local)
```

- **Frontend** : Next.js 16 et React 19. Le navigateur n’appelle jamais FastAPI directement : la route `/backend` conserve le JWT dans un cookie `HttpOnly` et contrôle l’origine des écritures.
- **API** : FastAPI, SQLAlchemy, Pydantic. Contrat publié dans [docs/openapi.json](docs/openapi.json) et types générés dans [docs/api-types.d.ts](docs/api-types.d.ts).
- **Base** : PostgreSQL avec pgvector et migrations Alembic pour l’installation complète. SQLite reste disponible pour la démonstration sans documents.
- **Documents** : stockage S3 privé, travaux durables avec reprise, recherche hybride (pgvector et plein texte PostgreSQL) avec fusion des rangs.

## Démarrage

Prérequis : **Windows et PowerShell**, **Python 3.11+**, **Node.js 24**, **Ollama** avec `qwen3.5:9b` et `qwen3-embedding:0.6b`, et **Docker Desktop** pour les documents de cours.

```powershell
python -m venv apps/api/.venv
.\apps\api\.venv\Scripts\python.exe -m pip install -r apps/api/requirements-dev.txt
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
ollama pull qwen3.5:9b
ollama pull qwen3-embedding:0.6b
```

### Option A : installation complète, avec les documents de cours

PostgreSQL, le stockage S3, l’API et le worker tournent dans Docker. Le frontend tourne en mode développement.

```powershell
docker compose -f compose.documents.yml up -d --build
$env:BACKEND_URL = "http://127.0.0.1:8010/api/v1"
npm run dev -- --port 3151
```

Ouvrez <http://localhost:3151/login>, créez un compte professeur, une classe et une séance, puis importez des PDF dans la section **Documents de cours** de la séance. L’API répond sur <http://127.0.0.1:8010/docs>. Pour un frontend conteneurisé, ajoutez `--profile web` : il écoute alors sur le port 3152.

Les mots de passe de `compose.documents.yml` ne servent qu’au développement local. L’API refuse de démarrer en production avec ces valeurs. Le déploiement, les secrets, les sauvegardes et les établissements sont décrits dans [docs/DOCUMENTS.md](docs/DOCUMENTS.md).

### Option B : démonstration rapide, sans documents

```powershell
./start-demo.ps1            # 20 apprenants fictifs, une séance publiée et des réponses
./start-demo.ps1 -Fresh     # nouvelle base de démonstration
./start-demo.ps1 -Offline   # sans Ollama
```

Le script démarre FastAPI sur le port 8000 avec SQLite, puis l’interface sur <http://127.0.0.1:3147>. Les comptes fictifs utilisent le mot de passe `FAHM-demo-2026` :

- professeur `prof.fahm@example.com` ;
- étudiants `eleve1.fahm@example.com` et `eleve2.fahm@example.com`.

Comme professeur, **Simuler J+7** avance l’horloge de démonstration après un retest. La date simulée est signalée dans l’interface.

## Parcours type

1. Le professeur crée une classe, au besoin rattachée à un établissement. Les étudiants la rejoignent par code ou QR.
2. Il crée une séance, importe ses PDF, relit les passages signalés et les fait indexer.
3. Il interroge l’assistant sur ses documents et précise ses consignes : thèmes, exclusions, difficultés observées. L’assistant en extrait un brief modifiable.
4. Il génère le quiz à partir des documents sélectionnés, relit chaque question et sa source, puis l’approuve et le publie.
5. Les étudiants répondent en indiquant leur confiance. MindMirror et les groupes orientent la remédiation, puis le retest et le suivi J+7 en mesurent l’effet.

Pour un diagnostic ciblé, approuvez dans la **Banque pédagogique** des variantes indépendantes par erreur et par étape (confirmation, retest, J+7). Un profil demande au moins quatre réponses, et un groupe trois profils comparables.

## Données et confidentialité

- Les modèles tournent en local par défaut. La passerelle ne transmet ni noms, ni courriels, ni réponses, ni profils étudiants. Les extraits de cours doivent rester anonymisés.
- Les PDF sont traités comme des données non fiables : une instruction cachée dans un document ne modifie ni les consignes du modèle ni les droits.
- Une classe ne peut jamais accéder aux documents d’une autre. Les ressources hors périmètre répondent `404`.

## Tests et vérification

```powershell
Set-Location apps/api
.\.venv\Scripts\python.exe -m pytest -q                       # SQLite
$env:NEURVIA_TEST_POSTGRES = "postgresql+psycopg://neurvia:neurvia-local-db@127.0.0.1:55432/neurvia"
.\.venv\Scripts\python.exe -m pytest -q                       # PostgreSQL : une base neuve par test
Remove-Item Env:NEURVIA_TEST_POSTGRES
.\.venv\Scripts\python.exe -m tools.check_documents --web http://localhost:3151   # parcours documentaire en direct
Set-Location ../..
npm run lint; npm run typecheck; npm run build
```

- `scripts/verify-workflows.mjs` et `scripts/verify-navigation.mjs` pilotent l’interface active avec Playwright. Définissez `NEURVIA_URL`, et `NEURVIA_MODE=demo` pour le scénario de démonstration.
- Après une modification de l’API, régénérez le contrat avec `python -m tools.export_contract` depuis `apps/api`, puis `npx --yes openapi-typescript@7.10.1 docs/openapi.json --output docs/api-types.d.ts` depuis la racine.
- L’évaluation de la recherche documentaire est décrite dans [docs/DOCUMENTS.md](docs/DOCUMENTS.md#évaluation-de-la-recherche).

## Structure du dépôt

```text
apps/api/
  app/            API FastAPI : routers, services, modèles, schémas
  app/documents/  extraction, worker, recherche, citations, génération fondée
  app/ai/         passerelle LLM, cache et serveurs de modèles
  alembic/        migrations PostgreSQL
  tools/          vérifications en direct, import SQLite, établissements, réindexation
  tests/          tests SQLite et PostgreSQL
src/              interface Next.js : professeur, étudiant, MindMirror, documents
data/             banque de questions Python de référence
docs/             contrat d’API, guide d’exploitation, captures d’écran
compose.documents.yml   pile Docker locale
start-demo.ps1          démonstration SQLite
```

## Documentation

- [docs/DOCUMENTS.md](docs/DOCUMENTS.md) : documents de cours, assistant, déploiement, sécurité, sauvegardes, capacité.
- [docs/API.md](docs/API.md) : correspondance entre écrans et routes de l’API.
- [FAHM_Specification_Finale_Pour_Codex.md](FAHM_Specification_Finale_Pour_Codex.md) : spécification pédagogique.

## Limites connues

- La transcription manuscrite n’a été vérifiée que sur un tracé synthétique. La relecture par le professeur reste obligatoire.
- Le matériel validé est un GPU portable de 8 Go. Prévoyez une attente au-delà d’un ou deux professeurs actifs en même temps, ou un serveur d’inférence dédié.
- Le backend compatible OpenAI a été vérifié contre l’API `/v1` d’Ollama, pas contre vLLM.
