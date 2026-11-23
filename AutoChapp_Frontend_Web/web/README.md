# AutoChapp — Interface web Vue 3

## Docker
`cp .env.example .env && docker compose up --build -d` puis ouvrir http://localhost:8188.
L'API est disponible sur http://localhost:5888 si le backend est démarré. Les ports sont exposés uniquement sur loopback (développement local).

## Sans Docker
`npm install && npm run dev`. Pour un déploiement distant, configurez `VITE_API_URL` vers une URL HTTPS joignable par le navigateur, et `CORS_ORIGINS` côté API. Google Sign-In nécessite `VITE_GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_ID` identiques, un projet Google OAuth et les origines autorisées (puis reconstruire le frontend).

Page d'authentification, tableau de bord, connexion QR multi-compte, messagerie, modes manuel/IA/hybride et formulaires de règles. Les conversations ne sont créées qu'après arrivée d'un message WhatsApp ; cette interface ne crée pas artificiellement de contacts.
