# Intégration FastAPI et Next.js

[Contrat OpenAPI](openapi.json) · [Types générés](api-types.d.ts)

La source de vérité est le schéma servi à `/openapi.json`. Les routes métier utilisent `/api/v1`. Le navigateur passe par Next.js `/backend`, qui conserve le JWT dans un cookie HttpOnly, contrôle l’origine des écritures et envoie un jeton Bearer à FastAPI. Les routes d’administration `/dev/*` sont accessibles directement sur FastAPI avec le secret de démo et un environnement de démonstration.

## Correspondance des parcours

| Écran | API | Données |
| --- | --- | --- |
| Connexion, inscription, espace de compte | `POST /auth/register`, `POST /auth/login`, `GET /me` | Users et jeton vérifié par FastAPI |
| Classes et adhésion par lien ou QR | `GET/POST /classrooms`, `POST /classrooms/join`, `POST /classrooms/{id}/join-code`, `GET /classrooms/{id}/members` | Classes, codes à durée limitée, membres et pseudonymes |
| Banque pédagogique | `GET /taxonomy`, `GET/POST /bank/questions`, `POST /bank/questions/{id}/approve` | Taxonomie et questions approuvées par le professeur pour chaque étape |
| Séances et éditeur | `GET/POST /classrooms/{id}/lessons`, `GET/PATCH /lessons/{id}`, `POST /lessons/{id}/quiz/generate`, `/quizzes/{id}/*` | Brouillons versionnés, items, publication et fermeture |
| Activités, cours et progression étudiant | `GET /me/tasks`, `GET /me/feedback`, `GET /me/interventions`, `GET /classrooms/{id}/lessons` | Activités dues ou à venir, remédiations et corrections du porteur du jeton |
| Quiz et confirmation | `POST /quizzes/{id}/attempts`, `POST /attempts/{id}/answers`, `POST /attempts/{id}/submit`, `GET /attempts/{id}/feedback`, `GET/POST /attempts/{id}/confirmation` | Tentatives, options choisies, confiance, observations, hypothèses et résultats |
| Accueil professeur et MindMirror | `GET /lessons/{id}/dashboard`, `GET /lessons/{id}/graph` | Priorités et participation calculées, profils pseudonymisés et arêtes Jaccard |
| Groupes, remédiation et retests | `POST /lessons/{id}/groups/suggest`, `GET /lessons/{id}/groups`, `PATCH /groups/{id}`, `POST /groups/{id}/remediation`, `PATCH /interventions/{id}`, `POST /interventions/{id}/assign`, `POST /lessons/{id}/retest`, `GET /lessons/{id}/before-after`, `GET /me/retests`, `POST /lessons/{id}/j7/schedule` | Propositions de groupes, décisions enseignant, plans, exercices individuels et comparaison avec effectifs |
| Simulation | `POST /demo/advance`, `POST /dev/seed`, `POST /dev/clock/advance`, `POST /dev/clock/reset` | Jeu synthétique et horloge indépendante |

## Décisions d’intégration

- L’interface Next.js reste à la racine. Le backend existant est repris sous `apps/api`. Le tracé SVG de la constellation du frontend est conservé. Il reçoit les nœuds et arêtes calculés par FastAPI. Il dessine les arêtes provisoires en pointillés.
- La banque de référence fournie reste en brouillon. Un professeur approuve ses propres copies des items. Les données persistées de la démo sont signalées et utilisent les mêmes routes métier. Une erreur seule donne une hypothèse. Le moteur déduplique le contenu d’item pour la corroboration et exclut du regroupement les profils avec moins de quatre réponses initiales.
- Le score de priorité utilise le nombre d’étudiants concernés, multiplié par `1 + poids × part d’erreurs confiantes`. Le regroupement utilise Jaccard et average linkage avec taille minimale de trois. Les profils corroborés alimentent le premier passage, et les profils restants peuvent produire des suggestions provisoires.
- Les retests et la relance sont attribués à des étudiants précis. La sélection exclut les items déjà présentés ou réservés à cet étudiant dans la séance. Le calendrier stocke les heures UTC. Le navigateur affiche les dates dans le fuseau `Africa/Tunis`. Les résultats restent descriptifs.
- Pydantic contrôle les schémas et les durées. Le cache Ollama conserve les résultats validés et un hachage de la demande. En exécution avec Uvicorn, les logs de génération indiquent le modèle, la durée et les compteurs de tokens disponibles. Les prompts et les réponses brutes n’apparaissent pas dans ces logs.

## Requêtes clés

```json
{"title":"Les indices Python","content_text":"Les indices non négatifs vont de zéro à n−1.","concept_codes":["C_INDEXING"],"focus_brief":{"question_count":4,"difficulty":1,"pitfalls":["Dernier indice"]}}
```

La publication du quiz et l’affectation du plan attendent chacune `{"validated":true}`.

```json
{"question_id":"<uuid>","option_id":"<uuid>","confidence":"sure"}
```

Réponse type d’accès refusé ou de ressource inaccessible.

```json
{"error":{"code":"RESOURCE_NOT_FOUND","message":"Ressource introuvable."}}
```
