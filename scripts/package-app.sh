#!/bin/bash
# Build JeanClawd.app (the desktop Jean-Claude) from the SwiftPM executable.
# Usage: ./scripts/package-app.sh   → dist/JeanClawd.app
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

echo "▸ building JeanClawd (release)…"
(cd JeanClawd && swift build -c release 2>&1 | grep -v "^\[" || true)
BIN="JeanClawd/.build/release/JeanClawd"
[ -x "$BIN" ] || { echo "build failed"; exit 1; }

echo "▸ rendering app icon from the sprite…"
"$BIN" --render-icon assets/AppIcon.iconset >/dev/null
iconutil -c icns assets/AppIcon.iconset -o assets/AppIcon.icns
cp assets/AppIcon.iconset/icon_32x32@2x.png web/favicon.png
cp assets/AppIcon.iconset/icon_256x256.png assets/icon-256.png

APP="dist/JeanClawd.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/jean"
cp "$BIN" "$APP/Contents/MacOS/JeanClawd"
cp assets/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
# Self-contained copy of the web app + server, used if the repo moves.
cp -R lib server web cli package.json "$APP/Contents/Resources/jean/"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleIdentifier</key><string>app.jeanclawd.pet</string>
    <key>CFBundleName</key><string>Jean Clawd</string>
    <key>CFBundleDisplayName</key><string>Jean Clawd</string>
    <key>CFBundleIconFile</key><string>AppIcon</string>
    <key>CFBundleExecutable</key><string>JeanClawd</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>0.1.0</string>
    <key>CFBundleVersion</key><string>1</string>
    <key>LSMinimumSystemVersion</key><string>13.0</string>
    <key>LSUIElement</key><true/>
    <key>NSHighResolutionCapable</key><true/>
    <key>JeanProjectPath</key><string>$ROOT</string>
</dict>
</plist>
PLIST

codesign --force --sign - "$APP" 2>/dev/null
echo "✓ built $APP"
echo "  run:      open $APP"
echo "  install:  cp -R $APP /Applications/"
