# AutoChapp — État des vérifications au 23/11/2026

## Vérifié ici
- Fichiers des trois archives d'origine lus et comparés aux composants créés.
- `python -m compileall` : compilation syntaxique des modules Python OK.
- `node --check` : syntaxe du connecteur WhatsApp (bridge/server.js) et du bootstrap Vue OK.
- Archives ZIP : structure et CRC intégralement contrôlés lors de l'export.

## Non exécuté (limitations de l'environnement)
- Docker Engine / Docker Compose non installés. Aucun démarrage PostgreSQL / API / bridge / web dans Docker n'a été réalisé.
- Internet des outils locaux indisponible (échec DNS), ce qui empêche `pip install`, `npm install`, et la compilation Vite / Expo / APK.
- Les tests Python sous `backend/tests` sont fournis mais n'ont pas été exécutés pour manque de Flask / Flask-SQLAlchemy.
- Connexion QR à un compte WhatsApp réel, envoi réel, OAuth Google et appel LLM réel non testés. Ces services requièrent comptes/clé autorisés.

## Points à réaliser avant mise en production
- Tests unitaires et intégration `docker compose up --build`, test QR réel et flux bout-en-bout.
- Changer tous les secrets et activer HTTPS. Corriger et sécuriser la chaîne de publication mobile. Protéger / chiffrer les sessions Baileys persistées.
- Ajouter migrations BDD, journal d'audit, backpressure/queue messages, retries et déduplication, gestion des taux limites, validation des prompts, consentement à l'envoi des messages à un LLM.
- Les modes `manual`, `ai`, `hybrid` gèrent les messages texte individuels seulement. La règle `always_draft` est un mode sans réponse automatique, pas une génération/validation de brouillon. Les heures de bureau sont en UTC.
- Le script d'APK est une recette de build, il ne remplace pas l'Android SDK (local) ni un compte Expo (EAS Cloud).
