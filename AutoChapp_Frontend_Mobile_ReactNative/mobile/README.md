# AutoChapp Mobile (Android)
React Native / Expo SDK 54. Utilise le backend de la branche feature/workspace-auth-rag.
## Compiler sur Linux x86_64 sans Android Studio
Prérequis : Node.js >= 20.19.4, JDK 17, curl, unzip, openssl, accès Internet, espace disque suffisant.
```bash
bash build-apk.sh --setup --api-url https://api.votre-domaine.cm
```
Le premier build installe le SDK après acceptation des licences, génère une clé de signature persistante, compile un APK autonome et vérifie sa signature. Les suivants peuvent omettre --setup. Sortie : dist/autochapp.apk.
Pour un environnement de test HTTP isolé uniquement : --allow-http --api-url http://adresse:5888. Ne jamais utiliser HTTP pour des comptes réels sur Internet. Sans --api-url, configurer le serveur depuis l'écran de connexion. localhost du téléphone n'est pas le localhost du VPS.
L'installation npm met à jour localement package-lock.json (le lockfile n'a pas été régénéré sur GitHub). Ne pas committer ces modifications non vérifiées. Conserver la clé et le fichier password dans ~/.config/autochapp/android et les sauvegarder de façon chiffrée ; la même clé est nécessaire pour mettre à jour l'application.
## Google OAuth Android
Le client Web est fourni par /api/auth/config. Dans le même projet Google Cloud, créer un client OAuth **Android** avec package com.autochapp.mobile et SHA-1 affiché par le script. Pour Google Play App Signing, enregistrer aussi le certificat de signature Play. Aucun secret client dans l'APK. Google Sign-In natif requiert un APK compilé, pas Expo Go. Les anciens utilisateurs gardent la connexion par mot de passe et peuvent lier leur compte en confirmant leur mot de passe.
## Fonctions
Conversations triées, badges non lus, aperçus, filtres, onglets, une mini-fenêtre déplaçable, menu, animation de connexion, QR sur un autre appareil, modes IA/hybride, sources de connaissances (PDF textuel 5 Mo, texte, lien, téléphone, description d'image).
Pas de notification push Android en arrière-plan, pas de téléchargement automatique des pages web, pas d'analyse d'image ni OCR des scans. La mini-fenêtre reste interne à l'application.
## Vérification
Compilation Android et connexion Google/WhatsApp à valider sur le VPS et un appareil réel.
