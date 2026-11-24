#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
umask 077
setup=0
allow_http=0
while (($#)); do
  case "$1" in
    --setup) setup=1; shift ;;
    --api-url) export EXPO_PUBLIC_API_URL="$2"; shift 2 ;;
    --allow-http) allow_http=1; shift ;;
    *) echo "Usage: bash build-apk.sh [--setup] [--api-url https://api.example.com] [--allow-http]"; exit 2 ;;
  esac
done
if [[ $(uname -m) != x86_64 ]]; then echo "Build local prévu pour Linux x86_64."; exit 1; fi
for cmd in node npm java javac keytool curl unzip sha256sum; do
  command -v "$cmd" >/dev/null || { echo "Prérequis absent: $cmd (Node >=20.19.4, JDK 17, curl, unzip)"; exit 1; }
done
node -e 'const [a,b,c]=process.versions.node.split(".").map(Number);if(a<20||(a===20&&(b<19||(b===19&&c<4))))process.exit(1)' || { echo 'Node >=20.19.4 requis'; exit 1; }
javac -version 2>&1 | grep -Eq '^javac 17([.]|$)' || { echo 'JDK 17 requis (sélectionnez JAVA_HOME/PATH)'; exit 1; }
export JAVA_HOME="${JAVA_HOME:-$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
export CI=1
export EXPO_PUBLIC_API_URL="${EXPO_PUBLIC_API_URL:-}"
if [[ "$EXPO_PUBLIC_API_URL" == http://* && $allow_http != 1 ]]; then
  echo 'API HTTP interdite par défaut. Utiliser HTTPS ou --allow-http pour un test isolé.'; exit 1
fi
if [[ -n "$EXPO_PUBLIC_API_URL" && "$EXPO_PUBLIC_API_URL" != https://* && "$EXPO_PUBLIC_API_URL" != http://* ]]; then echo 'URL API invalide';exit 1;fi
export AUTOCHAPP_ALLOW_HTTP="$allow_http"
sdk="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
if [[ $setup == 1 ]]; then
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  if [[ ! -x "$sdk" ]]; then
    temp=$(mktemp -d)
    trap 'rm -rf "$temp"' EXIT
    curl --fail --location --retry 3 https://dl.google.com/android/repository/commandlinetools-linux-15859902_latest.zip -o "$temp/tools.zip"
    printf '%s  %s\n' '4e4c464f145a7512b57d088ac6c278c03c9eea610886b35a5e0804e74eedf583' "$temp/tools.zip" | sha256sum -c -
    unzip -q "$temp/tools.zip" -d "$temp"
    mv "$temp/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
  fi
  echo 'Acceptez les licences Android SDK lorsque demandé.'
  "$sdk" --sdk_root="$ANDROID_HOME" --licenses
  "$sdk" --sdk_root="$ANDROID_HOME" 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0' 'ndk;27.1.12297006' 'cmake;3.22.1'
fi
[[ -x "$sdk" && -f "$ANDROID_HOME/platforms/android-36/android.jar" && -x "$ANDROID_HOME/build-tools/36.0.0/apksigner" ]] || { echo 'SDK absent ou incomplet. Relancez avec --setup.'; exit 1; }
# Preserve the signing identity outside the repository across builds.
key_dir="${AUTOCHAPP_KEY_DIR:-$HOME/.config/autochapp/android}"
mkdir -p "$key_dir"; chmod 700 "$key_dir"
key="$key_dir/autochapp.p12"; password_file="$key_dir/password"
if [[ ! -f "$key" ]]; then
  command -v openssl >/dev/null || { echo 'openssl requis pour créer la clé';exit 1; }
  [[ -f "$password_file" ]] || openssl rand -hex 24 > "$password_file"
  keytool -genkeypair -storetype PKCS12 -keystore "$key" -alias autochapp -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=AutoChapp' -storepass:file "$password_file" -keypass:file "$password_file"
fi
[[ -s "$password_file" ]] || { echo 'Mot de passe de la clé introuvable : ne recréez pas la clé.';exit 1; }
chmod 600 "$key" "$password_file"
echo 'Empreinte à enregistrer dans Google Cloud (client OAuth Android, com.autochapp.mobile):'
keytool -list -v -keystore "$key" -alias autochapp -storepass:file "$password_file" | grep -E 'SHA1:|SHA256:' || true
# npm install reconciles the pre-existing lockfile with the new dependencies.
npm install --no-audit --no-fund
npx expo prebuild --platform android --clean --no-install
printf 'sdk.dir=%s\n' "$ANDROID_HOME" > android/local.properties
jobs="${GRADLE_WORKERS:-2}"
abis="${ANDROID_ABIS:-arm64-v8a,armeabi-v7a}"
(cd android && chmod +x gradlew && ./gradlew --no-daemon --max-workers="$jobs" -PreactNativeArchitectures="$abis" assembleRelease)
apk=$(find android/app/build/outputs/apk/release -maxdepth 1 -name '*.apk' -print -quit)
[[ -n "$apk" ]] || { echo 'APK release introuvable';exit 1; }
mkdir -p dist
tools="$ANDROID_HOME/build-tools/36.0.0"
"$tools/zipalign" -P 16 -f 4 "$apk" dist/aligned.apk
AUTOCHAPP_SIGN_PASSWORD="$(< "$password_file")" "$tools/apksigner" sign --ks "$key" --ks-key-alias autochapp --ks-pass env:AUTOCHAPP_SIGN_PASSWORD --key-pass env:AUTOCHAPP_SIGN_PASSWORD --out dist/autochapp.apk dist/aligned.apk
rm -f dist/aligned.apk
"$tools/apksigner" verify --verbose --print-certs dist/autochapp.apk
sha256sum dist/autochapp.apk
echo "APK signé : $PWD/dist/autochapp.apk"
echo "Conservez la clé et son mot de passe dans $key_dir (hors Git)."
