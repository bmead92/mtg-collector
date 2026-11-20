#!/usr/bin/env bash
# Prints the lines for a release's notes: the APK's SHA-256 and its signing certificate's SHA-256.
set -euo pipefail
apk="${1:-android/app/build/outputs/apk/release/app-release.apk}"
sdk="${ANDROID_HOME:-${LOCALAPPDATA:-}/Android/Sdk}"
apksigner="$(ls -d "$sdk"/build-tools/*/ | sort -V | tail -1)apksigner.bat"
[ -f "$apksigner" ] || apksigner="${apksigner%.bat}"
echo "APK SHA-256: $(sha256sum "$apk" | cut -d' ' -f1)"
echo "Signing certificate SHA-256: $("$apksigner" verify --print-certs "$apk" | sed -n 's/.*certificate SHA-256 digest: //p' | head -1)"
