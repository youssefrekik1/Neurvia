# Passation frontend · Phase 0

Base API locale `http://127.0.0.1:8000/api/v1`. [Démarrage du backend](../README.md) · [OpenAPI 3.1 avec exemples JSON](openapi.json) · [Types TypeScript générés](api-types.d.ts)

Le fichier OpenAPI décrit chaque méthode, chemin, paramètre, schéma de requête, schéma de réponse, authentification et erreurs. Les exemples de succès proviennent d’un appel exécuté contre l’API. Les exemples de chemins utilisent les identifiants de cet appel. Récupérer les identifiants de la session courante par les routes ci-dessous.

## Connexion et parcours enseignant

1. Envoyer le JSON `{"email":"prof.fahm@example.com","password":"FAHM-demo-2026"}` à `POST /auth/login`. Utiliser `Authorization: Bearer <access_token>` sur les routes métier. `GET /me` renvoie `role` et `is_synthetic`. Garder le jeton en mémoire côté navigateur. Une actualisation peut demander une nouvelle connexion.
2. Ouvrir `GET /classrooms`. La classe fictive est signalée par `is_synthetic=true`. L’ID stable de la séance fictive est `73f54f29-9287-5537-8238-74f7d1cd3959`. Il figure aussi dans les réponses de `GET /me/tasks` et `POST /dev/seed`.
3. Appeler `GET /taxonomy` pour les concepts et les codes d’erreur autorisés. Avec la séance fictive, `POST /lessons/{id}/quiz/generate` accepte `{"question_count":2}` pour créer un brouillon. Lire `questions` et `generation_mode`. L’envoi de `{"validated":true}` à `POST /quizzes/{id}/publish` publie le brouillon. Les actions d’édition opèrent sur les brouillons. L’erreur standard contient `error.code` et `error.message`.
4. `GET /lessons/{id}/dashboard` et `GET /lessons/{id}/graph?tau=0.4` exposent des exemples analytiques fictifs. Associer `nodes[].id`, `edges[].source` et `edges[].target` dans Cytoscape. `groups[].student_ids` contient les identifiants de membres pseudonymisés de la classe.
5. Récupérer le groupe via `GET /lessons/{id}/groups`, puis envoyer `{"action":"accept"}` à `PATCH /groups/{id}`. Générer le plan avec `POST /groups/{id}/remediation`, puis l’affecter avec `POST /interventions/{id}/assign` et `{"validated":true}`. Créer le retest avec `POST /lessons/{id}/retest` et `{"intervention_id":"<uuid>"}`.

## Parcours étudiant

1. Se connecter avec `eleve1.fahm@example.com` et le même mot de passe de démo. `GET /me/tasks` liste le quiz fictif prêt à l’emploi. `POST /quizzes/{id}/attempts` renvoie les choix et leurs IDs.
2. Envoyer une réponse par `POST /attempts/{id}/answers` avec `{"question_id":"<uuid>","option_id":"<uuid>","confidence":"sure"}`. Les autres valeurs de confiance sont `medium` et `unsure`. `POST /attempts/{id}/submit` enregistre la soumission simulée et retourne le feedback. Les clés de correction sont accessibles ensuite dans le feedback de l’étudiant concerné.
3. Pour voir la confirmation simulée, répondre aux quatre questions du quiz fictif avec le deuxième choix de la première question et le premier choix des trois suivantes. `GET /attempts/{id}/confirmation` renvoie alors une question distincte. Soumettre avec la même structure JSON. La réponse peut affaiblir ou corroborer l’hypothèse.
4. Une fois le retest affecté, le récupérer via `GET /me/retests`. Utiliser le même parcours de tentative. Après une réponse au retest et sa soumission, avancer de sept jours via `POST /dev/clock/advance` et `{"days":7}` depuis un outil autorisé. L’exercice différé apparaît dans les tâches de cet étudiant. Afficher les dates reçues en UTC dans le fuseau `Africa/Tunis` et afficher « Simulation » pour l’horloge démo.

## Disponibilité et autorisations

| Routes | Phase 0 |
| --- | --- |
| `GET /health` | Santé minimale publique, hors du préfixe métier |
| `/auth/*`, `/me`, `/classrooms*`, `/taxonomy`, `GET /lessons/{id}` | Base SQLite et autorisations réelles |
| Routes F2–F5 marquées « mock » dans OpenAPI | Scénario en mémoire, uniquement pour les comptes fictifs de départ et la séance fictive. Un redémarrage ou `POST /dev/seed` réinitialise le scénario |
| `/dev/*` | `DEMO_MODE=true` et en-tête `X-Demo-Secret`. Garder le secret côté outil local ou serveur de confiance |

Le quiz fictif permet quatre questions initiales et un parcours de confirmation, de retest et de J+7 sur un concept. Les tableaux Dashboard et Avant/après contiennent des valeurs fixes explicitement fictives. Les séances créées via SQLite restent en brouillon jusqu’à la Phase 1. Hors démo, les routes marquées « mock » répondent `501 PHASE_NOT_IMPLEMENTED` aux comptes du rôle attendu. Dans la démo, un compte extérieur au scénario reçoit `404`.

Codes d’erreur à traiter dans les vues. `401` pour une session absente ou expirée, `403` pour un rôle invalide, `404` pour une ressource introuvable ou hors du périmètre autorisé, `409` pour une action incompatible avec l’état de la ressource, `422` pour une requête invalide et `429` pour une limite de débit. L’API limite CORS aux origines configurées. Pour un autre port frontend, définir `CORS_ORIGINS` et redémarrer le serveur.

Première version du contrat. Les routes et les types devront continuer à évoluer ensemble. QR d’adhésion côté frontend à partir du `join_path` fourni par l’API. La rotation des codes d’adhésion et la persistance du workflow de quiz arrivent en Phase 1.
