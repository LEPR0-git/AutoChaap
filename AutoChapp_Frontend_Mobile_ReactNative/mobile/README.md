# AutoChapp Mobile — React Native / Expo

## Démarrage
`npm install && npx expo start` (Expo Go ou émulateur Android). Par défaut l'API est `http://10.0.2.2:5888` pour l'émulateur Android. Sur téléphone physique, ouvrez **Profil > Adresse du backend** et utilisez `https://votre-domaine-api` (HTTPS public recommandé). Le backend par défaut n'expose que 127.0.0.1 : configurez un reverse proxy sécurisé pour l'accès distant.

## APK
`bash build-apk.sh` : build local via Expo prebuild et Gradle, nécessite Java 17, Android SDK, `ANDROID_HOME`, Gradle/network pour les premières dépendances. APK de sortie `dist/autochapp-release-unsigned.apk` si réussi ; configurez votre signature Android et vérifiez l'APK avant distribution. Alternative : `bash build-apk.sh --cloud` utilise Expo EAS Build, qui exige connexion à un compte Expo ; un lien APK est retourné par EAS. Le zip fourni ne contient pas d'APK précompilé.

## Fonctionnalités
Connexion/inscription JWT, comptes WhatsApp et QR, liste des conversations, envoi/réception texte, réglages IA/hybride par conversation, réglage de l'adresse API. L'authentification Google mobile native n'est pas implémentée (elle nécessite des identifiants Android OAuth et deep links propres à l'application). Scanner le QR sur un second appareil via WhatsApp Appareils connectés ; le téléphone ne peut pas scanner son propre écran.

Ne pas exposer une API HTTP sans TLS en production ; `usesCleartextTraffic` est activé uniquement pour les essais réseau local. Pour un produit public, désactiver cette option et activer HTTPS.
