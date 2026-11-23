# AutoChapp — Backend

Flask / PostgreSQL 16 / Baileys multi-session. Source de départ : archives Flask et Baileys fournies par l'utilisateur, restructurées pour fournir un flux unifié.

## Démarrage
```bash
cp .env.example .env
# Modifiez les 3 secrets CHANGE_THIS avant le lancement; ajoutez AI_API_KEY pour les réponses IA.
docker compose up --build -d
docker compose ps
curl http://localhost:5888/health
```
L'API écoute uniquement sur **127.0.0.1:5888** (sécurisée par défaut). PostgreSQL et Baileys ne publient aucun port hôte. En déploiement public utilisez HTTPS + reverse proxy et restreignez les accès.

## API
`POST /api/auth/register` {name,email,password} ; `POST /api/auth/login` {email,password} ; `POST /api/auth/google` {credential} (nécessite GOOGLE_CLIENT_ID) ; `GET /api/me`.

Routes protégées : `GET/POST /api/accounts`, `GET /api/accounts/:id/qr` (démarre la session), `GET /api/accounts/:id/status`, `DELETE /api/accounts/:id`, `GET /api/conversations?account_id=`, `PATCH /api/conversations/:id/settings`, `GET/POST /api/conversations/:id/messages` (body {content}). `GET /health` public. Toutes les routes protégées exigent `Authorization: Bearer JWT`.

Modes : `manual` = humain, `ai` = IA sur messages texte entrants, `hybrid` = réponses automatiques selon `hybrid_rule` (`keywords`, `outside_hours`) ou validation humaine (`always_draft`, aucune réponse automatique). Configuration : `{mode,instructions,hybrid_rule,keywords,business_hours,cooldown_seconds}`. Plages horaires évaluées en UTC. En l'absence de AI_API_KEY, pas de réponse automatique (aucune réponse factice).

Pour scanner, rafraîchir `GET /api/accounts/:id/status` après `GET /qr`, et afficher le champ `qr` (image data URL). Lier depuis WhatsApp > Appareils connectés.

## Limites et sécurisation production
- Baileys utilise un protocole non officiel, susceptible de provoquer déconnexions, restrictions ou changements incompatibles. Ne pas utiliser pour envoi en masse ni spam. Pour entreprises, évaluer Meta WhatsApp Business Platform / Cloud API.
- Les messages texte directs sont supportés ; groupes, médias, messages historiques et pièces jointes ne sont pas gérés.
- Les migrations de schéma, workers/queues fiables, chiffrement des sessions au repos, limitation de débit, surveillance et politique RGPD doivent être ajoutés avant production.
- Les réponses IA nécessitent une clé d'un fournisseur compatible OpenAI, et les textes de messages lui sont envoyés ; informer les utilisateurs et obtenir les consentements nécessaires.
- Les messages entrants sont transmis directement par callback ; en forte charge, utiliser une queue asynchrone avec retries.

## Tests
`python -m pip install -r requirements.txt && python -m pytest -q` depuis ce dossier. Pour un test intégré, disposer de Docker Engine + plugin Compose et lancer `docker compose up --build`.
