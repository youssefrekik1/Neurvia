# Documents de cours et assistant RAG

Ce guide décrit le déploiement et l’exploitation du pipeline documentaire : import de PDF, extraction et OCR, relecture enseignante, indexation, recherche hybride, assistant de cours et quiz fondés sur les sources. Les parcours F1–F5 existants, la confirmation, les retests et le suivi J+7 ne changent pas.

## Architecture

| Service | Rôle | Image |
| --- | --- | --- |
| `db` | PostgreSQL 17 avec pgvector : données métier, chunks, vecteurs et index plein texte | `pgvector/pgvector:0.8.1-pg17` |
| `objects` | Stockage S3 privé (SeaweedFS en local) : PDF originaux, rendus de page, vignettes de blocs | `chrislusf/seaweedfs` (épinglée par digest) |
| `migrate` | `alembic upgrade head`, exécuté avant l’API et le worker | `apps/api/Dockerfile.documents` |
| `api` | FastAPI : autorisation, import, relecture, recherche, assistant | idem |
| `worker` | File de travaux durable : extraction, OCR, vision, embeddings | idem, système de fichiers en lecture seule |
| `web` (profil `web`) | Next.js et le proxy `/backend` | `Dockerfile.documents.web` |

Ollama tourne sur l’hôte (`host.docker.internal:11434`). Il sert `qwen3-embedding:0.6b` pour les embeddings et `qwen3.5:9b` pour la vision, le chat, l’extraction du brief et la génération.

Cycle d’un document :

1. Le professeur importe un PDF. L’API vérifie l’accès à la séance, la taille et la signature `%PDF-`, déduplique par SHA-256 dans la séance, écrit l’original dans le bucket, puis crée la version et un travail `extract`.
2. Le worker réserve le travail avec un bail de 5 minutes, rend chaque page et extrait les blocs : texte numérique, code, tableaux et figures pour un PDF natif. Une page scannée passe par Tesseract, puis par Qwen vision si l’OCR est vide ou peu fiable (confiance moyenne < 0,78).
3. Tout bloc issu de l’OCR, de la vision ou de la détection de figures porte `review_required`. La version reste à l’état `review` jusqu’à ce que le professeur relise et valide chaque bloc. Un PDF natif sans bloc incertain passe directement à l’indexation.
4. Le travail `index` découpe les blocs en chunks parents et enfants, calcule les embeddings, puis publie la révision de façon atomique. L’état passe à `ready`.
5. La recherche combine pgvector (HNSW, distance cosinus) et le plein texte PostgreSQL par fusion des rangs. Elle applique un reclassement lexical léger et un budget de contexte. Chaque réponse ou question conserve des citations vérifiées mot pour mot dans la page source.

## Démarrage local

Depuis la racine du dépôt :

```powershell
docker compose -f compose.documents.yml up -d --build
# Avec le frontend conteneurisé sur http://127.0.0.1:3152
docker compose -f compose.documents.yml --profile web up -d --build
```

Ports publiés sur `127.0.0.1` uniquement : API `8010`, PostgreSQL `55432`, S3 `59000`, web `3152`.

Modèles requis dans Ollama :

```powershell
ollama pull qwen3-embedding:0.6b
ollama pull qwen3.5:9b
```

Pour un frontend de développement hors conteneur, lancez `npm run dev` avec `BACKEND_URL=http://127.0.0.1:8010/api/v1`.

## Variables d’environnement

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `DATABASE_URL` | SQLite local | PostgreSQL obligatoire pour les documents : `postgresql+psycopg://…` |
| `DOCUMENT_S3_ENDPOINT` | vide | Sans endpoint, l’API répond `503 DOCUMENT_STORAGE_UNAVAILABLE` aux imports et le worker refuse de démarrer |
| `DOCUMENT_S3_BUCKET` | `neurvia-documents` | Bucket privé, créé au premier import si absent |
| `DOCUMENT_S3_ACCESS_KEY`, `DOCUMENT_S3_SECRET_KEY` | vides | Obligatoires dès qu’un endpoint est défini |
| `DOCUMENT_S3_REGION` | `us-east-1` | Région S3 |
| `DOCUMENT_MAX_UPLOAD_MB` | `24` (1–64) | Taille maximale d’un PDF |
| `DOCUMENT_MAX_PAGES` | `120` (1–300) | Nombre maximal de pages |
| `DOCUMENT_OCR_LANGUAGES` | `eng+fra+ara` | Langues Tesseract installées dans l’image |
| `DOCUMENT_TESSERACT` | `tesseract` | Binaire OCR |
| `DOCUMENT_VISION_ENABLED` | `true` | Repli sur Qwen vision pour les pages scannées |
| `DOCUMENT_VISION_MODEL` | `qwen3.5:9b` | Modèle de transcription |
| `EMBEDDING_MODEL` | `qwen3-embedding:0.6b` | Modèle d’embedding, 1024 dimensions |
| `RAG_CONTEXT_BUDGET` | `5500` octets | Budget des passages transmis au modèle |
| `RAG_RERANK` | `true` | Reclassement lexical après fusion |
| `DOCUMENT_JOB_RETRIES` | `3` (1–8) | Tentatives avant l’échec définitif d’un travail |
| `LLM_ENABLED`, `LLM_MODEL`, `LLM_NUM_CTX`, `LLM_TIMEOUT_S` | voir `README.md` | Chat, brief et génération |
| `MODEL_BACKEND` | `ollama` | `ollama` (API native) ou `openai` (serveur compatible OpenAI : vLLM, llama.cpp server, TGI…) |
| `LLM_BASE_URL` | `http://127.0.0.1:11434` | Adresse du serveur de modèles, sans le suffixe `/v1` |
| `MODEL_API_KEY` | vide | Jeton Bearer envoyé au serveur de modèles (par exemple `vllm serve --api-key`) |
| `EMBEDDING_REVISION` | vide | Backend `openai` : version des poids d’embedding servis, enregistrée avec chaque index |

## Serveur de modèles

Le backend dépend de deux interfaces, `LLMClient` (génération structurée) et `DocumentModels` (embeddings et transcription). `app/ai/serving.py` choisit leur implémentation selon `MODEL_BACKEND`. Le cache, la recherche, le worker et les prompts ne dépendent pas du serveur.

Par défaut, Qwen et les embeddings restent locaux dans Ollama. Pour un serveur dédié avec vLLM, par exemple :

```bash
vllm serve Qwen/Qwen3.5-9B --api-key "$MODEL_API_KEY"                         # génération et vision
vllm serve Qwen/Qwen3-Embedding-0.6B --task embed --api-key "$MODEL_API_KEY"  # embeddings
```

Définissez ensuite `MODEL_BACKEND=openai`, `LLM_BASE_URL`, `LLM_MODEL`, `DOCUMENT_VISION_MODEL`, `EMBEDDING_MODEL` (noms servis), `MODEL_API_KEY` et `EMBEDDING_REVISION`. Les deux modèles doivent être joignables à la même adresse, directement ou via une passerelle. La génération structurée utilise `response_format` avec un schéma JSON. Ces serveurs n’exposent pas d’empreinte des poids : changez `EMBEDDING_REVISION` à chaque changement de poids, puis réindexez.

Le backend `openai` a été vérifié en direct contre l’API `/v1` compatible OpenAI d’Ollama : génération structurée, embeddings en 1024 dimensions et transcription d’une page manuscrite. Il n’a pas été exécuté contre vLLM.

## Secrets et production

Les valeurs par défaut de `compose.documents.yml` ne conviennent qu’à un poste de développement : mot de passe PostgreSQL `neurvia-local-db`, secret S3 `neurvia-local-object-password` et `JWT_SECRET` de Compose. Avec `APP_ENV=production`, l’API refuse de démarrer si elle détecte l’une de ces valeurs.

Pour une installation réelle :

- Fournissez `NEURVIA_POSTGRES_PASSWORD`, `NEURVIA_DATABASE_URL`, `DOCUMENT_S3_ACCESS_KEY`, `DOCUMENT_S3_SECRET_KEY` et `JWT_SECRET` (au moins 32 octets) via un gestionnaire de secrets ou un fichier `.env` hors dépôt. `.env*` est exclu du contexte Docker.
- Utilisez un stockage S3 géré ou un SeaweedFS durable avec réplication. L’instance `weed mini` de Compose n’a qu’un volume.
- Gardez le bucket privé. L’application ne génère pas d’URL présignée. Chaque lecture d’objet passe par une vérification d’accès relationnelle, puis par un flux `Cache-Control: private, no-store`.
- Placez l’API derrière le proxy Next.js ou un reverse proxy TLS. Ne publiez pas PostgreSQL ni S3 hors du réseau privé.
- Limitez la taille des requêtes sur le reverse proxy, par exemple à `DOCUMENT_MAX_UPLOAD_MB` plus 1 Mo. L’API refuse un PDF trop gros, mais seulement après la réception du corps multipart. Le proxy Next.js ne bloque que les requêtes qui annoncent un `Content-Length` supérieur à 65 Mo.

## Contrôle d’accès

- Chaque classe appartient à un tenant (`classroom_tenants`). C’est soit l’établissement choisi à la création de la classe, soit un espace enseignant personnel créé à la première utilisation.
- Toutes les requêtes sur les documents filtrent par établissement, classe et séance, et vérifient que le professeur possède la classe et appartient à l’établissement. Une ressource hors périmètre répond `404`, jamais `403`, pour ne pas révéler son existence.
- Les étudiants n’ont aucun accès aux documents ni à l’assistant (`403`).
- Les clés d’objets sont préfixées par `institution/{id}/classroom/{id}/lesson/{id}`.
- Taxonomie : les notions de référence restent globales. Une notion validée par un professeur appartient à son établissement. Les professeurs de cet établissement la voient et peuvent l’utiliser dans les classes de l’établissement. Un étudiant ne la voit que via une séance publiée d’une classe qu’il a rejointe. Être membre d’une classe ne révèle pas les notions préparées pour une autre classe du même professeur.
- Limites par professeur et par minute : 30 imports, 60 recherches, 12 messages, 10 extractions de brief, 12 générations de quiz. Au-delà, l’API répond `429`. La clé est l’identifiant du professeur, car tous les navigateurs partagent l’adresse du proxy Next.js.

## Établissements

Les établissements sont provisionnés par un opérateur, pas par l’interface :

```powershell
cd apps/api
# Créer un établissement et y rattacher des comptes professeurs existants
.\.venv\Scripts\python.exe -m tools.provision_institution --name "Université X" prof1@univ.example prof2@univ.example
# Rattacher d’autres professeurs à un établissement existant
.\.venv\Scripts\python.exe -m tools.provision_institution --institution <uuid> prof3@univ.example
```

L’outil exige PostgreSQL et des comptes professeurs non fictifs. Il est idempotent pour un membre déjà rattaché. Un professeur rattaché voit le choix **Établissement** à la création d’une classe. Une classe existante garde son tenant.

## Relecture, réindexation et révisions de modèle

- Chaque correction de bloc incrémente la révision de la version. Les travaux et les modifications concurrentes portant une révision obsolète sont rejetés (`409 DOCUMENT_CHANGED`). Le texte extrait d’origine reste consultable à côté de la correction.
- **Réindexer** relance l’indexation d’un document prêt avec une nouvelle révision. Pendant ce temps, le document n’est plus sélectionnable pour l’assistant ni pour le quiz (`409 DOCUMENT_NOT_INDEXED`). La nouvelle révision est publiée de façon atomique à la fin du travail.
- La version du modèle d’embedding est enregistrée sous la forme `tag@digest` avec Ollama, ou `openai:<modèle>@<EMBEDDING_REVISION>` avec un serveur compatible OpenAI. Après un changement de modèle, les documents indexés avec l’ancien modèle restent consultables en recherche lexicale seule (`mode: lexical`) pour éviter de comparer deux espaces vectoriels. Réindexez-les pour revenir au mode hybride.
- Pour réindexer en lot après un changement de modèle, utilisez l’outil ci-dessous. Chaque document mis en file sort de la recherche jusqu’à la fin de son indexation, d’où le traitement par lots :

  ```powershell
  .\.venv\Scripts\python.exe -m tools.reindex_documents --dry-run     # compter les documents à réindexer
  .\.venv\Scripts\python.exe -m tools.reindex_documents --limit 50    # relancer jusqu’à « queued now: 0 »
  .\.venv\Scripts\python.exe -m tools.reindex_documents --all         # tout réindexer, par exemple après un changement d’extraction
  ```
- Une question publiée garde ses citations. La publication et la modification d’un item fondé exigent que les sources n’aient pas changé depuis la génération (`409 COURSE_SOURCES_CHANGED`).

## Worker : reprise et erreurs

- Les travaux sont stockés en base. Le worker réserve un travail avec `FOR UPDATE SKIP LOCKED` et un bail de 5 minutes renouvelé à chaque page ou lot d’embeddings. Plusieurs workers peuvent tourner sans se gêner.
- Une erreur temporaire (Ollama ou S3 indisponible, par exemple) remet le travail en file avec une attente de `4^tentative` secondes, plafonnée à 5 minutes. L’interface affiche « Nouvelle tentative automatique ». Au-delà de `DOCUMENT_JOB_RETRIES`, la version passe à `failed`.
- Les erreurs définitives (`invalid_pdf`, `encrypted_or_page_limit`) échouent immédiatement. Le bouton **Relancer** crée une nouvelle révision et relance l’extraction ou l’indexation.
- Un worker interrompu laisse expirer son bail, et un worker reprend ensuite le travail. Chaque reprise compte comme une tentative.

## Sauvegarde et restauration

La base et le bucket se sauvegardent ensemble. L’application n’efface aucun objet : un rendu de page est écrit sous un préfixe propre à chaque tentative, puis référencé par la base. Sauvegardez donc **d’abord PostgreSQL, puis le bucket**. Le bucket sera un sur-ensemble des objets référencés.

```powershell
docker compose -f compose.documents.yml exec -T db pg_dump -U neurvia -Fc neurvia > neurvia.dump
# Puis copiez le bucket avec un client S3, par exemple
aws --endpoint-url http://127.0.0.1:59000 s3 sync s3://neurvia-documents ./neurvia-documents-backup
```

Restaurez le bucket avant la base. Testez périodiquement la restauration dans un environnement séparé. Les rendus des tentatives abandonnées restent dans le bucket. Prévoyez un nettoyage hors ligne si le volume le justifie, en comparant les clés au contenu de `document_pages.image_key` et `document_blocks.image_key`.

## Import d’une installation SQLite

L’outil `tools.migrate_sqlite` copie une installation SQLite arrêtée (ou un instantané) vers une base PostgreSQL vide et migrée :

```powershell
$env:DATABASE_URL = "postgresql+psycopg://neurvia:<mot de passe>@127.0.0.1:55432/neurvia"
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m tools.migrate_sqlite C:\chemin\fahm.db
```

Le fichier source est ouvert en lecture seule et n’est pas modifié. L’outil refuse une cible non migrée ou contenant déjà des données, un fichier SQLite corrompu (`PRAGMA quick_check`), des clés étrangères invalides, une base qui n’est pas Neurvia, et une base SQLite contenant déjà des documents (utilisez alors les sauvegardes PostgreSQL et S3). La copie se fait dans une seule transaction, et le nombre de lignes est vérifié pour chaque table.

## Observabilité

Les journaux de l’API et du worker contiennent des événements structurés, sans prompt ni contenu de document :

- `course_retrieval mode=… selected_documents=… hits=… elapsed_ms=…`
- `document_job_finished kind=… elapsed_ms=…` et `document_job_failed kind=… state=… reason=… attempt=…`
- `document_vision model=… input_tokens=… output_tokens=… elapsed_ms=…`
- `llm task=… model=… ms=…` pour le chat, le brief, la génération et la vérification
- `course_question_rejected reason=…` pour un item refusé par les contrôles

`GET /lessons/{id}/documents/usage` donne l’occupation du stockage d’une séance. Pour suivre la file :

```sql
SELECT kind, state, count(*), max(attempts) FROM document_jobs GROUP BY kind, state;
```

## Évaluation de la recherche

```powershell
cd apps/api
.\.venv\Scripts\python.exe -m tools.check_documents --web http://localhost:3151   # parcours complet en direct
.\.venv\Scripts\python.exe -m tools.check_documents --corpus <dossier de PDF> `
  --expectations tools\eval\mit-ocw-expectations.json --accept-extraction --report rapport.json
```

`tools/eval/mit-ocw-expectations.json` contient 21 requêtes (16 en anglais, 5 en français) sur trois transcriptions MIT OpenCourseWare (`mit-lists.pdf`, `mit-while.pdf`, `mit-break.pdf`). Les PDF ne sont pas versionnés. Placez-les dans le dossier `--corpus`. `--accept-extraction` confirme tels quels les blocs signalés, ici le logo de la première page, et ne sert qu’à l’évaluation.

| Configuration | Recall@1 | Recall@5 | MRR@5 |
| --- | --- | --- | --- |
| Fusion initiale | 0,667 | 0,857 | 0,740 |
| Sans mots-outils dans la requête lexicale, une page par résultat | 0,714 | 1,000 | 0,837 |

Les mots-outils (anglais et français) dominaient le classement lexical avec la configuration `simple`. Ce corpus est petit et a servi au réglage. Ajoutez des requêtes sur vos propres cours avant de conclure sur la qualité de la recherche.

## Capacité et limites

- Le matériel validé est un GPU portable GeForce RTX 4060 avec 8 Go. Qwen3.5-9B et l’embedding partagent cette mémoire, et Ollama sérialise les requêtes. Chaque réponse de chat demande deux appels au modèle (réponse puis vérification), et chaque question générée en demande au moins deux. Les durées dépendent du nombre de passages et de l’état du cache de modèles d’Ollama. Aucune charge concurrente n’a été mesurée. Prévoyez une file d’attente perceptible au-delà d’un ou deux professeurs actifs en même temps, ou un serveur d’inférence dédié.
- Le worker Compose est limité à 2 CPU et 2 Go. La vision est l’étape la plus lente d’un scan : elle traite une page à la fois.
- Les transactions d’écriture qui vérifient puis modifient (tentatives, réponses, publication, travaux du worker) sont sérialisées sur PostgreSQL par un verrou consultatif de transaction, comme `BEGIN IMMEDIATE` le faisait sur SQLite. Les appels aux modèles et les traitements de PDF restent hors de ces transactions. Ce choix garantit le comportement existant des parcours F1–F5. Si le débit d’écriture devient un goulot d’étranglement, remplacez ce verrou global par des verrous de ligne, route par route.
- La transcription manuscrite n’a été vérifiée que sur un tracé synthétique. Elle n’établit pas la qualité sur une écriture réelle quelconque, d’où la relecture obligatoire.
- L’OCR couvre l’anglais, le français et l’arabe. La recherche plein texte utilise la configuration `simple`, sans racinisation, pour traiter ces langues avec un seul index.

## Dépannage

| Symptôme | Cause probable | Action |
| --- | --- | --- |
| L’API ne démarre pas : « Run alembic upgrade head » | Base PostgreSQL non migrée ou en retard | `docker compose -f compose.documents.yml run --rm migrate` |
| `503 DOCUMENT_STORAGE_UNAVAILABLE` | Endpoint S3 absent ou injoignable | Vérifiez `DOCUMENT_S3_*` et le service `objects` |
| Document bloqué à `queued` avec « Nouvelle tentative automatique » | Ollama ou S3 indisponible côté worker | `docker compose … logs worker`, puis `ollama ps` sur l’hôte |
| Document à `review` | Bloc OCR, vision ou figure à relire | Ouvrez **Voir les pages**, corrigez ou confirmez chaque bloc, puis **Valider et indexer** |
| Recherche en `mode: lexical` | Modèle d’embedding changé ou Ollama indisponible | Réindexez les documents ou rétablissez le modèle |
| `409 COURSE_EVIDENCE_INSUFFICIENT` à la génération | Aucun item n’a passé la vérification des citations | Sélectionnez d’autres documents ou précisez le brief |
| `409 TAXONOMY_REVIEW_REQUIRED` | La séance n’a pas de notion avec des erreurs diagnostiques | Validez une notion dans la section documents de la séance |
| `429` | Limite par professeur atteinte | Attendez une minute |
