#!/usr/bin/env bash
# Install the release APK on the connected phone (keeps data) and answer Google Play Protect's
# "Send app for a security check?" prompt with "Don't send", so no one has to touch the phone.
#
# The button is found by its text in the screen's UI tree (uiautomator) and tapped at its exact
# position; nothing else is ever tapped. The phone must be unlocked.
#
# Usage (Git Bash): scripts/install-apk.sh [path/to/app.apk]
set -u
export MSYS_NO_PATHCONV=1
ADB="${ADB:-$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe}"
APK="${1:-android/app/build/outputs/apk/release/app-release.apk}"
PKG=dev.mtgpricescanner.app

[ -f "$APK" ] || { echo "APK not found: $APK"; exit 1; }

"$ADB" install -r "$APK" > /tmp/mtg-install.log 2>&1 &
INSTALL=$!

# Poll for the prompt while the install runs (it appears a few seconds in, or not at all).
for _ in $(seq 1 60); do
  kill -0 "$INSTALL" 2>/dev/null || break
  "$ADB" shell uiautomator dump /sdcard/mtg-ui.xml > /dev/null 2>&1
  UI=$("$ADB" shell cat /sdcard/mtg-ui.xml 2>/dev/null)
  if grep -q 'package="com.android.vending"' <<< "$UI"; then
    BOUNDS=$(tr '>' '\n' <<< "$UI" | grep "text=\"Don't send\"" | grep -o 'bounds="[^"]*"' | head -1)
    if [ -n "$BOUNDS" ]; then
      read -r X1 Y1 X2 Y2 <<< "$(grep -o '[0-9]\+' <<< "$BOUNDS" | tr '\n' ' ')"
      echo "Play Protect prompt: tapping \"Don't send\" at $(((X1 + X2) / 2)),$(((Y1 + Y2) / 2))"
      "$ADB" shell input tap $(((X1 + X2) / 2)) $(((Y1 + Y2) / 2))
    fi
  fi
  sleep 1
done

wait "$INSTALL"
STATUS=$?
cat /tmp/mtg-install.log
"$ADB" shell rm -f /sdcard/mtg-ui.xml
"$ADB" shell dumpsys package "$PKG" | grep -m1 versionName
exit $STATUS
