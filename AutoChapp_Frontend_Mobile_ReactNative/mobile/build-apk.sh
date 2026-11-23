#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
echo '== AutoChapp APK (Expo/React Native) =='
command -v node >/dev/null || { echo 'Node.js 20+ requis'; exit 1; }
command -v npm >/dev/null || { echo 'npm requis'; exit 1; }
if [[ ! -d node_modules ]]; then npm install; fi
if [[ "${1:-}" == '--cloud' ]]; then
  echo 'Compilation cloud EAS : un compte Expo connecté est nécessaire.'
  npx eas-cli build --platform android --profile preview
  echo 'Récupérez le lien APK dans la sortie EAS.'
else
  echo 'Compilation APK LOCALE : Linux + Java 17 + Android SDK + ANDROID_HOME requis.'
  command -v java >/dev/null || { echo 'Java manquant';exit 1; }
  [[ -n "${ANDROID_HOME:-}" ]] || { echo 'ANDROID_HOME manquant. Exemple: export ANDROID_HOME=$HOME/Android/Sdk';exit 1; }
  [[ -d "$ANDROID_HOME" ]] || { echo "SDK Android absent: $ANDROID_HOME";exit 1; }
  npx expo prebuild --platform android --no-install
  (cd android && chmod +x gradlew && ./gradlew assembleRelease)
  mkdir -p dist
  cp android/app/build/outputs/apk/release/app-release.apk dist/autochapp-release-unsigned.apk
  echo 'APK non signé disponible dans dist/autochapp-release-unsigned.apk'
  echo 'ATTENTION: cette compilation release peut exiger une configuration de signature Android avant installation / publication.'
fi
